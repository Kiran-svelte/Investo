import prisma from '../config/prisma';
import logger from '../config/logger';
import { assignLeadRoundRobin } from './leadAssignment.service';
import {
  isShortVisitConfirmation,
  isVisitCancelOrRescheduleMessage,
  isVisitSchedulingMessage,
  parseRescheduleTargetFromMessage,
  parseVisitDateTimeFromHistory,
  parseVisitDateTimeFromMessage,
} from './visitIntentFromMessage.service';
import { applyVisitMutationFromChat } from './visitMutationFromChat.service';
import {
  cancelPendingVisitApprovalForBuyer,
  createVisitApprovalRequest,
  findPendingVisitApprovalForLead,
  notifyAgentVisitChangeRequested,
  reschedulePendingVisitApprovalForBuyer,
} from './visitPendingApproval.service';
import { resolveBuyerPropertyReference } from './buyerPropertyContext.service';
import { formatBuyerVisitScheduled, formatBuyerVisitPendingApproval } from '../utils/visitFormat.util';
import { isConversationAwaitingCallTime } from '../utils/conversationCallContext.util';
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

const formatVisitConfirmation = (scheduledAt: Date, propertyName: string, agentName: string | null) =>
  formatBuyerVisitScheduled(scheduledAt, propertyName, agentName, 'scheduled');
/**
 * Handles customer cancel / reschedule requests (buyer WhatsApp).
 */
export async function tryCustomerVisitCancelReschedule(
  input: CommitCustomerVisitInput,
): Promise<CommitCustomerVisitResult> {
  const pendingApproval = await findPendingVisitApprovalForLead({
    companyId: input.companyId,
    leadId: input.lead.id,
  });
  if (pendingApproval) {
    if (/\b(cancel|call\s+off)\b/i.test(input.customerMessage)) {
      const cancelled = await cancelPendingVisitApprovalForBuyer({
        companyId: input.companyId,
        leadId: input.lead.id,
      });
      if (cancelled.handled) {
        return {
          committed: true,
          mode: 'cancelled',
          customerReply: cancelled.reply,
          leadStatus: 'contacted',
        };
      }
    }

    const newScheduledAt =
      parseRescheduleTargetFromMessage(input.customerMessage)
      ?? parseVisitDateTimeFromMessage(input.customerMessage);
    if (!newScheduledAt) {
      return {
        committed: true,
        mode: 'pending_approval',
        scheduledAt: new Date(pendingApproval.scheduledAt),
        customerReply:
          `Your visit request is still waiting for team approval.\n\n` +
          `Send the new date and time you prefer, or reply *cancel visit* to cancel this request.`,
        leadStatus: 'contacted',
      };
    }
    const rescheduled = await reschedulePendingVisitApprovalForBuyer({
      companyId: input.companyId,
      leadId: input.lead.id,
      scheduledAt: newScheduledAt,
    });
    if (rescheduled.handled) {
      return {
        committed: true,
        mode: 'pending_approval',
        scheduledAt: rescheduled.scheduledAt,
        customerReply: rescheduled.reply,
        leadStatus: 'contacted',
      };
    }
  }

  const confirmedVisit = await prisma.visit.findFirst({
    where: {
      companyId: input.companyId,
      leadId: input.lead.id,
      status: 'confirmed',
      scheduledAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
    orderBy: { scheduledAt: 'asc' },
    select: { id: true },
  });
  if (confirmedVisit) {
    await notifyAgentVisitChangeRequested({
      companyId: input.companyId,
      leadId: input.lead.id,
      visitId: confirmedVisit.id,
      messageText: input.customerMessage,
    });
    return {
      committed: true,
      mode: 'already_booked',
      visitId: confirmedVisit.id,
      customerReply:
        `Your visit is already confirmed, so I won't change it automatically.\n\n` +
        `I've notified the team with your request. They will help you with the change.`,
      leadStatus: 'visit_scheduled',
    };
  }

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

  const conversationRow = await prisma.conversation.findUnique({
    where: { id: conversation.id },
    select: { commitments: true, stage: true },
  });
  const visitSchedulingContext = {
    awaitingCallTime: isConversationAwaitingCallTime(conversationRow?.commitments),
    visitBookingStage: conversationRow?.stage === 'visit_booking',
  };

  if (
    !isVisitSchedulingMessage(customerMessage, visitSchedulingContext)
    && !isShortVisitConfirmation(customerMessage)
  ) {
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

  let propertyId = await resolvePropertyId(companyId, conversation, customerMessage);

  if (!propertyId) {
    // Buyer said "book visit tuesday 2pm" without specifying a property.
    // Fall back to the first active property for this company so the booking
    // always proceeds instead of silently falling through to the LLM chat path.
    const fallbackProperty = await prisma.property.findFirst({
      where: { companyId, status: { in: ['available', 'upcoming'] } },

      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!fallbackProperty) {
      logger.warn('Visit commit skipped: no property resolved and no active fallback property', {
        leadId: lead.id,
        conversationId: conversation.id,
      });
      return { committed: false };
    }

    logger.info('Visit commit: no property in conversation context, using fallback active property', {
      leadId: lead.id,
      propertyId: fallbackProperty.id,
    });
    propertyId = fallbackProperty.id;
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
    suppressCustomerMessage: true,
  });

  return {
    committed: true,
    mode: 'pending_approval',
    scheduledAt,
    customerReply: formatBuyerVisitPendingApproval(),
    leadStatus: 'contacted',
  };
}
