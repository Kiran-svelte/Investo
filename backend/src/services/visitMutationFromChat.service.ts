import prisma from '../config/prisma';
import logger from '../config/logger';
import { formatDateIST, getISTDayBounds, getTomorrowIST } from './agent/tools/format-helpers';
import { notificationEngine } from './notification.engine';
import {
  isVisitCancelOrRescheduleMessage,
  isVisitListQueryMessage,
  messageReferencesVisitTomorrow,
  parseRescheduleTargetFromMessage,
} from './visitIntentFromMessage.service';

export interface VisitMutationFromChatInput {
  companyId: string;
  message: string;
  /** Buyer flow: restrict to this lead's visits */
  leadId?: string;
  /** Agent copilot: sales-agent / company scope filter */
  visitScope?: Record<string, unknown>;
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
    return `Visit cancelled.\n\n${customerName ?? 'Customer'} — ${propertyName}\n${when}`;
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
    `✅ *${title}*\n\n` +
    `📍 *${propertyName}*\n` +
    `📅 ${when}\n\n` +
    `Our team will confirm details before the visit. See you then!`
  );
}

async function findTargetVisit(input: VisitMutationFromChatInput) {
  const baseWhere: Record<string, unknown> = {
    companyId: input.companyId,
    status: { in: ['scheduled', 'confirmed'] },
    ...(input.leadId ? { leadId: input.leadId } : {}),
    ...(input.visitScope ?? {}),
  };

  if (messageReferencesVisitTomorrow(input.message)) {
    const [start, end] = getISTDayBounds(getTomorrowIST());
    const visit = await prisma.visit.findFirst({
      where: { ...baseWhere, scheduledAt: { gte: start, lte: end } },
      orderBy: { scheduledAt: 'asc' },
      include: {
        property: { select: { name: true } },
        lead: { select: { id: true, customerName: true, phone: true } },
      },
    });
    if (visit) return visit;
  }

  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  return prisma.visit.findFirst({
    where: { ...baseWhere, scheduledAt: { gte: cutoff } },
    orderBy: { scheduledAt: 'asc' },
    include: {
      property: { select: { name: true } },
      lead: { select: { id: true, customerName: true, phone: true } },
    },
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
    await prisma.visit.update({
      where: { id: visit.id },
      data: { status: 'cancelled', notes: 'Cancelled via WhatsApp' },
    });
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

  const oldTime = visit.scheduledAt;
  const updated = await prisma.visit.update({
    where: { id: visit.id },
    data: { scheduledAt: newScheduledAt, reminderSent: false, status: 'scheduled' },
    include: { property: { select: { name: true } }, lead: true },
  });

  try {
    const company = await prisma.company.findUnique({ where: { id: input.companyId } });
    if (company && visit.lead) {
      await notificationEngine.onVisitRescheduled(
        updated,
        oldTime,
        newScheduledAt,
        visit.lead,
        company,
      );
    }
  } catch (err: unknown) {
    logger.warn('Visit reschedule notification failed', {
      visitId: visit.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (visit.leadId) {
    void import('./clientMemory.service').then(({ syncLeadClientMemory }) =>
      syncLeadClientMemory(visit.leadId),
    );
  }

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
