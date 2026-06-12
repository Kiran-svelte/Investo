import prisma from '../config/prisma';
import logger from '../config/logger';
import type { Prisma } from '@prisma/client';
import { logAgentAction } from './agent-action-log.service';
import { mergeLeadMetadataRaw, readStaffRescheduleRequest, clearStaffRescheduleRequest } from '../utils/staffRescheduleRequest.util';
import { parseCustomVisitSlotFromMessage, parseVisitDateTimeFromMessage } from './visitIntentFromMessage.service';
import { rescheduleVisitById } from './visitState.service';
import { formatBuyerVisitScheduled } from '../utils/visitFormat.util';
import { formatISTDateTimeLong } from '../utils/dateTime.util';
import config from '../config';

export function isAttendanceStaffRescheduleEnabled(): boolean {
  return config.features.attendanceStaffRescheduleFlow !== false;
}

function getString(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function buildCustomerRescheduleAsk(input: {
  customerName: string;
  propertyName: string;
  agentName?: string | null;
}): string {
  const name = input.customerName.trim() || 'there';
  const property = input.propertyName.trim() || 'your shortlisted property';
  const agentLine = input.agentName?.trim()
    ? `Your agent *${input.agentName.trim()}* asked us to find a better time.`
    : `Our team would like to find a better time for you.`;
  return [
    `Hi ${name}! 👋`,
    '',
    agentLine,
    '',
    `Which date and time works for your visit to *${property}*?`,
    '',
    `Reply with your preference (e.g. *Saturday 4pm* or *tomorrow 11am*).`,
  ].join('\n');
}

/**
 * Staff tapped *Reschedule* on the post-visit attendance check (3-button message).
 * Opens a customer outreach job: ask buyer for preferred time, then auto-reschedule on reply.
 */
export async function handleAttendanceCheckReschedule(input: {
  companyId: string;
  sessionId: string;
  agentUserId: string;
  agentPhone: string;
  pendingActionId: string;
  params: Record<string, unknown>;
}): Promise<string> {
  const visitId = getString(input.params, 'visitId');
  const leadId = getString(input.params, 'leadId');
  const customerPhone = getString(input.params, 'customerPhone');
  const customerName = getString(input.params, 'customerName') ?? 'Customer';
  const propertyName = getString(input.params, 'propertyName') ?? 'Property';

  if (!visitId || !leadId) {
    return 'Missing visit details on this attendance check. Open the visit in the dashboard to reschedule manually.';
  }

  const visit = await prisma.visit.findFirst({
    where: { id: visitId, companyId: input.companyId },
    include: {
      lead: { select: { id: true, phone: true, customerName: true } },
      property: { select: { name: true } },
      agent: { select: { id: true, name: true } },
    },
  });

  if (!visit) {
    return 'Visit not found. It may have been cancelled already.';
  }
  if (visit.status === 'completed' || visit.status === 'cancelled' || visit.status === 'no_show') {
    return `This visit is already *${visit.status}*. Use the dashboard if you need to book a new one.`;
  }

  const phone = customerPhone || visit.lead?.phone;
  if (!phone) {
    return `${customerName} has no phone on file. Add a number in CRM, then type "reschedule visit ${customerName}".`;
  }

  const resolvedPropertyName = visit.property?.name ?? propertyName;
  const resolvedCustomerName = visit.lead?.customerName ?? customerName;

  await prisma.pendingAction.update({
    where: { id: input.pendingActionId },
    data: { status: 'confirmed', resolvedAt: new Date() },
  });

  await prisma.pendingAction.create({
    data: {
      sessionId: input.sessionId,
      actionType: 'attendance_reschedule_awaiting_customer',
      actionParams: {
        visitId: visit.id,
        leadId: visit.leadId,
        companyId: input.companyId,
        customerName: resolvedCustomerName,
        customerPhone: phone,
        propertyName: resolvedPropertyName,
        agentUserId: input.agentUserId,
      },
      displayMessage: `Waiting for ${resolvedCustomerName} to suggest a new visit time.`,
      status: 'awaiting',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    },
  });

  await prisma.lead.update({
    where: { id: leadId },
    data: {
      metadata: mergeLeadMetadataRaw(
        (await prisma.lead.findUnique({ where: { id: leadId }, select: { metadata: true } }))?.metadata,
        {
          staff_reschedule_visit_id: visit.id,
          staff_reschedule_agent_id: input.agentUserId,
          staff_reschedule_requested_at: new Date().toISOString(),
        },
      ) as Prisma.InputJsonValue,
    },
  });

  const conversation = await prisma.conversation.findFirst({
    where: { companyId: input.companyId, leadId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  if (conversation) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        stage: 'visit_booking',
        proposedVisitTime: null,
        commitments: {
          visitSlotDiscussed: false,
          visitSlotConfirmed: false,
          staffReschedulePending: true,
        },
      },
    }).catch(() => undefined);
  }

  const customerMessage = buildCustomerRescheduleAsk({
    customerName: resolvedCustomerName,
    propertyName: resolvedPropertyName,
    agentName: visit.agent?.name,
  });

  try {
    const { whatsappService } = await import('./whatsapp.service');
    await whatsappService.sendCompanyTextMessage(phone, customerMessage, input.companyId);
  } catch (err: unknown) {
    logger.error('handleAttendanceCheckReschedule: failed to message customer', {
      visitId,
      leadId,
      error: err instanceof Error ? err.message : String(err),
    });
    await clearStaffRescheduleRequest(leadId);
    return `Could not WhatsApp ${resolvedCustomerName}. Check their number and try again from the dashboard.`;
  }

  void logAgentAction({
    companyId: input.companyId,
    triggeredBy: 'inbound_message',
    action: 'attendance_reschedule_customer_outreach',
    actorId: input.agentUserId,
    resourceType: 'visit',
    resourceId: visit.id,
    status: 'success',
    result: `Asked ${resolvedCustomerName} for a new visit time via WhatsApp`,
  });

  return [
    `📅 *Reschedule started*`,
    '',
    `I've asked *${resolvedCustomerName}* for a new visit time for *${resolvedPropertyName}*.`,
    '',
    `When they reply (e.g. "Saturday 4pm"), I'll reschedule the calendar, update the lead, and refresh reminders automatically.`,
    '',
    `You'll get a WhatsApp confirmation here once it's done.`,
  ].join('\n');
}

export type StaffRequestedRescheduleResult = {
  committed: boolean;
  mode: 'rescheduled';
  scheduledAt: Date;
  visitId: string;
  customerReply: string;
  leadStatus: 'visit_scheduled';
};

/**
 * Buyer replied with a time after staff tapped Reschedule on attendance check.
 */
export async function tryCompleteStaffRequestedReschedule(input: {
  companyId: string;
  leadId: string;
  customerMessage: string;
}): Promise<StaffRequestedRescheduleResult | null> {
  if (!isAttendanceStaffRescheduleEnabled()) return null;

  const request = await readStaffRescheduleRequest(input.leadId);
  if (!request?.staff_reschedule_visit_id) return null;

  const scheduledAt =
    parseCustomVisitSlotFromMessage(input.customerMessage)
    ?? parseVisitDateTimeFromMessage(input.customerMessage);
  if (!scheduledAt || scheduledAt <= new Date()) {
    return null;
  }

  const visit = await prisma.visit.findFirst({
    where: { id: request.staff_reschedule_visit_id, companyId: input.companyId, leadId: input.leadId },
    include: {
      lead: { select: { customerName: true } },
      property: { select: { name: true } },
      agent: { select: { id: true, name: true, phone: true } },
    },
  });
  if (!visit) {
    await clearStaffRescheduleRequest(input.leadId);
    return null;
  }

  const result = await rescheduleVisitById({
    companyId: input.companyId,
    visitId: visit.id,
    scheduledAt,
    notes: 'Rescheduled after staff attendance check — customer chose new time.',
    suppressCustomerNotification: true,
  });

  if (!result.success || !result.visit) {
    logger.warn('tryCompleteStaffRequestedReschedule: reschedule failed', {
      visitId: visit.id,
      error: result.error,
    });
    return null;
  }

  await clearStaffRescheduleRequest(input.leadId);

  await prisma.pendingAction.updateMany({
    where: {
      status: 'awaiting',
      actionType: 'attendance_reschedule_awaiting_customer',
      actionParams: { path: ['visitId'], equals: visit.id },
    },
    data: { status: 'confirmed', resolvedAt: new Date() },
  });

  const propertyName = visit.property?.name ?? 'Property';
  const customerReply = formatBuyerVisitScheduled(
    scheduledAt,
    propertyName,
    visit.agent?.name ?? null,
    'rescheduled',
  );

  const agentId = request.staff_reschedule_agent_id ?? visit.agent?.id;
  if (agentId) {
    const agent = visit.agent?.id === agentId
      ? visit.agent
      : await prisma.user.findUnique({ where: { id: agentId }, select: { phone: true, name: true } });
    if (agent?.phone) {
      const { whatsappService } = await import('./whatsapp.service');
      await whatsappService.sendCompanyTextMessage(
        agent.phone,
        [
          `✅ *Visit rescheduled*`,
          '',
          `Customer: *${visit.lead?.customerName ?? 'Buyer'}*`,
          `Property: *${propertyName}*`,
          `New time: *${formatISTDateTimeLong(scheduledAt)}*`,
        ].join('\n'),
        input.companyId,
      ).catch(() => undefined);
    }
  }

  void logAgentAction({
    companyId: input.companyId,
    triggeredBy: 'inbound_message',
    action: 'attendance_reschedule_completed',
    resourceType: 'visit',
    resourceId: visit.id,
    status: 'success',
    result: `Visit rescheduled to ${scheduledAt.toISOString()} from staff attendance flow`,
  });

  return {
    committed: true,
    mode: 'rescheduled',
    scheduledAt,
    visitId: visit.id,
    customerReply,
    leadStatus: 'visit_scheduled',
  };
}
