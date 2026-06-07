// Call request service — v2 (2026-06-07)
import prisma from '../config/prisma';
import logger from '../config/logger';
import { assignLeadWithRouting } from './leadRouting.service';
import { formatDateIST } from './agent/tools/format-helpers';

export type CallRequestStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

let schemaReady = false;

export async function ensureCallRequestsSchema(): Promise<void> {
  if (schemaReady) return;
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
       AND status IN ('scheduled', 'confirmed')
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
}): Promise<{ success: boolean; call?: CallRequestRow; error?: string }> {
  await ensureCallRequestsSchema();
  if (input.scheduledAt <= new Date()) {
    return { success: false, error: 'past_date' };
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
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 15, 'scheduled', $5, now())
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
     SET scheduled_at = $3, status = 'scheduled', agent_confirmed_at = NULL, updated_at = now()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('scheduled', 'confirmed')
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
  return { success: true, call };
}

export async function cancelCallRequest(input: {
  companyId: string;
  callId: string;
}): Promise<{ success: boolean; call?: CallRequestRow; error?: string }> {
  await ensureCallRequestsSchema();
  const rows = await prisma.$queryRawUnsafe<CallRequestRow[]>(
    `UPDATE call_requests
     SET status = 'cancelled', updated_at = now()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status IN ('scheduled', 'confirmed')
     RETURNING id, company_id, lead_id, agent_id, scheduled_at, duration_minutes, status, notes, agent_confirmed_at`,
    input.callId,
    input.companyId,
  );
  return rows[0] ? { success: true, call: rows[0] } : { success: false, error: 'not_found' };
}

export async function confirmCallRequest(input: {
  companyId: string;
  callId: string;
}): Promise<{ success: boolean; call?: CallRequestRow }> {
  await ensureCallRequestsSchema();
  const rows = await prisma.$queryRawUnsafe<CallRequestRow[]>(
    `UPDATE call_requests
     SET status = 'confirmed', agent_confirmed_at = now(), updated_at = now()
     WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'scheduled'
     RETURNING id, company_id, lead_id, agent_id, scheduled_at, duration_minutes, status, notes, agent_confirmed_at`,
    input.callId,
    input.companyId,
  );
  return rows[0] ? { success: true, call: rows[0] } : { success: false };
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
  const when = formatDateIST(input.scheduledAt);
  await prisma.notification.create({
    data: {
      companyId: input.companyId,
      userId: input.agentId,
      type: 'system_alert',
      title: '📞 Callback approval needed',
      message: `${lead?.customerName ?? lead?.phone ?? 'Customer'} requested a call at ${when}. Approve or decline in WhatsApp.`,
      data: {
        pendingApproval: true,
        approvalKind: 'call_request',
        callId: input.callId,
        leadId: input.leadId,
        scheduledAt: input.scheduledAt.toISOString(),
      },
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
}): Promise<{ callId: string; leadId: string; scheduledAt: Date } | null> {
  const notifications = await prisma.notification.findMany({
    where: { companyId: input.companyId, userId: input.agentId, type: 'system_alert' },
    orderBy: { createdAt: 'desc' },
    take: input.callId ? 30 : 10,
  });
  for (const row of notifications) {
    const data = (row.data as Record<string, unknown>) || {};
    if (data.pendingApproval !== true || data.approvalKind !== 'call_request' || !data.callId) continue;
    if (input.callId && data.callId !== input.callId) continue;
    return {
      callId: String(data.callId),
      leadId: String(data.leadId),
      scheduledAt: new Date(String(data.scheduledAt)),
    };
  }
  return null;
}

async function clearPendingCallApproval(companyId: string, agentId: string, callId: string): Promise<void> {
  const rows = await prisma.notification.findMany({
    where: { companyId, userId: agentId, type: 'system_alert' },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  for (const row of rows) {
    const data = (row.data as Record<string, unknown>) || {};
    if (data.callId === callId && data.pendingApproval === true) {
      await prisma.notification.update({
        where: { id: row.id },
        data: { data: { ...data, pendingApproval: false, resolvedAt: new Date().toISOString() } },
      });
    }
  }
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

  await clearPendingCallApproval(companyId, agentId, callId);

  const lead = await prisma.lead.findUnique({
    where: { id: pending.leadId },
    select: { phone: true, customerName: true },
  });
  const { whatsappService } = await import('./whatsapp.service');
  const when = formatDateIST(pending.scheduledAt);
  const agent = await prisma.user.findUnique({ where: { id: agentId }, select: { name: true } });

  if (!approved) {
    await cancelCallRequest({ companyId, callId });
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
    return { ok: false, message: 'Could not confirm that callback. Please try from the dashboard.' };
  }

  if (lead?.phone) {
    const confirmText =
      `✅ *Callback confirmed!*\n\n` +
      `📞 ${when}\n` +
      `👤 Your specialist: *${agent?.name || 'Sales team'}*\n\n` +
      `We'll call you at the scheduled time. Reply if you need to reschedule.`;
    await whatsappService.sendCompanyTextMessage(lead.phone, confirmText, companyId);
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
    `Tap a button below to *confirm*, *reschedule*, or *call your agent*.`,
  ].join('\n');
}
