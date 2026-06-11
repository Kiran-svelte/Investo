import prisma from '../config/prisma';
import logger from '../config/logger';
import { normalizeInboundWhatsAppPhone } from '../utils/phoneMatch';
import { scheduleVisit } from './visitBooking.service';
import { confirmVisitById, rescheduleVisitById } from './visitState.service';
import { transitionLeadToVisitScheduled } from './leadTransition.service';
import { socketService, SOCKET_EVENTS } from './socket.service';
import { emitVisitUpdated } from './visitLifecycle.service';
import { logAgentAction } from './agent-action-log.service';
import { logOutboundBranch } from './outboundTurnDebug.service';
import { formatBuyerVisitPendingApproval, formatBuyerVisitScheduled } from '../utils/visitFormat.util';
import { formatISTDateTime, formatISTDateTimeLong } from '../utils/dateTime.util';
import type { CompanyUserMatch } from './inboundWhatsAppRouting.service';
import {
  buildVisitApprovalIdempotencyKey,
  cancelPendingBookingApproval,
  createBookingApprovalRequest,
  findPendingBookingApproval,
  getBookingApprovalById,
  resolveBookingApprovalStatus,
  updatePendingBookingApprovalSchedule,
  type BookingApprovalRow,
} from './bookingApproval.service';

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

async function toVisitPayload(approval: BookingApprovalRow): Promise<VisitApprovalPayload | null> {
  if (!approval.propertyId || !approval.conversationId) return null;
  const metadata = approval.metadata;
  let propertyName = typeof metadata.propertyName === 'string' ? metadata.propertyName : undefined;
  if (!propertyName) {
    const property = await prisma.property.findUnique({
      where: { id: approval.propertyId },
      select: { name: true },
    });
    propertyName = property?.name ?? undefined;
  }
  return {
    approvalId: approval.id,
    companyId: approval.companyId,
    leadId: approval.leadId,
    propertyId: approval.propertyId,
    scheduledAt: approval.scheduledAt.toISOString(),
    agentId: approval.agentId,
    conversationId: approval.conversationId,
    customerPhone: approval.customerPhone,
    customerName: approval.customerName,
    propertyName,
  };
}

export async function findPendingVisitApproval(
  companyId: string,
  agentId: string,
  approvalId?: string,
): Promise<VisitApprovalPayload | null> {
  const approval = await findPendingBookingApproval({
    companyId,
    kind: 'visit',
    agentId,
    approvalId,
  });
  return approval ? toVisitPayload(approval) : null;
}

export async function findPendingVisitApprovalForLead(input: {
  companyId: string;
  leadId: string;
}): Promise<VisitApprovalPayload | null> {
  const approval = await findPendingBookingApproval({
    companyId: input.companyId,
    kind: 'visit',
    leadId: input.leadId,
  });
  return approval ? toVisitPayload(approval) : null;
}

async function sendVisitApprovalRequestToAgent(payload: VisitApprovalPayload): Promise<void> {
  if (!payload.agentId) {
    logger.warn('sendVisitApprovalRequestToAgent: no agentId on payload, skipping agent notify', {
      approvalId: payload.approvalId,
      companyId: payload.companyId,
    });
    return;
  }

  const agent = await prisma.user.findUnique({
    where: { id: payload.agentId },
    select: { name: true, phone: true },
  });
  const whenLabel = formatISTDateTime(new Date(payload.scheduledAt));

  try {
    const { notificationEngine } = await import('./notification.engine');
    await notificationEngine.notify({
      companyId: payload.companyId,
      userId: payload.agentId,
      type: 'visit_scheduled',
      title: 'Site visit needs your approval',
      message: `${payload.customerName || payload.customerPhone} requested a visit for ${payload.propertyName || 'a property'}`,
      data: { pendingApproval: true, ...payload },
    });
  } catch (err: unknown) {
    logger.warn('sendVisitApprovalRequestToAgent: in-app notify failed (non-fatal)', {
      agentId: payload.agentId,
      approvalId: payload.approvalId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (agent?.phone) {
    const { whatsappService } = await import('./whatsapp.service');
    await whatsappService.sendCompanyInteractiveButtons(
      agent.phone,
      payload.companyId,
      `*Site visit request*\n\nCustomer: *${payload.customerName || 'Prospect'}*\nProperty: *${payload.propertyName || 'TBD'}*\nTime: *${whenLabel}*\n\nTap *Confirm* to approve and notify the customer, or *Decline* to ask for another slot.`,
      [
        { id: `visit-approve-${payload.approvalId}`, title: 'Confirm visit' },
        { id: `visit-decline-${payload.approvalId}`, title: 'Decline' },
      ],
      'Approve visit?',
      'Investo CRM',
    );
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
  idempotencyKey?: string;
  /** When set, agent approval reschedules this visit instead of creating a new row. */
  rescheduleVisitId?: string;
}): Promise<VisitApprovalPayload> {
  const customerPhone = normalizeInboundWhatsAppPhone(input.customerPhone);
  const idempotencyKey = input.idempotencyKey ?? buildVisitApprovalIdempotencyKey({
    companyId: input.companyId,
    leadId: input.leadId,
    propertyId: input.propertyId,
    scheduledAt: input.scheduledAt,
  });

  const metadata: Record<string, unknown> = { propertyName: input.propertyName };
  if (input.rescheduleVisitId) {
    metadata.rescheduleVisitId = input.rescheduleVisitId;
  }

  const { approval, idempotencyHit } = await createBookingApprovalRequest({
    companyId: input.companyId,
    kind: 'visit',
    leadId: input.leadId,
    propertyId: input.propertyId,
    agentId: input.agentId,
    conversationId: input.conversationId,
    scheduledAt: input.scheduledAt,
    customerPhone,
    customerName: input.customerName,
    idempotencyKey,
    metadata,
  });

  const payload = (await toVisitPayload(approval))!;
  if (!idempotencyHit) {
    await sendVisitApprovalRequestToAgent(payload);
  }

  if (!input.suppressCustomerMessage) {
    const agent = await prisma.user.findUnique({
      where: { id: input.agentId },
      select: { name: true },
    });
    const { whatsappService } = await import('./whatsapp.service');
    await whatsappService.sendCompanyTextMessage(
      payload.customerPhone,
      formatBuyerVisitPendingApproval(agent?.name),
      input.companyId,
    );
  }

  logger.info('Visit approval requested', {
    approvalId: payload.approvalId,
    leadId: input.leadId,
    agentId: input.agentId,
    scheduledAt: payload.scheduledAt,
    idempotencyHit,
  });

  return payload;
}

export async function reschedulePendingVisitApprovalForBuyer(input: {
  companyId: string;
  leadId: string;
  scheduledAt: Date;
}): Promise<{ handled: boolean; reply?: string; scheduledAt?: Date }> {
  const pending = await findPendingBookingApproval({
    companyId: input.companyId,
    kind: 'visit',
    leadId: input.leadId,
  });
  if (!pending || !pending.propertyId) return { handled: false };

  const idempotencyKey = buildVisitApprovalIdempotencyKey({
    companyId: input.companyId,
    leadId: input.leadId,
    propertyId: pending.propertyId,
    scheduledAt: input.scheduledAt,
  });
  const updated = await updatePendingBookingApprovalSchedule({
    approvalId: pending.id,
    scheduledAt: input.scheduledAt,
    idempotencyKey,
    metadata: pending.metadata,
  });
  if (!updated) {
    return { handled: true, reply: "I couldn't update that pending visit request. Please ask an agent to help." };
  }

  const payload = await toVisitPayload(updated);
  if (payload) await sendVisitApprovalRequestToAgent(payload);
  return {
    handled: true,
    scheduledAt: input.scheduledAt,
    reply: `${formatBuyerVisitPendingApproval()}\n\nUpdated requested time: ${formatISTDateTimeLong(input.scheduledAt)}`,
  };
}

export async function cancelPendingVisitApprovalForBuyer(input: {
  companyId: string;
  leadId: string;
}): Promise<{ handled: boolean; reply?: string }> {
  const pending = await findPendingBookingApproval({
    companyId: input.companyId,
    kind: 'visit',
    leadId: input.leadId,
  });
  if (!pending) return { handled: false };
  await cancelPendingBookingApproval(pending.id);
  const agent = await prisma.user.findUnique({ where: { id: pending.agentId }, select: { phone: true } });
  if (agent?.phone) {
    const { whatsappService } = await import('./whatsapp.service');
    await whatsappService.sendCompanyTextMessage(
      agent.phone,
      `Visit request cancelled by customer.\n\nCustomer: *${pending.customerName || pending.customerPhone}*`,
      input.companyId,
    ).catch(() => undefined);
  }
  return {
    handled: true,
    reply: `*Visit request cancelled*\n\nReply anytime with a new date and time if you'd like to request another site visit.`,
  };
}

export async function notifyAgentVisitChangeRequested(input: {
  companyId: string;
  leadId: string;
  visitId: string;
  messageText: string;
}): Promise<void> {
  const visit = await prisma.visit.findFirst({
    where: { id: input.visitId, companyId: input.companyId },
    include: {
      lead: { select: { customerName: true, phone: true } },
      agent: { select: { id: true, phone: true } },
      property: { select: { name: true } },
    },
  });
  if (!visit?.agent?.id) return;
  const { notificationEngine } = await import('./notification.engine');
  await notificationEngine.notify({
    companyId: input.companyId,
    userId: visit.agent.id,
    type: 'system_alert',
    title: 'Customer wants to change confirmed visit',
    message: `${visit.lead?.customerName || visit.lead?.phone || 'Customer'} asked: ${input.messageText}`,
    data: { kind: 'confirmed_visit_change_requested', visitId: input.visitId, leadId: input.leadId },
  });
  if (visit.agent.phone) {
    const { whatsappService } = await import('./whatsapp.service');
    await whatsappService.sendCompanyTextMessage(
      visit.agent.phone,
      `*Confirmed visit change requested*\n\nCustomer: *${visit.lead?.customerName || 'Buyer'}*\nProperty: *${visit.property?.name || 'Property'}*\nRequest: ${input.messageText}`,
      input.companyId,
    ).catch(() => undefined);
  }
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

  const { whatsappService } = await import('./whatsapp.service');

  if (!approved) {
    await resolveBookingApprovalStatus({ approvalId, status: 'declined' });
    await whatsappService.sendCompanyTextMessage(
      pending.customerPhone,
      `Our team could not confirm that exact slot. Please reply with another date/time that works for you, or choose a different slot from the buttons I send next.`,
      companyId,
    );
    return { ok: true, message: 'Visit declined. Customer notified to pick another time.' };
  }

  const scheduledAt = new Date(pending.scheduledAt);
  const approvalRow = await getBookingApprovalById(approvalId);
  const rescheduleVisitId =
    typeof approvalRow?.metadata?.rescheduleVisitId === 'string'
      ? approvalRow.metadata.rescheduleVisitId
      : null;

  let booking: Awaited<ReturnType<typeof scheduleVisit>>;
  if (rescheduleVisitId) {
    const rescheduled = await rescheduleVisitById({
      companyId,
      visitId: rescheduleVisitId,
      scheduledAt,
      suppressCustomerNotification: true,
    });
    if (!rescheduled.success || !rescheduled.visit) {
      return {
        ok: false,
        message: 'Could not reschedule the visit. Ask the customer for another time slot via WhatsApp.',
      };
    }
    booking = { success: true, visit: rescheduled.visit };
  } else {
    booking = await scheduleVisit({
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
  }

  await resolveBookingApprovalStatus({ approvalId, status: 'approved' });
  await confirmVisitById({
    companyId,
    visitId: booking.visit.id,
    suppressCustomerNotification: true,
  }).catch((err: unknown) => {
    logger.warn('resolveVisitApproval: confirm visit status failed', {
      visitId: booking.visit?.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  const agent = await prisma.user.findUnique({ where: { id: agentId }, select: { name: true } });
  const property = await prisma.property.findUnique({
    where: { id: pending.propertyId },
    select: { name: true, locationArea: true },
  });

  const mode = rescheduleVisitId ? 'rescheduled' : 'scheduled';
  const confirmText = formatBuyerVisitScheduled(
    scheduledAt,
    property?.name || pending.propertyName || 'Property',
    agent?.name ?? null,
    mode,
  );

  await whatsappService.sendCompanyTextMessage(pending.customerPhone, confirmText, companyId);

  await prisma.conversation.update({
    where: { id: pending.conversationId },
    data: {
      proposedVisitTime: scheduledAt,
      stage: 'confirmation',
      commitments: {
        visitSlotDiscussed: true,
        visitSlotConfirmed: true,
      },
    },
  }).catch(() => undefined);

  await transitionLeadToVisitScheduled(pending.leadId).catch(
    (err: unknown) => {
      logger.warn('resolveVisitApproval: lead status transition failed', {
        leadId: pending.leadId,
        error: err instanceof Error ? err.message : String(err),
      });
    },
  );

  logOutboundBranch(
    'H-approval',
    'visitPendingApproval:resolveVisitApproval',
    rescheduleVisitId ? 'visit_approval_rescheduled' : 'visit_approval_confirmed',
    { approvalId, leadId: pending.leadId, visitId: booking.visit.id, companyId },
  );

  emitVisitUpdated(companyId, booking.visit, rescheduleVisitId ? 'rescheduled' : 'confirmed');

  socketService.emitToCompany(companyId, SOCKET_EVENTS.LEAD_UPDATED, {
    leadId: pending.leadId,
    status: 'visit_scheduled',
    visitId: booking.visit.id,
  });

  void logAgentAction({
    companyId,
    triggeredBy: 'inbound_message',
    action: 'visit_confirmed_by_agent',
    actorId: agentId,
    resourceType: 'visit',
    resourceId: booking.visit.id,
    status: 'success',
    inputs: {
      approvalId,
      leadId: pending.leadId,
      scheduledAt: scheduledAt.toISOString(),
      propertyId: pending.propertyId,
    },
    result: 'Visit confirmed; customer notified; reminders scheduled',
  });

  return {
    ok: true,
    message: `Visit confirmed for ${formatISTDateTimeLong(scheduledAt)}. Customer notified, lead status updated, and calendar synced.`,
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
    interactiveId,
    companyId,
  });
  return false;
}
