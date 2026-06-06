import prisma from '../config/prisma';
import logger from '../config/logger';
import { formatDateIST, getISTDayBounds, getTomorrowIST } from './agent/tools/format-helpers';
import { cancelVisitById, rescheduleVisitById } from './visitState.service';
import {
  isVisitCancelOrRescheduleMessage,
  isVisitListQueryMessage,
  messageReferencesVisitTomorrow,
  parseRescheduleTargetFromMessage,
  extractReferencedDayFromMessage,
  getISTDateBoundsForDow,
} from './visitIntentFromMessage.service';

export interface VisitMutationFromChatInput {
  companyId: string;
  message: string;
  /** Buyer flow: restrict to this lead's visits */
  leadId?: string;
  /** Agent copilot: sales-agent / company scope filter */
  visitScope?: Record<string, unknown>;
  /**
   * When true, skips the WhatsApp confirmation sent to the customer by
   * notificationEngine.onVisitRescheduled(). Set this when the customer
   * themselves triggered the reschedule — the main handler already sends
   * the visitCommit.customerReply, so a second notification is a duplicate.
   */
  suppressCustomerNotification?: boolean;
}

export interface VisitMutationFromChatResult {
  handled: boolean;
  mode?: 'rescheduled' | 'cancelled';
  visitId?: string;
  scheduledAt?: Date;
  reply?: string;
}

function istReferenceAnchor(): Date {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
  return new Date(`${today}T12:00:00+05:30`);
}

function formatAgentMutationReply(
  propertyName: string,
  scheduledAt: Date,
  mode: 'rescheduled' | 'cancelled',
  customerName?: string | null,
): string {
  const when = formatDateIST(scheduledAt);
  if (mode === 'cancelled') {
    return `Visit cancelled.\n\n${customerName ?? 'Customer'} - ${propertyName}\n${when}`;
  }
  return `Visit rescheduled.\n\n${propertyName}\n${when}`;
}

function formatCustomerVisitConfirmation(
  scheduledAt: Date,
  propertyName: string,
  prefix: 'rescheduled' | 'scheduled' | 'cancelled',
): string {
  const when = scheduledAt.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  if (prefix === 'cancelled') {
    return (
      `Your site visit for *${propertyName}* (${when}) has been *cancelled*.\n\n` +
      `Reply with a new date and time if you'd like to book again.`
    );
  }
  const title = prefix === 'rescheduled' ? 'Visit rescheduled' : 'Visit scheduled';
  return (
    `*${title}*\n\n` +
    `Property: *${propertyName}*\n` +
    `Date: ${when}\n\n` +
    `Our team will confirm details before the visit. See you then!`
  );
}
/**
 * Find the visit the user intends to mutate (cancel or reschedule).
 *
 * Priority order:
 * 1. If message references a specific named day ("sunday visit", "saturday appointment"),
 *    filter visits to that day's IST bounds. This ensures "prepone sunday visit" picks
 *    the Sunday visit, not an earlier Saturday visit.
 * 2. If message references "tomorrow", filter to tomorrow's IST bounds.
 * 3. Fallback: earliest upcoming visit within the next 7 days.
 *
 * @param input - Mutation input with companyId, message, leadId, visitScope
 * @returns Matching visit with property and lead data, or null
 */
async function findTargetVisit(input: VisitMutationFromChatInput) {
  const baseWhere: Record<string, unknown> = {
    companyId: input.companyId,
    status: { in: ['scheduled', 'confirmed'] },
    ...(input.leadId ? { leadId: input.leadId } : {}),
    ...(input.visitScope ?? {}),
  };

  const includeShape = {
    property: { select: { name: true } },
    lead: { select: { id: true, customerName: true, phone: true } },
  } as const;

  // Step 1: Named day-of-week reference ("this sunday", "saturday", "today", "tomorrow")
  // Parse the FIRST day token as the source visit, not the last (which is the new time).
  const referencedDow = extractReferencedDayFromMessage(input.message);
  if (referencedDow !== null) {
    const [start, end] = getISTDateBoundsForDow(referencedDow);
    const visit = await prisma.visit.findFirst({
      where: { ...baseWhere, scheduledAt: { gte: start, lte: end } },
      orderBy: { scheduledAt: 'asc' },
      include: includeShape,
    });
    if (visit) {
      logger.debug('findTargetVisit: matched by day-of-week', {
        dow: referencedDow, start, end, visitId: visit.id,
      });
      return visit;
    }
    // Day was mentioned but no visit on that day — try "tomorrow" special case below
  }

  // Step 2: "Tomorrow's visit" or "visit tomorrow"
  if (messageReferencesVisitTomorrow(input.message)) {
    const [start, end] = getISTDayBounds(getTomorrowIST());
    const visit = await prisma.visit.findFirst({
      where: { ...baseWhere, scheduledAt: { gte: start, lte: end } },
      orderBy: { scheduledAt: 'asc' },
      include: includeShape,
    });
    if (visit) return visit;
  }

  // Step 3: Fallback — earliest upcoming visit (within 7 days to avoid matching distant future)
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const maxLookahead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return prisma.visit.findFirst({
    where: { ...baseWhere, scheduledAt: { gte: cutoff, lte: maxLookahead } },
    orderBy: { scheduledAt: 'asc' },
    include: includeShape,
  });
}

function wantsCancelOnly(message: string, hasNewTime: boolean): boolean {
  if (hasNewTime) return false;
  return (
    /\b(cancel|call\s+off)\b/i.test(message)
    && !/\breschedule|re-?schedule|move\s+to|change\s+to|pre\s*pone|prepone\b/i.test(message)
  );
}

/**
 * Cancels any existing reminder jobs for the given visitId and enqueues
 * fresh ones for the new scheduledAt. Called fire-and-forget after a reschedule.
 * Safe to fail: logged as warn, never throws.
 */
async function rescheduleVisitRemindersAfterMutation(
  visitId: string,
  newScheduledAt: Date,
  companyId: string,
  leadId: string | null,
): Promise<void> {
  try {
    const { automationQueueService } = await import('./automationQueue.service');
    const payload = { visitId, leadId, companyId };

    // Cancel existing reminder jobs so the new NX schedule() calls succeed.
    await automationQueueService.cancel('visit_reminder_24h', visitId);
    await automationQueueService.cancel('visit_reminder_1h', visitId);

    // Enqueue fresh reminders for the rescheduled time.
    const at24h = new Date(newScheduledAt.getTime() - 24 * 60 * 60 * 1000);
    const at1h  = new Date(newScheduledAt.getTime() -      60 * 60 * 1000);
    if (at24h > new Date()) {
      await automationQueueService.schedule('visit_reminder_24h', visitId, at24h, payload);
    }
    if (at1h > new Date()) {
      await automationQueueService.schedule('visit_reminder_1h', visitId, at1h, payload);
    }
    logger.info('Visit reminders rescheduled', { visitId, newScheduledAt, at24h, at1h });
  } catch (err: unknown) {
    logger.warn('rescheduleVisitRemindersAfterMutation failed', {
      visitId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Deterministic cancel / reschedule for WhatsApp (buyer + agent Zero UI).
 */
export async function applyVisitMutationFromChat(
  input: VisitMutationFromChatInput,
): Promise<VisitMutationFromChatResult> {
  const message = input.message.trim();
  if (!message || isVisitListQueryMessage(message) || !isVisitCancelOrRescheduleMessage(message)) {
    return { handled: false };
  }

  const reference = istReferenceAnchor();
  const newScheduledAt = parseRescheduleTargetFromMessage(message, reference);
  const cancelOnly = wantsCancelOnly(message, Boolean(newScheduledAt));

  const visit = await findTargetVisit(input);
  if (!visit) {
    return {
      handled: true,
      reply:
        "I couldn't find an upcoming site visit to change. Reply with the property name or book a new visit with your preferred date and time.",
    };
  }

  const propertyName = visit.property?.name ?? 'Property';
  const forAgent = Boolean(input.visitScope);

  if (cancelOnly) {
    const result = await cancelVisitById({
      companyId: input.companyId,
      visitId: visit.id,
      notes: 'Cancelled via WhatsApp',
    });
    if (!result.success) {
      return {
        handled: true,
        reply: "I couldn't cancel that visit. Please ask an agent to help.",
      };
    }
    return {
      handled: true,
      mode: 'cancelled',
      visitId: visit.id,
      reply: forAgent
        ? formatAgentMutationReply(propertyName, visit.scheduledAt, 'cancelled', visit.lead?.customerName)
        : formatCustomerVisitConfirmation(visit.scheduledAt, propertyName, 'cancelled'),
    };
  }

  if (!newScheduledAt) {
    return {
      handled: true,
      reply:
        `I found your visit for *${propertyName}* on ${visit.scheduledAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}. What date and time should we move it to? (e.g. "this Saturday 1 pm")`,
    };
  }

  if (newScheduledAt <= new Date()) {
    return {
      handled: true,
      reply: 'That time is in the past. Please send a future date and time (e.g. "this Saturday 1 pm").',
    };
  }

  const result = await rescheduleVisitById({
    companyId: input.companyId,
    visitId: visit.id,
    scheduledAt: newScheduledAt,
    suppressCustomerNotification: Boolean(input.suppressCustomerNotification),
  });
  if (!result.success) {
    return {
      handled: true,
      reply: "I couldn't reschedule that visit. Please send another future date and time.",
    };
  }
  const updated = result.visit;
  /*

  try {
    const company = await prisma.company.findUnique({ where: { id: input.companyId } });
    if (company && visit.lead) {
      await notificationEngine.onVisitRescheduled(
        updated,
        oldTime,
        newScheduledAt,
        visit.lead,
        company,
        // Suppress the duplicate customer WhatsApp when the customer themselves
        // triggered the reschedule — the caller (whatsapp.service.ts) already
        // sends visitCommit.customerReply as the primary response.
        Boolean(input.suppressCustomerNotification),
      );
    }
  } catch (err: unknown) {
    logger.warn('Visit reschedule notification failed', {
      visitId: visit.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  */

  if (visit.leadId) {
    void import('./clientMemory.service').then(({ syncLeadClientMemory }) =>
      syncLeadClientMemory(visit.leadId),
    );
  }

  // Cancel old reminder jobs and schedule new ones for the updated time.
  // The automationQueueService uses NX (set-if-not-exists) with the visitId
  // as uniqueKey, so old jobs must be cleared before new ones are enqueued.
  void rescheduleVisitRemindersAfterMutation(visit.id, newScheduledAt, updated.companyId, visit.leadId);

  return {
    handled: true,
    mode: 'rescheduled',
    visitId: visit.id,
    scheduledAt: newScheduledAt,
    reply: forAgent
      ? formatAgentMutationReply(
          updated.property?.name ?? propertyName,
          newScheduledAt,
          'rescheduled',
          visit.lead?.customerName,
        )
      : formatCustomerVisitConfirmation(
          newScheduledAt,
          updated.property?.name ?? propertyName,
          'rescheduled',
        ),
  };
}
