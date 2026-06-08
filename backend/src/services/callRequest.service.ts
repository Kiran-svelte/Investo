// Call request service — v3 (2026-06-07)
import prisma from '../config/prisma';
import logger from '../config/logger';
import { getRedis } from '../config/redis';
import { assignLeadWithRouting } from './leadRouting.service';
import { formatDateIST } from './agent/tools/format-helpers';
import { automationQueueService } from './automationQueue.service';
import { socketService, SOCKET_EVENTS } from './socket.service';
import { withRetry } from './notificationRetry.service';
import { incrementOpsMetric } from './opsMetrics.service';
import {
  buildCallApprovalIdempotencyKey,
  createBookingApprovalRequest,
  findPendingBookingApproval,
  resolveBookingApprovalStatus,
  updatePendingBookingApprovalSchedule,
} from './bookingApproval.service';

export type CallRequestStatus = 'pending_approval' | 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

let schemaReady = false;

export async function ensureCallRequestsSchema(): Promise<void> {
  if (schemaReady) return;
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS call_requests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      agent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scheduled_at TIMESTAMP NOT NULL,
      duration_minutes INT NOT NULL DEFAULT 15,
      status VARCHAR(30) NOT NULL DEFAULT 'scheduled',
      notes TEXT NULL,
      agent_confirmed_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS call_requests_company_lead_idx ON call_requests (company_id, lead_id, scheduled_at DESC)`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS call_requests_agent_scheduled_idx ON call_requests (agent_id, scheduled_at)`,
  );
  schemaReady = true;
}

export interface CallRequestRow {
  id: string;
  company_id: string;
  lead_id: string;
  agent_id: string;
  scheduled_at: Date;
  duration_minutes: number;
  status: CallRequestStatus;
  notes: string | null;
  agent_confirmed_at: Date | null;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending_approval: 'Pending approval',
    scheduled: 'Scheduled',
    confirmed: 'Confirmed',
    completed: 'Completed',
    cancelled: 'Cancelled',
    no_show: 'No-show',
  };
  return map[status] ?? status;
}

export function formatBuyerCallReply(
  title: string,
  scheduledAt: Date,
  agentName?: string | null,
): string {
  const when = formatDateIST(scheduledAt);
  const agentLine = agentName ? `\nAgent: *${agentName}*` : '';
  return (
    `*${title}*\n\n` +
    `When: ${when}${agentLine}\n\n` +
    `Our specialist will confirm the call time with you shortly.`
  );
}

export async function findActiveCallRequest(input: {
  companyId: string;
  leadId: string;
}): Promise<CallRequestRow | null> {
  await ensureCallRequestsSchema();
  const rows = await prisma.$queryRawUnsafe<CallRequestRow[]>(
    `SELECT id, company_id, lead_id, agent_id, scheduled_at, duration_minutes, status, notes, agent_confirmed_at
     FROM call_requests
     WHERE company_id = $1::uuid AND lead_id = $2::uuid
       AND status IN ('pending_approval', 'scheduled', 'confirmed')
       AND scheduled_at >= now() - interval '2 hours'
     ORDER BY scheduled_at ASC
     LIMIT 1`,
    input.companyId,
    input.leadId,
  );
  return rows[0] ?? null;
}

export async function scheduleCallRequest(input: {
  companyId: string;
  leadId: string;
  scheduledAt: Date;
  notes?: string;
  agentId?: string;
  idempotencyKey?: string;
}): Promise<{ success: boolean; call?: CallRequestRow; error?: string }> {
  await ensureCallRequestsSchema();
  if (input.scheduledAt <= new Date()) {
    return { success: false, error: 'past_date' };
  }

  // Redis idempotency: prevent duplicate call booking.
  // TTL 86400s (24h) matches Meta's maximum webhook re-delivery window.
  const dedupKey = input.idempotencyKey
    ? `call-sched:${input.companyId}:${input.idempotencyKey}`
    : `call-sched:${input.companyId}:${input.leadId}:${input.scheduledAt.getTime()}`;
  const redis = getRedis();
  if (redis) {
    const claimed = await redis.set(dedupKey, '1', { nx: true, ex: 86_400 }).catch(() => 'OK');
    if (claimed !== 'OK') {
      incrementOpsMetric('call_idem_hit');
      const existing = await findActiveCallRequest({ companyId: input.companyId, leadId: input.leadId });
      if (existing) return { success: true, call: existing };
      logger.info('callRequest: idempotency hit (Redis), blocking duplicate booking', {
        companyId: input.companyId,
        leadId: input.leadId,
        dedupKey,
      });
      return { success: false, error: 'duplicate_request' };
    }
  }

  // DB-level duplicate check: guard against concurrent calls that bypass Redis
  // (e.g. two workers with split-brain or Redis flap).
  const existingRows = await prisma.$queryRawUnsafe<CallRequestRow[]>(
    `SELECT id FROM call_requests
     WHERE company_id = $1::uuid AND lead_id = $2::uuid
       AND scheduled_at = $3
       AND status IN ('pending_approval', 'scheduled', 'confirmed')
     LIMIT 1`,
    input.companyId,
    input.leadId,
    input.scheduledAt,
  );
  if (existingRows.length > 0) {
    incrementOpsMetric('call_idem_hit');
    logger.info('callRequest: idempotency hit (DB duplicate slot), returning existing call', {
      companyId: input.companyId,
      leadId: input.leadId,
      existingCallId: existingRows[0].id,
    });
    const existing = await findActiveCallRequest({ companyId: input.companyId, leadId: input.leadId });
    return existing ? { success: true, call: existing } : { success: false, error: 'duplicate_request' };
  }

  let agentId = input.agentId;
  if (!agentId) {
    const lead = await prisma.lead.findFirst({
      where: { id: input.leadId, companyId: input.companyId },
      select: { assignedAgentId: true },
    });
    agentId = lead?.assignedAgentId ?? undefined;
  }
  if (!agentId) {
    agentId = (await assignLeadWithRouting(input.companyId, null, input.leadId)) ?? undefined;
    if (agentId) {
      await prisma.lead.update({ where: { id: input.leadId }, data: { assignedAgentId: agentId } });
    }
  }
  if (!agentId) return { success: false, error: 'no_agent' };

  const rows = await prisma.$queryRawUnsafe<CallRequestRow[]>(
    `INSERT INTO call_requests (company_id, lead_id, agent_id, scheduled_at, duration_minutes, status, notes, updated_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 15, 'pending_approval', $5, now())
     RETURNING id, company_id, lead_id, agent_id, scheduled_at, duration_minutes, status, notes, agent_confirmed_at`,
    input.companyId,
    input.leadId,
    agentId,
    input.scheduledAt,
    input.notes ?? 'Callback via WhatsApp',
  );
  const call = rows[0];
  if (!call) return { success: false, error: 'insert_failed' };

  await createCallApprovalRequest({
    companyId: input.companyId,
    callId: call.id,
    leadId: input.leadId,
    agentId,
    scheduledAt: input.scheduledAt,
  });

  // Real-time dashboard push
  socketService.emitToCompany(input.companyId, SOCKET_EVENTS.CALL_CREATED, {
    call: { id: call.id, leadId: call.lead_id, agentId: call.agent_id, scheduledAt: call.scheduled_at, status: call.status },
  });

  return { success: true, call };
}


export async function rescheduleCallRequest(input: {
  companyId: string;
  callId: string;
  scheduledAt: Date;
}): Promise<{ success: boolean; call?: CallRequestRow; error?: string }> {
  await ensureCallRequestsSchema();
  if (input.scheduledAt <= new Date()) return { success: false, error: 'past_date' };
  const rows = await prisma.$queryRawUnsafe<CallRequestRow[]>(
    `UPDATE call_requests
     SET scheduled_at = $3, status = 'pending_approval', agent_confirmed_at = NULL, updated_at = now()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('pending_approval', 'scheduled')
     RETURNING id, company_id, lead_id, agent_id, scheduled_at, duration_minutes, status, notes, agent_confirmed_at`,
    input.callId,
    input.companyId,
    input.scheduledAt,
  );
  const call = rows[0];
  if (!call) return { success: false, error: 'not_found' };
  await createCallApprovalRequest({
    companyId: input.companyId,
    callId: call.id,
    leadId: call.lead_id,
    agentId: call.agent_id,
    scheduledAt: input.scheduledAt,
  });

  // Cancel any existing reminder; reminders are re-created only after approval.
  await automationQueueService.cancel('call_reminder_1h', call.id).catch(() => undefined);

  socketService.emitToCompany(input.companyId, SOCKET_EVENTS.CALL_UPDATED, {
    call: { id: call.id, leadId: call.lead_id, status: call.status, scheduledAt: call.scheduled_at },
  });

  return { success: true, call };
}

export async function cancelCallRequest(input: {
  companyId: string;
  callId: string;
  notifyAgent?: boolean;
}): Promise<{ success: boolean; call?: CallRequestRow; error?: string }> {
  await ensureCallRequestsSchema();
  const rows = await prisma.$queryRawUnsafe<CallRequestRow[]>(
    `UPDATE call_requests
     SET status = 'cancelled', updated_at = now()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('pending_approval', 'scheduled', 'confirmed')
     RETURNING id, company_id, lead_id, agent_id, scheduled_at, duration_minutes, status, notes, agent_confirmed_at`,
    input.callId,
    input.companyId,
  );
  const call = rows[0];
  if (call) {
    if (input.notifyAgent !== false) {
      await notifyAgentCallCancelled(call);
    }
    const pendingApproval = await findPendingBookingApproval({
      companyId: input.companyId,
      kind: 'call',
      callRequestId: call.id,
    });
    if (pendingApproval) {
      await resolveBookingApprovalStatus({ approvalId: pendingApproval.id, status: 'cancelled' });
    }
    // Cancel the 1h reminder since the call is cancelled
    await automationQueueService.cancel('call_reminder_1h', call.id).catch(() => undefined);
    socketService.emitToCompany(input.companyId, SOCKET_EVENTS.CALL_UPDATED, {
      call: { id: call.id, leadId: call.lead_id, status: 'cancelled', scheduledAt: call.scheduled_at },
    });
  }
  return call ? { success: true, call } : { success: false, error: 'not_found' };
}

/**
 * Schedules a 1-hour pre-call reminder for the customer.
 * Only schedules if the call is > 70 minutes away.
 */
async function scheduleCallReminder(call: CallRequestRow): Promise<void> {
  if (call.status !== 'confirmed') return;
  const msUntilCall = call.scheduled_at.getTime() - Date.now();
  if (msUntilCall < 70 * 60 * 1000) return; // too close to be useful

  const remindAt = new Date(call.scheduled_at.getTime() - 60 * 60 * 1000);
  await automationQueueService
    .schedule(
      'call_reminder_1h',
      call.id,
      remindAt,
      {
        callId: call.id,
        companyId: call.company_id,
        leadId: call.lead_id,
        agentId: call.agent_id,
        scheduledAt: call.scheduled_at.toISOString(),
      },
    )
    .catch((err: unknown) => {
      logger.warn('callRequest: failed to schedule 1h reminder', {
        callId: call.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

async function notifyAgentCallCancelled(call: CallRequestRow): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: call.lead_id },
    select: { customerName: true, phone: true },
  });
  const when = formatDateIST(call.scheduled_at);
  const { notificationEngine } = await import('./notification.engine');
  await notificationEngine.notify({
    companyId: call.company_id,
    userId: call.agent_id,
    type: 'call_cancelled',
    title: '📞 Callback cancelled by customer',
    message: `${lead?.customerName ?? lead?.phone ?? 'Customer'} cancelled their callback (${when}).`,
    data: {
      kind: 'call_cancelled',
      callId: call.id,
      leadId: call.lead_id,
      scheduledAt: call.scheduled_at.toISOString(),
    },
  });

  try {
    const agent = await prisma.user.findUnique({
      where: { id: call.agent_id },
      select: { phone: true },
    });
    if (agent?.phone) {
      const { whatsappService } = await import('./whatsapp.service');
      await whatsappService.sendCompanyTextMessage(
        agent.phone,
        `📞 *Callback cancelled*\n\nCustomer: *${lead?.customerName ?? 'Buyer'}*\nWas scheduled: ${when}`,
        call.company_id,
      );
    }
  } catch (err: unknown) {
    logger.warn('callRequest: agent cancel notification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function notifyAgentCallChangeRequested(input: {
  companyId: string;
  callId: string;
  messageText: string;
}): Promise<void> {
  await ensureCallRequestsSchema();
  const rows = await prisma.$queryRawUnsafe<CallRequestRow[]>(
    `SELECT id, company_id, lead_id, agent_id, scheduled_at, duration_minutes, status, notes, agent_confirmed_at
     FROM call_requests
     WHERE id = $1::uuid AND company_id = $2::uuid
     LIMIT 1`,
    input.callId,
    input.companyId,
  );
  const call = rows[0];
  if (!call) return;

  const [lead, agent] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: call.lead_id },
      select: { customerName: true, phone: true },
    }),
    prisma.user.findUnique({
      where: { id: call.agent_id },
      select: { phone: true },
    }),
  ]);
  const when = formatDateIST(call.scheduled_at);
  const { notificationEngine } = await import('./notification.engine');
  await notificationEngine.notify({
    companyId: call.company_id,
    userId: call.agent_id,
    type: 'system_alert',
    title: 'Confirmed callback change requested',
    message: `${lead?.customerName ?? lead?.phone ?? 'Customer'} asked to change a confirmed callback (${when}).`,
    data: {
      kind: 'call_change_requested',
      callId: call.id,
      leadId: call.lead_id,
      scheduledAt: call.scheduled_at.toISOString(),
      messageText: input.messageText.slice(0, 500),
    },
  });

  if (agent?.phone) {
    const { whatsappService } = await import('./whatsapp.service');
    await whatsappService.sendCompanyTextMessage(
      agent.phone,
      `*Confirmed callback change requested*\n\nCustomer: *${lead?.customerName ?? 'Buyer'}*\nCurrent time: ${when}\nMessage: ${input.messageText.slice(0, 300)}`,
      call.company_id,
    ).catch((err: unknown) => {
      logger.warn('callRequest: agent change-request WhatsApp failed', {
        callId: call.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

export async function confirmCallRequest(input: {
  companyId: string;
  callId: string;
}): Promise<{ success: boolean; call?: CallRequestRow }> {
  await ensureCallRequestsSchema();
  const rows = await prisma.$queryRawUnsafe<CallRequestRow[]>(
    `UPDATE call_requests
     SET status = 'confirmed', agent_confirmed_at = now(), updated_at = now()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('pending_approval', 'scheduled')
     RETURNING id, company_id, lead_id, agent_id, scheduled_at, duration_minutes, status, notes, agent_confirmed_at`,
    input.callId,
    input.companyId,
  );
  if (!rows[0]) return { success: false };
  await scheduleCallReminder(rows[0]);
  socketService.emitToCompany(input.companyId, SOCKET_EVENTS.CALL_UPDATED, {
    call: { id: rows[0].id, leadId: rows[0].lead_id, status: 'confirmed', scheduledAt: rows[0].scheduled_at },
  });
  return { success: true, call: rows[0] };
}

async function createCallApprovalRequest(input: {
  companyId: string;
  callId: string;
  leadId: string;
  agentId: string;
  scheduledAt: Date;
}): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { customerName: true, phone: true },
  });
  const idempotencyKey = buildCallApprovalIdempotencyKey({
    companyId: input.companyId,
    leadId: input.leadId,
    scheduledAt: input.scheduledAt,
  });

  let approvalId: string | null = null;
  let idempotencyHit = false;
  const existingPending = await findPendingBookingApproval({
    companyId: input.companyId,
    kind: 'call',
    callRequestId: input.callId,
  });

  if (existingPending) {
    const updated = await updatePendingBookingApprovalSchedule({
      approvalId: existingPending.id,
      scheduledAt: input.scheduledAt,
      idempotencyKey,
      metadata: { callId: input.callId },
    });
    approvalId = updated?.id ?? existingPending.id;
  } else {
    const created = await createBookingApprovalRequest({
      companyId: input.companyId,
      kind: 'call',
      leadId: input.leadId,
      agentId: input.agentId,
      callRequestId: input.callId,
      scheduledAt: input.scheduledAt,
      customerPhone: lead?.phone ?? '',
      customerName: lead?.customerName ?? null,
      idempotencyKey,
      metadata: { callId: input.callId },
    });
    approvalId = created.approval.id;
    idempotencyHit = created.idempotencyHit;
  }

  if (idempotencyHit) {
    logger.info('callRequest: approval idempotency hit, suppressing duplicate agent notification', {
      companyId: input.companyId,
      callId: input.callId,
      leadId: input.leadId,
    });
    return;
  }
  const when = formatDateIST(input.scheduledAt);
  const { notificationEngine } = await import('./notification.engine');
  await notificationEngine.notify({
    companyId: input.companyId,
    userId: input.agentId,
    type: 'call_requested',
    title: '📞 Callback approval needed',
    message: `${lead?.customerName ?? lead?.phone ?? 'Customer'} requested a call at ${when}. Approve or decline in WhatsApp.`,
    data: {
      pendingApproval: true,
      approvalKind: 'call_request',
      approvalId,
      callId: input.callId,
      leadId: input.leadId,
      scheduledAt: input.scheduledAt.toISOString(),
      customerPhone: lead?.phone ?? null,
      customerName: lead?.customerName ?? null,
    },
  });

  try {
    const { whatsappService } = await import('./whatsapp.service');
    const agent = await prisma.user.findUnique({
      where: { id: input.agentId },
      select: { phone: true, name: true },
    });
    if (agent?.phone) {
      await whatsappService.sendCompanyInteractiveButtons(
        agent.phone,
        input.companyId,
        `📞 *Callback request*\n\nCustomer: *${lead?.customerName ?? 'Buyer'}*\nWhen: ${when}\n\nApprove this call slot?`,
        [
          { id: `call-approve-${input.callId}`, title: '✅ Approve' },
          { id: `call-decline-${input.callId}`, title: '❌ Decline' },
        ],
      );
    }
  } catch (err: unknown) {
    logger.warn('callRequest: agent approval WhatsApp failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function parseCallApprovalIdFromInteractive(interactiveId: string): { callId: string; approved: boolean } | null {
  if (interactiveId.startsWith('call-approve-')) {
    return { callId: interactiveId.slice('call-approve-'.length), approved: true };
  }
  if (interactiveId.startsWith('call-decline-')) {
    return { callId: interactiveId.slice('call-decline-'.length), approved: false };
  }
  return null;
}

async function findPendingCallApproval(input: {
  companyId: string;
  agentId: string;
  callId?: string;
}): Promise<{ approvalId: string; callId: string; leadId: string; scheduledAt: Date } | null> {
  const approval = await findPendingBookingApproval({
    companyId: input.companyId,
    kind: 'call',
    agentId: input.agentId,
    callRequestId: input.callId,
  });
  if (!approval?.callRequestId) return null;
  return {
    approvalId: approval.id,
    callId: approval.callRequestId,
    leadId: approval.leadId,
    scheduledAt: approval.scheduledAt,
  };
}

export async function resolveCallApproval(
  callId: string,
  approved: boolean,
  companyId: string,
  agentId: string,
): Promise<{ ok: boolean; message: string }> {
  const pending = await findPendingCallApproval({ companyId, agentId, callId });
  if (!pending) {
    return { ok: false, message: 'No pending callback request found (it may have expired).' };
  }

  const lead = await prisma.lead.findUnique({
    where: { id: pending.leadId },
    select: { phone: true, customerName: true },
  });
  const { whatsappService } = await import('./whatsapp.service');
  const when = formatDateIST(pending.scheduledAt);
  const agent = await prisma.user.findUnique({ where: { id: agentId }, select: { name: true } });

  if (!approved) {
    await resolveBookingApprovalStatus({ approvalId: pending.approvalId, status: 'declined' });
    await cancelCallRequest({ companyId, callId, notifyAgent: false });
    if (lead?.phone) {
      await whatsappService.sendCompanyTextMessage(
        lead.phone,
        `Our team couldn't confirm that call slot (${when}). Reply with another time (e.g. *tomorrow 3pm*) or tap *Call Me* to pick a new slot.`,
        companyId,
      );
    }
    return { ok: true, message: 'Callback declined. Customer notified to pick another time.' };
  }

  const confirmed = await confirmCallRequest({ companyId, callId });
  if (!confirmed.success || !confirmed.call) {
    return { ok: false, message: 'Could not confirm that callback. Ask the customer to pick another time via WhatsApp.' };
  }
  await resolveBookingApprovalStatus({ approvalId: pending.approvalId, status: 'approved' });

  // In-app notification to the agent confirming the call booking.
  // This fires even if the subsequent WhatsApp send to the customer fails,
  // so the agent always knows the call is confirmed.
  try {
    const { notificationEngine } = await import('./notification.engine');
    await notificationEngine.notify({
      companyId,
      userId: agentId,
      type: 'system_alert',
      title: '✅ Callback confirmed',
      message: `Call with ${lead?.customerName ?? 'Customer'} confirmed for ${when}. Customer has been notified.`,
      data: {
        kind: 'call_confirmation',
        callId,
        leadId: pending.leadId,
        scheduledAt: pending.scheduledAt.toISOString(),
      },
    });
  } catch (err: unknown) {
    logger.warn('resolveCallApproval: agent in-app notification failed', {
      callId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (lead?.phone) {
    const confirmText =
      `✅ *Callback confirmed!*\n\n` +
      `📞 ${when}\n` +
      `👤 Your specialist: *${agent?.name || 'Sales team'}*\n\n` +
      `We'll call you at the scheduled time. Reply if you need to reschedule.`;
    try {
      await withRetry(
        async () => {
          const { whatsappService } = await import('./whatsapp.service');
          await whatsappService.sendCompanyTextMessage(lead.phone, confirmText, companyId);
        },
        { label: 'call_confirmation_customer_whatsapp', maxAttempts: 3, baseDelayMs: 1000 },
      );
    } catch (err: unknown) {
      logger.error('resolveCallApproval: customer WhatsApp confirmation failed after retries', {
        callId,
        leadId: pending.leadId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Do not return error — call is confirmed in DB; customer will see it on next WhatsApp interaction.
    }
  }

  return { ok: true, message: `Callback confirmed for ${when}. Customer notified.` };
}

export async function tryHandleCallApprovalInteractive(
  interactiveId: string,
  agent: { userId: string; companyId: string; phone: string },
): Promise<boolean> {
  const parsed = parseCallApprovalIdFromInteractive(interactiveId);
  if (!parsed) return false;

  const result = await resolveCallApproval(parsed.callId, parsed.approved, agent.companyId, agent.userId);
  const { whatsappService } = await import('./whatsapp.service');
  await whatsappService.sendCompanyTextMessage(agent.phone, result.message, agent.companyId);
  return true;
}

/** Text-based call approval reply — agent types "approve", "decline", etc. */
export async function tryHandleAgentCallApprovalReply(
  user: { userId: string; companyId: string; phone: string },
  messageText: string,
): Promise<boolean> {
  const text = messageText.trim().toLowerCase().replace(/^[^a-z]+/, ''); // strip emoji prefix
  const isYes = /^(yes|y|confirm|approved|ok|okay|approve)\b/.test(text);
  const isNo = /^(no|n|decline|reject|cancel)\b/.test(text);
  if (!isYes && !isNo) return false;

  const pending = await findPendingCallApproval({ companyId: user.companyId, agentId: user.userId });
  if (!pending) return false;

  const result = await resolveCallApproval(pending.callId, isYes, user.companyId, user.userId);
  const { whatsappService } = await import('./whatsapp.service');
  await whatsappService.sendCompanyTextMessage(user.phone, result.message, user.companyId);
  return true;
}

export async function buildBuyerCallStatusReply(input: {
  companyId: string;
  leadId: string;
}): Promise<string> {
  const active = await findActiveCallRequest(input);
  if (!active) {
    return (
      `You don't have a scheduled callback right now.\n\n` +
      `Reply *"call me tomorrow 3pm"* or tap *Call Me* to book a time with our team.`
    );
  }
  const agent = await prisma.user.findUnique({
    where: { id: active.agent_id },
    select: { name: true, phone: true },
  });
  const when = formatDateIST(active.scheduled_at);
  const agentLine = agent?.name
    ? `\nAgent: *${agent.name}*${agent.phone ? ` (${agent.phone})` : ''}`
    : '';
  return [
    `*YOUR CALLBACK*`,
    '',
    `When: ${when}`,
    `Status: *${statusLabel(active.status)}*${agentLine}`,
    '',
    active.status === 'pending_approval'
      ? `Your request is waiting for team approval. You can reschedule or cancel before it is confirmed.`
      : `Confirmed callbacks cannot be changed automatically. Reply with a new request and I will notify the team.`,
  ].join('\n');
}
