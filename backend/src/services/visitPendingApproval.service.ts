import { randomUUID } from 'crypto';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { maskPhoneNumberForLogs } from '../utils/maskPhoneNumberForLogs';
import { normalizeInboundWhatsAppPhone } from '../utils/phoneMatch';
import { scheduleVisit } from './visitBooking.service';
import { transitionLeadStatus } from './leadTransition.service';
import { socketService, SOCKET_EVENTS } from './socket.service';
import { formatBuyerVisitPendingApproval } from '../utils/visitFormat.util';
import type { CompanyUserMatch } from './inboundWhatsAppRouting.service';

export interface VisitApprovalPayload {
  approvalId: string;
  companyId: string;
  leadId: string;
  propertyId: string;
  scheduledAt: string;
  agentId: string;
  conversationId: string;
  customerPhone: string;
  customerName?: string | null;
  propertyName?: string;
}

function parseApprovalIdFromInteractive(interactiveId: string): { id: string; approved: boolean } | null {
  if (interactiveId.startsWith('visit-approve-')) {
    return { id: interactiveId.slice('visit-approve-'.length), approved: true };
  }
  if (interactiveId.startsWith('visit-decline-')) {
    return { id: interactiveId.slice('visit-decline-'.length), approved: false };
  }
  return null;
}

export async function findPendingVisitApproval(
  companyId: string,
  agentId: string,
  approvalId?: string,
): Promise<VisitApprovalPayload | null> {
  const notifications = await prisma.notification.findMany({
    where: {
      companyId,
      userId: agentId,
      type: 'visit_scheduled',
    },
    orderBy: { createdAt: 'desc' },
    take: approvalId ? 20 : 5,
  });

  for (const row of notifications) {
    const data = (row.data as Record<string, unknown>) || {};
    if (data.pendingApproval !== true || !data.approvalId) continue;
    if (approvalId && data.approvalId !== approvalId) continue;
    return {
      approvalId: String(data.approvalId),
      companyId: String(data.companyId || companyId),
      leadId: String(data.leadId),
      propertyId: String(data.propertyId),
      scheduledAt: String(data.scheduledAt),
      agentId: String(data.agentId || agentId),
      conversationId: String(data.conversationId),
      customerPhone: String(data.customerPhone),
      customerName: data.customerName ? String(data.customerName) : null,
      propertyName: data.propertyName ? String(data.propertyName) : undefined,
    };
  }
  return null;
}

async function clearPendingApproval(companyId: string, agentId: string, approvalId: string): Promise<void> {
  const rows = await prisma.notification.findMany({
    where: { companyId, userId: agentId, type: 'visit_scheduled' },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  for (const row of rows) {
    const data = (row.data as Record<string, unknown>) || {};
    if (data.approvalId === approvalId) {
      await prisma.notification.update({
        where: { id: row.id },
        data: {
          data: { ...data, pendingApproval: false, resolvedAt: new Date().toISOString() },
        },
      });
    }
  }
}

export async function createVisitApprovalRequest(input: {
  companyId: string;
  leadId: string;
  propertyId: string;
  scheduledAt: Date;
  agentId: string;
  conversationId: string;
  customerPhone: string;
  customerName?: string | null;
  propertyName?: string;
  /** When true, skip sending WhatsApp to customer (caller owns the reply). */
  suppressCustomerMessage?: boolean;
}): Promise<VisitApprovalPayload> {
  const approvalId = randomUUID();
  const payload: VisitApprovalPayload = {
    approvalId,
    companyId: input.companyId,
    leadId: input.leadId,
    propertyId: input.propertyId,
    scheduledAt: input.scheduledAt.toISOString(),
    agentId: input.agentId,
    conversationId: input.conversationId,
    customerPhone: normalizeInboundWhatsAppPhone(input.customerPhone),
    customerName: input.customerName,
    propertyName: input.propertyName,
  };

  const { notificationEngine } = await import('./notification.engine');
  await notificationEngine.notify({
    companyId: input.companyId,
    userId: input.agentId,
    type: 'visit_scheduled',
    title: 'Site visit needs your approval',
    message: `${input.customerName || payload.customerPhone} requested a visit for ${input.propertyName || 'a property'}`,
    data: { pendingApproval: true, ...payload },
  });

  const agent = await prisma.user.findUnique({
    where: { id: input.agentId },
    select: { name: true, phone: true },
  });

  const { whatsappService } = await import('./whatsapp.service');
  const whenLabel = input.scheduledAt.toLocaleString('en-IN', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (agent?.phone) {
    await whatsappService.sendCompanyInteractiveButtons(
      agent.phone,
      input.companyId,
      `📅 *Site visit request*\n\nCustomer: *${input.customerName || 'Prospect'}*\nProperty: *${input.propertyName || 'TBD'}*\nTime: *${whenLabel}*\n\nTap *Confirm* to approve and notify the customer, or *Decline* to ask for another slot.`,
      [
        { id: `visit-approve-${approvalId}`, title: 'Confirm visit' },
        { id: `visit-decline-${approvalId}`, title: 'Decline' },
      ],
      'Approve visit?',
      'Investo CRM',
    );
  }

  if (!input.suppressCustomerMessage) {
    await whatsappService.sendCompanyTextMessage(
      payload.customerPhone,
      formatBuyerVisitPendingApproval(agent?.name),
      input.companyId,
    );
  }

  logger.info('Visit approval requested', {
    approvalId,
    leadId: input.leadId,
    agentId: input.agentId,
    scheduledAt: payload.scheduledAt,
  });

  return payload;
}

export async function resolveVisitApproval(
  approvalId: string,
  approved: boolean,
  companyId: string,
  agentId: string,
): Promise<{ ok: boolean; message: string }> {
  const pending = await findPendingVisitApproval(companyId, agentId, approvalId);
  if (!pending) {
    return { ok: false, message: 'No pending visit request found (it may have expired).' };
  }

  await clearPendingApproval(companyId, agentId, approvalId);

  const { whatsappService } = await import('./whatsapp.service');

  if (!approved) {
    await whatsappService.sendCompanyTextMessage(
      pending.customerPhone,
      `Our team could not confirm that exact slot. Please reply with another date/time that works for you, or choose a different slot from the buttons I send next.`,
      companyId,
    );
    return { ok: true, message: 'Visit declined. Customer notified to pick another time.' };
  }

  const scheduledAt = new Date(pending.scheduledAt);
  const booking = await scheduleVisit({
    companyId,
    leadId: pending.leadId,
    propertyId: pending.propertyId,
    scheduledAt,
    agentId,
    notes: 'Confirmed by agent via WhatsApp',
  });

  if (!booking.success || !booking.visit) {
    const err =
      booking.error === 'agent_conflict'
        ? 'That slot conflicts with your calendar. Ask the customer for another time.'
        : 'Could not book the visit. Ask the customer for another time slot via WhatsApp.';
    return { ok: false, message: err };
  }

  const agent = await prisma.user.findUnique({ where: { id: agentId }, select: { name: true } });
  const property = await prisma.property.findUnique({
    where: { id: pending.propertyId },
    select: { name: true, locationArea: true },
  });

  const confirmText =
    `✅ *Visit confirmed!*\n\n` +
    `📍 *${property?.name || pending.propertyName || 'Property'}*${property?.locationArea ? ` — ${property.locationArea}` : ''}\n` +
    `📅 ${scheduledAt.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' })}\n` +
    `⏰ ${scheduledAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n` +
    `👤 Your host: *${agent?.name || 'Sales team'}*\n\n` +
    `See you at the site! Reply if you need to reschedule.`;

  await whatsappService.sendCompanyTextMessage(pending.customerPhone, confirmText, companyId);

  // Advance conversation stage to 'confirmation' — the visit is now fully booked.
  // 'visit_booking' is the slot-selection phase; 'confirmation' means done.
  await prisma.conversation.update({
    where: { id: pending.conversationId },
    data: {
      proposedVisitTime: scheduledAt,
      stage: 'confirmation',
    },
  });

  // Transition lead pipeline status to visit_scheduled.
  // transitionLeadStatus is a no-op if the lead is already at a later stage,
  // so this is safe to call unconditionally.
  await transitionLeadStatus(pending.leadId, 'visit_scheduled', { force: false }).catch(
    (err: unknown) => {
      logger.warn('resolveVisitApproval: lead status transition failed', {
        leadId: pending.leadId,
        error: err instanceof Error ? err.message : String(err),
      });
    },
  );

  // Push real-time dashboard update so the pipeline card moves without a page refresh.
  socketService.emitToCompany(companyId, SOCKET_EVENTS.LEAD_UPDATED, {
    leadId: pending.leadId,
    status: 'visit_scheduled',
    visitId: booking.visit?.id,
  });

  return {
    ok: true,
    message: `Visit confirmed for ${scheduledAt.toLocaleString('en-IN')}. Customer notified, lead status updated, and calendar synced.`,
  };
}

/** Agent WhatsApp reply (text or handled upstream via interactive id). */
export async function tryHandleAgentVisitApprovalReply(
  user: CompanyUserMatch,
  messageText: string,
): Promise<boolean> {
  const text = messageText.trim().toLowerCase();
  const isYes = /^(yes|y|confirm|approved|ok|okay|approve)\b/.test(text);
  const isNo = /^(no|n|decline|reject|cancel)\b/.test(text);
  if (!isYes && !isNo) return false;

  const pending = await findPendingVisitApproval(user.companyId, user.userId);
  if (!pending) return false;

  const result = await resolveVisitApproval(pending.approvalId, isYes, user.companyId, user.userId);
  const { whatsappService } = await import('./whatsapp.service');
  await whatsappService.sendCompanyTextMessage(user.phone, result.message, user.companyId);
  return true;
}

export async function tryHandleVisitApprovalInteractive(
  interactiveId: string,
  agent: { userId: string; companyId: string; phone: string },
): Promise<boolean> {
  const parsed = parseApprovalIdFromInteractive(interactiveId);
  if (!parsed) return false;

  const result = await resolveVisitApproval(parsed.id, parsed.approved, agent.companyId, agent.userId);
  const { whatsappService } = await import('./whatsapp.service');
  await whatsappService.sendCompanyTextMessage(agent.phone, result.message, agent.companyId);
  return true;
}

export async function tryHandleCustomerVisitApprovalInteractive(
  interactiveId: string,
  companyId: string,
): Promise<boolean> {
  const parsed = parseApprovalIdFromInteractive(interactiveId);
  if (!parsed) return false;
  logger.warn('Customer attempted agent visit approval button', {
    interactiveId: maskPhoneNumberForLogs(interactiveId),
    companyId,
  });
  return false;
}
