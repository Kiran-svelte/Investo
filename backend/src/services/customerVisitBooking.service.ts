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
import { buildVisitIdempotencyKey, scheduleVisit } from './visitBooking.service';
import { createVisitApprovalRequest } from './visitPendingApproval.service';
import { resolveBuyerPropertyReference } from './buyerPropertyContext.service';
import type { WorkflowId } from '../constants/workflow.constants';
import type { WorkflowParams } from './workflow/workflow.types';

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
    /** May be stale; always refreshed from DB before use. */
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
  /** When set, caller should run workflow instead of inline DB writes. */
  workflowSuggestion?: { workflowId: WorkflowId; parameters: WorkflowParams };
}

/**
 * Fetches the latest proposedVisitTime from DB.
 * Avoids stale in-memory conversation object causing duplicate bookings
 * when a reschedule updates the DB but the caller still holds the old object.
 */
async function refreshProposedVisitTime(conversationId: string): Promise<Date | null> {
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { proposedVisitTime: true },
  });
  return row?.proposedVisitTime ?? null;
}

/**
 * Returns true when the conversation has a confirmed visit slot, i.e. the
 * stage is 'confirmation' OR commitments.visitSlotConfirmed is set.
 * Used to guard against short confirmations ("okay", "yes") re-triggering a
 * booking after a reschedule has already been committed.
 */
async function isVisitAlreadyConfirmed(conversationId: string): Promise<boolean> {
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { stage: true, commitments: true },
  });
  if (!row) return false;
  if (row.stage === 'confirmation') return true;
  const c = row.commitments as Record<string, unknown> | null;
  return Boolean(c?.visitSlotConfirmed);
}

function resolvePropertyId(
  companyId: string,
  conversation: CommitCustomerVisitInput['conversation'],
  message: string,
): Promise<string | null> {
  const recommended = Array.isArray(conversation.recommendedPropertyIds)
    ? (conversation.recommendedPropertyIds as string[])
    : [];

  return resolveBuyerPropertyReference({
    companyId,
    messageText: message,
    selectedPropertyId: conversation.selectedPropertyId,
    recommendedPropertyIds: recommended,
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
    timeZone: 'Asia/Kolkata',
  });
  return (
    `*Visit scheduled*\n\n` +
    `Property: *${propertyName}*\n` +
    `Date: ${when}\n\n` +
    `Our specialist${agentName ? ` *${agentName}*` : ''} will call you about an hour before the visit to confirm. See you then!`
  );
}
/**
 * Handles customer cancel / reschedule requests (buyer WhatsApp).
 */
export async function tryCustomerVisitCancelReschedule(
  input: CommitCustomerVisitInput,
): Promise<CommitCustomerVisitResult> {
  const mutation = await applyVisitMutationFromChat({
    companyId: input.companyId,
    message: input.customerMessage,
    leadId: input.lead.id,
    // Customer initiated this reschedule via WhatsApp. The main handler sends
    // visitCommit.customerReply as the primary response. Suppress the duplicate
    // WhatsApp confirmation that notificationEngine.onVisitRescheduled would otherwise send.
    suppressCustomerNotification: true,
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

/** Dedup window: two resolvedAt values within 5 minutes are considered the same slot. */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Books a site visit in CRM when the customer proposes a concrete date/time.
 *
 * FIX (double-booking after reschedule):
 *   1. proposedVisitTime is always re-fetched from DB so a stale in-memory
 *      conversation object does not cause the old date to be re-booked.
 *   2. Short confirmations ("okay", "yes", "sure") are rejected when the
 *      conversation already has a confirmed visit slot (stage='confirmation'
 *      or commitments.visitSlotConfirmed=true).
 *   3. A 5-minute dedupe window prevents creating a second booking when the
 *      resolved scheduledAt matches an existing confirmed visit.
 */
export async function tryCommitCustomerVisitBooking(
  input: CommitCustomerVisitInput,
): Promise<CommitCustomerVisitResult> {
  const { companyId, lead, conversation, customerMessage, customerPhone, recentCustomerMessages } =
    input;

  if (isVisitCancelOrRescheduleMessage(customerMessage)) {
    const activeVisit = await prisma.visit.findFirst({
      where: {
        companyId,
        leadId: lead.id,
        status: { in: ['scheduled', 'confirmed'] },
        scheduledAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
      orderBy: { scheduledAt: 'asc' },
      select: { id: true },
    });
    if (activeVisit && process.env.BUYER_VISIT_WORKFLOW_ENABLED !== '0') {
      const workflowId: WorkflowId = /\b(cancel|call\s+off)\b/i.test(customerMessage)
        ? 'cancel_visit'
        : 'reschedule_visit';
      const scheduledAt = parseVisitDateTimeFromMessage(customerMessage);
      return {
        committed: false,
        workflowSuggestion: {
          workflowId,
          parameters: {
            leadId: lead.id,
            visitId: activeVisit.id,
            newScheduledAt: scheduledAt?.toISOString(),
            scheduledAt: scheduledAt?.toISOString(),
            message: customerMessage,
          },
        },
      };
    }
    return tryCustomerVisitCancelReschedule(input);
  }

  if (!isVisitSchedulingMessage(customerMessage) && !isShortVisitConfirmation(customerMessage)) {
    return { committed: false };
  }

  // Guard: never re-book on a short confirmation when a visit was already confirmed.
  // This is the primary fix for the "Okay → old Saturday booking" bug.
  if (isShortVisitConfirmation(customerMessage)) {
    const alreadyConfirmed = await isVisitAlreadyConfirmed(conversation.id);
    if (alreadyConfirmed) {
      logger.info('Short confirmation skipped; visit already confirmed, not re-booking', {
        conversationId: conversation.id,
        message: customerMessage,
      });
      return { committed: false };
    }
  }

  // Always load fresh proposedVisitTime from DB; the conversation object passed
  // by the caller may be stale from before a reschedule committed.
  const freshProposedVisitTime = await refreshProposedVisitTime(conversation.id);

  const scheduledAt = resolveScheduledAt(
    customerMessage,
    freshProposedVisitTime,
    recentCustomerMessages,
  );
  if (!scheduledAt) {
    return { committed: false };
  }

  const propertyId = await resolvePropertyId(companyId, conversation, customerMessage);
  if (!propertyId) {
    logger.warn('Visit commit skipped: no property resolved', {
      leadId: lead.id,
      conversationId: conversation.id,
    });
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
    const timeDiffFromProposed = proposedNew
      ? Math.abs(proposedNew.getTime() - existing.scheduledAt.getTime())
      : 0;

    if (proposedNew && timeDiffFromProposed > 60_000) {
      // Customer wants a different time; route to reschedule.
      const mutation = await applyVisitMutationFromChat({
        companyId,
        message: customerMessage,
        leadId: lead.id,
        // Customer initiated this reschedule via WhatsApp; suppress duplicate notification.
        suppressCustomerNotification: true,
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

    // Dedupe: resolved time matches the existing visit (within 5 min); skip silently.
    const resolvedDiff = Math.abs(scheduledAt.getTime() - existing.scheduledAt.getTime());
    if (resolvedDiff <= DEDUPE_WINDOW_MS) {
      logger.info('Visit dedupe: resolved time matches existing visit, skipping re-booking', {
        leadId: lead.id,
        existingVisitId: existing.id,
        existingScheduledAt: existing.scheduledAt,
        resolvedScheduledAt: scheduledAt,
      });
      return { committed: false };
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { name: true },
    });
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

  if (autoConfirm && process.env.BUYER_VISIT_WORKFLOW_ENABLED !== '0') {
    return {
      committed: false,
      workflowSuggestion: {
        workflowId: 'schedule_visit',
        parameters: {
          leadId: lead.id,
          propertyId,
          scheduledAt: scheduledAt.toISOString(),
          message: customerMessage,
        },
      },
    };
  }

  if (autoConfirm) {
    const booking = await scheduleVisit({
      companyId,
      leadId: lead.id,
      propertyId,
      scheduledAt,
      notes: 'Booked via WhatsApp customer message',
      agentId,
      idempotencyKey: buildVisitIdempotencyKey(companyId, lead.id, scheduledAt.toISOString()),
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
          `Thanks! That time may overlap with another visit. I've sent the slot to our specialist for quick confirmation. You'll get a WhatsApp update shortly.`,
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
