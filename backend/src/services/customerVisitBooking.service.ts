import prisma from '../config/prisma';
import logger from '../config/logger';
import { assignLeadRoundRobin } from './leadAssignment.service';
import {
  isShortVisitConfirmation,
  isVisitCancelOrRescheduleMessage,
  isVisitSchedulingMessage,
  parseVisitDateTimeFromHistory,
  parseVisitDateTimeFromMessage,
} from './visitIntentFromMessage.service';
import { applyVisitMutationFromChat } from './visitMutationFromChat.service';
import { scheduleVisit } from './visitBooking.service';
import { createVisitApprovalRequest } from './visitPendingApproval.service';

export interface CommitCustomerVisitInput {
  companyId: string;
  lead: {
    id: string;
    assignedAgentId: string | null;
    customerName: string | null;
    status: string;
  };
  conversation: {
    id: string;
    selectedPropertyId: string | null;
    proposedVisitTime: Date | null;
    recommendedPropertyIds?: unknown;
  };
  customerMessage: string;
  customerPhone: string;
  recentCustomerMessages: string[];
}

export interface CommitCustomerVisitResult {
  committed: boolean;
  mode?: 'scheduled' | 'pending_approval' | 'already_booked' | 'rescheduled' | 'cancelled';
  scheduledAt?: Date;
  visitId?: string;
  customerReply?: string;
  leadStatus?: 'visit_scheduled' | 'contacted';
}

function resolvePropertyId(
  companyId: string,
  conversation: CommitCustomerVisitInput['conversation'],
  message: string,
): Promise<string | null> {
  if (conversation.selectedPropertyId) {
    return Promise.resolve(conversation.selectedPropertyId);
  }

  const recommended = Array.isArray(conversation.recommendedPropertyIds)
    ? (conversation.recommendedPropertyIds as string[])
    : [];

  if (recommended.length === 1) {
    return Promise.resolve(recommended[0]);
  }

  const lower = message.toLowerCase();
  return prisma.property
    .findMany({
      where: { companyId, status: 'available' },
      select: { id: true, name: true },
      take: 50,
    })
    .then((rows) => {
      const hit = rows.find((p) => p.name && lower.includes(p.name.toLowerCase().slice(0, 12)));
      if (hit) return hit.id;
      if (recommended.length > 0) return recommended[0];
      return rows[0]?.id ?? null;
    });
}

function resolveScheduledAt(
  message: string,
  proposedVisitTime: Date | null,
  recentCustomerMessages: string[],
): Date | null {
  const fromMessage = parseVisitDateTimeFromMessage(message);
  if (fromMessage) return fromMessage;

  if (isShortVisitConfirmation(message) && proposedVisitTime) {
    return proposedVisitTime;
  }

  return parseVisitDateTimeFromHistory(recentCustomerMessages);
}

function formatVisitConfirmation(
  scheduledAt: Date,
  propertyName: string,
  agentName: string | null,
): string {
  const when = scheduledAt.toLocaleString('en-IN', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    `✅ *Visit scheduled*\n\n` +
    `📍 *${propertyName}*\n` +
    `📅 ${when}\n\n` +
    `Our specialist${agentName ? ` *${agentName}*` : ''} will call you about an hour before the visit to confirm. See you then!`
  );
}

function formatVisitRescheduled(
  scheduledAt: Date,
  propertyName: string,
  agentName: string | null,
): string {
  const when = scheduledAt.toLocaleString('en-IN', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    `✅ *Visit rescheduled*\n\n` +
    `📍 *${propertyName}*\n` +
    `📅 ${when}\n\n` +
    `Our specialist${agentName ? ` *${agentName}*` : ''} will call you about an hour before the visit to confirm. See you then!`
  );
}

async function findUpcomingLeadVisit(companyId: string, leadId: string) {
  return prisma.visit.findFirst({
    where: {
      companyId,
      leadId,
      status: { in: ['scheduled', 'confirmed'] },
      scheduledAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    },
    orderBy: { scheduledAt: 'asc' },
    include: { property: { select: { name: true } }, agent: { select: { name: true } } },
  });
}

/**
 * Books a site visit in CRM when the customer proposes a concrete date/time.
 * WhatsApp auto-confirm is on unless WHATSAPP_AUTO_CONFIRM_VISITS=0.
 */
export async function tryCustomerVisitCancelReschedule(
  input: CommitCustomerVisitInput,
): Promise<CommitCustomerVisitResult> {
  const mutation = await applyVisitMutationFromChat({
    companyId: input.companyId,
    message: input.customerMessage,
    leadId: input.lead.id,
  });
  if (!mutation.handled) return { committed: false };
  return {
    committed: true,
    mode: mutation.mode ?? 'rescheduled',
    scheduledAt: mutation.scheduledAt,
    visitId: mutation.visitId,
    customerReply: mutation.reply,
    leadStatus: mutation.mode === 'cancelled' ? 'contacted' : 'visit_scheduled',
  };
}

export async function tryCommitCustomerVisitBooking(
  input: CommitCustomerVisitInput,
): Promise<CommitCustomerVisitResult> {
  const { companyId, lead, conversation, customerMessage, customerPhone, recentCustomerMessages } =
    input;

  if (isVisitCancelOrRescheduleMessage(customerMessage)) {
    return tryCustomerVisitCancelReschedule(input);
  }

  if (!isVisitSchedulingMessage(customerMessage) && !isShortVisitConfirmation(customerMessage)) {
    return { committed: false };
  }

  const scheduledAt = resolveScheduledAt(
    customerMessage,
    conversation.proposedVisitTime,
    recentCustomerMessages,
  );
  if (!scheduledAt) {
    return { committed: false };
  }

  const propertyId = await resolvePropertyId(companyId, conversation, customerMessage);
  if (!propertyId) {
    logger.warn('Visit commit skipped: no property', { leadId: lead.id, conversationId: conversation.id });
    return { committed: false };
  }

  const existing = await prisma.visit.findFirst({
    where: {
      companyId,
      leadId: lead.id,
      propertyId,
      status: { in: ['scheduled', 'confirmed'] },
      scheduledAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
    orderBy: { scheduledAt: 'asc' },
  });
  if (existing && !isVisitCancelOrRescheduleMessage(customerMessage)) {
    const proposedNew = parseVisitDateTimeFromMessage(customerMessage);
    if (
      proposedNew
      && Math.abs(proposedNew.getTime() - existing.scheduledAt.getTime()) > 60_000
    ) {
      const mutation = await applyVisitMutationFromChat({
        companyId,
        message: customerMessage,
        leadId: lead.id,
      });
      if (mutation.handled && mutation.reply) {
        return {
          committed: true,
          mode: mutation.mode ?? 'rescheduled',
          scheduledAt: mutation.scheduledAt,
          visitId: mutation.visitId,
          customerReply: mutation.reply,
          leadStatus: mutation.mode === 'cancelled' ? 'contacted' : 'visit_scheduled',
        };
      }
    }
    const property = await prisma.property.findUnique({ where: { id: propertyId }, select: { name: true } });
    return {
      committed: true,
      mode: 'already_booked',
      scheduledAt: existing.scheduledAt,
      visitId: existing.id,
      customerReply: formatVisitConfirmation(existing.scheduledAt, property?.name || 'Property', null),
      leadStatus: 'visit_scheduled',
    };
  }

  let agentId = lead.assignedAgentId;
  if (!agentId) {
    agentId = await assignLeadRoundRobin(companyId);
    if (agentId) {
      await prisma.lead.update({ where: { id: lead.id }, data: { assignedAgentId: agentId } });
    }
  }
  if (!agentId) {
    return { committed: false };
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, companyId },
    select: { name: true },
  });

  const autoConfirm = process.env.WHATSAPP_AUTO_CONFIRM_VISITS !== '0';

  if (autoConfirm) {
    const booking = await scheduleVisit({
      companyId,
      leadId: lead.id,
      propertyId,
      scheduledAt,
      notes: 'Booked via WhatsApp customer message',
      agentId,
    });

    if (booking.success && booking.visit) {
      const agent = await prisma.user.findUnique({ where: { id: agentId }, select: { name: true } });
      return {
        committed: true,
        mode: 'scheduled',
        scheduledAt: booking.visit.scheduledAt,
        visitId: booking.visit.id,
        customerReply: formatVisitConfirmation(
          booking.visit.scheduledAt,
          property?.name || 'Property',
          agent?.name ?? null,
        ),
        leadStatus: 'visit_scheduled',
      };
    }

    if (booking.error === 'agent_conflict') {
      await createVisitApprovalRequest({
        companyId,
        leadId: lead.id,
        propertyId,
        scheduledAt,
        agentId,
        conversationId: conversation.id,
        customerPhone,
        customerName: lead.customerName,
        propertyName: property?.name,
      });
      return {
        committed: true,
        mode: 'pending_approval',
        scheduledAt,
        customerReply:
          `Thanks! That time may overlap with another visit — I've sent the slot to our specialist for quick confirmation. You'll get a WhatsApp update shortly.`,
        leadStatus: 'contacted',
      };
    }

    logger.warn('Visit auto-book failed', { leadId: lead.id, error: booking.error });
    return { committed: false };
  }

  await createVisitApprovalRequest({
    companyId,
    leadId: lead.id,
    propertyId,
    scheduledAt,
    agentId,
    conversationId: conversation.id,
    customerPhone,
    customerName: lead.customerName,
    propertyName: property?.name,
  });

  return {
    committed: true,
    mode: 'pending_approval',
    scheduledAt,
    customerReply:
      `Thanks! I've shared your preferred visit time with our sales specialist. You'll receive WhatsApp confirmation once they approve the slot.`,
    leadStatus: 'contacted',
  };
}
