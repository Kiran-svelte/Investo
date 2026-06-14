import prisma from '../config/prisma';
import type { Prisma } from '@prisma/client';
import config from '../config';
import logger from '../config/logger';
import { formatDateIST, getISTDayBounds, getTomorrowIST } from './agent/tools/format-helpers';
import { cancelVisitById, confirmVisitById, rescheduleVisitById } from './visitState.service';
import { formatBuyerVisitScheduled, formatBuyerVisitCancelled } from '../utils/visitFormat.util';
import { tBuyer, visitStatusLabel, resolveBuyerLanguage } from '../utils/buyerI18n.util';
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
  /** Buyer conversation id, used to persist visit disambiguation state. */
  conversationId?: string;
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
  mode?: 'rescheduled' | 'cancelled' | 'confirmed' | 'disambiguate';
  visitId?: string;
  scheduledAt?: Date;
  reply?: string;
}

type VisitMutationAction = 'confirm' | 'cancel' | 'reschedule';

type VisitDisambiguationPending = {
  kind: 'visit_disambiguation';
  candidateVisitIds: string[];
  action: VisitMutationAction;
  createdAt: string;
  newScheduledAt?: string;
};

type VisitWithProperty = {
  id: string;
  leadId?: string | null;
  status: string;
  scheduledAt: Date;
  property?: { name: string | null } | null;
  lead?: { id: string; customerName: string | null; phone: string | null } | null;
};

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
  if (prefix === 'cancelled') return formatBuyerVisitCancelled(scheduledAt, propertyName);
  return formatBuyerVisitScheduled(scheduledAt, propertyName, null, prefix);
}

function isVisitConfirmMutationMessage(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return /\b(confirm|confirmed)\b[\s\S]{0,80}\b(visit|site\s*visit|appointment|booking)\b/i.test(text)
    || /\b(visit|site\s*visit|appointment|booking)\b[\s\S]{0,80}\b(confirm|confirmed)\b/i.test(text);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function formatVisitOption(visit: VisitWithProperty, index: number): string {
  const propertyName = visit.property?.name ?? 'Property';
  return `${index + 1}. *${propertyName}* - ${formatDateIST(visit.scheduledAt)} (${visit.status})`;
}

function buildDisambiguationReply(
  candidates: VisitWithProperty[],
  action: VisitMutationAction,
  lang = 'en',
): string {
  const options = candidates.map((visit, index) =>
    tBuyer(lang, 'visit_disambiguate_option', {
      index: String(index + 1),
      property: visit.property?.name ?? 'Property',
      when: formatDateIST(visit.scheduledAt),
      status: visitStatusLabel(lang, visit.status),
    }),
  ).join('\n');

  return tBuyer(lang, 'visit_disambiguate_prompt', {
    count: String(candidates.length),
    options,
  });
}

function parseOrdinalSelection(message: string, max: number): number | null {
  const match = message.trim().match(/^(?:option\s*)?(\d{1,2})$/i);
  if (!match?.[1]) return null;
  const index = Number(match[1]);
  if (!Number.isInteger(index) || index < 1 || index > max) return null;
  return index - 1;
}

function getCommitmentsObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
}

function parsePendingDisambiguation(raw: unknown): VisitDisambiguationPending | null {
  const commitments = getCommitmentsObject(raw);
  const pending = commitments.visit_disambiguation;
  if (!pending || typeof pending !== 'object' || Array.isArray(pending)) return null;
  const row = pending as Partial<VisitDisambiguationPending>;
  if (row.kind !== 'visit_disambiguation') return null;
  if (!Array.isArray(row.candidateVisitIds) || row.candidateVisitIds.some((id) => typeof id !== 'string')) return null;
  if (!row.action || !['confirm', 'cancel', 'reschedule'].includes(row.action)) return null;
  if (!row.createdAt || Number.isNaN(new Date(row.createdAt).getTime())) return null;
  if (Date.now() - new Date(row.createdAt).getTime() > 30 * 60 * 1000) return null;
  return {
    kind: 'visit_disambiguation',
    candidateVisitIds: row.candidateVisitIds as string[],
    action: row.action,
    createdAt: row.createdAt,
    newScheduledAt: typeof row.newScheduledAt === 'string' ? row.newScheduledAt : undefined,
  };
}

async function savePendingDisambiguation(
  conversationId: string | undefined,
  candidates: VisitWithProperty[],
  action: VisitMutationAction,
  newScheduledAt: Date | null,
): Promise<void> {
  if (!conversationId) return;
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { commitments: true },
  }).catch(() => null);
  const commitments = getCommitmentsObject(row?.commitments);
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      commitments: {
        ...commitments,
        visit_disambiguation: {
          kind: 'visit_disambiguation',
          candidateVisitIds: candidates.map((v) => v.id),
          action,
          createdAt: new Date().toISOString(),
          ...(newScheduledAt ? { newScheduledAt: newScheduledAt.toISOString() } : {}),
        },
      } as Prisma.InputJsonValue,
    },
  }).catch(() => undefined);
}

async function clearPendingDisambiguation(conversationId: string | undefined): Promise<void> {
  if (!conversationId) return;
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { commitments: true },
  }).catch(() => null);
  const commitments = { ...getCommitmentsObject(row?.commitments) };
  delete commitments.visit_disambiguation;
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { commitments: commitments as Prisma.InputJsonValue },
  }).catch(() => undefined);
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

async function findCandidateVisits(input: VisitMutationFromChatInput): Promise<VisitWithProperty[]> {
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

  const byWindow = async (start: Date, end: Date) => prisma.visit.findMany({
    where: { ...baseWhere, scheduledAt: { gte: start, lte: end } },
    orderBy: { scheduledAt: 'asc' },
    include: includeShape,
  });

  const referencedDow = extractReferencedDayFromMessage(input.message);
  if (referencedDow !== null) {
    const [start, end] = getISTDateBoundsForDow(referencedDow);
    const dayMatches = await byWindow(start, end);
    if (dayMatches.length) return dayMatches;
  }

  if (messageReferencesVisitTomorrow(input.message)) {
    const [start, end] = getISTDayBounds(getTomorrowIST());
    const tomorrowMatches = await byWindow(start, end);
    if (tomorrowMatches.length) return tomorrowMatches;
  }

  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const maxLookahead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return prisma.visit.findMany({
    where: { ...baseWhere, scheduledAt: { gte: cutoff, lte: maxLookahead } },
    orderBy: { scheduledAt: 'asc' },
    include: includeShape,
    take: 10,
  });
}

function narrowCandidatesByPropertyName(candidates: VisitWithProperty[], message: string): VisitWithProperty[] {
  const normalized = normalizeText(message);
  const matched = candidates.filter((visit) => {
    const name = normalizeText(visit.property?.name ?? '');
    return name.length >= 3 && normalized.includes(name);
  });
  return matched.length ? matched : candidates;
}

type VisitTargetResolution =
  | { status: 'single'; visit: VisitWithProperty }
  | { status: 'none' }
  | { status: 'disambiguate'; candidates: VisitWithProperty[]; action: VisitMutationAction };

export type { VisitTargetResolution };

export async function findTargetVisitsWithDisambiguation(
  input: VisitMutationFromChatInput,
  action: VisitMutationAction,
): Promise<VisitTargetResolution> {
  return resolveVisitTarget(input, action);
}

async function resolveVisitTarget(
  input: VisitMutationFromChatInput,
  action: VisitMutationAction,
): Promise<VisitTargetResolution> {
  if (!config.features.visitDisambiguation) {
    const visit = await findTargetVisit(input);
    return visit ? { status: 'single', visit } : { status: 'none' };
  }

  const candidates = narrowCandidatesByPropertyName(await findCandidateVisits(input), input.message);
  if (candidates.length === 0) return { status: 'none' };
  if (candidates.length === 1) return { status: 'single', visit: candidates[0] };
  return { status: 'disambiguate', candidates, action };
}

async function loadCandidateVisitsByIds(
  input: VisitMutationFromChatInput,
  ids: string[],
): Promise<VisitWithProperty[]> {
  if (!ids.length) return [];
  const rows = await prisma.visit.findMany({
    where: {
      companyId: input.companyId,
      id: { in: ids },
      ...(input.leadId ? { leadId: input.leadId } : {}),
      ...(input.visitScope ?? {}),
    },
    include: {
      property: { select: { name: true } },
      lead: { select: { id: true, customerName: true, phone: true } },
    },
  });
  const order = new Map(ids.map((id, index) => [id, index]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

async function executeVisitAction(
  input: VisitMutationFromChatInput,
  visit: VisitWithProperty,
  action: VisitMutationAction,
  newScheduledAt: Date | null,
): Promise<VisitMutationFromChatResult> {
  const propertyName = visit.property?.name ?? 'Property';
  const forAgent = Boolean(input.visitScope);

  if (action === 'confirm') {
    const result = await confirmVisitById({
      companyId: input.companyId,
      visitId: visit.id,
      suppressCustomerNotification: Boolean(input.suppressCustomerNotification),
    });
    if (!result.success) {
      return {
        handled: true,
        reply: "I couldn't confirm that visit. Please ask an agent to help.",
      };
    }
    return {
      handled: true,
      mode: 'confirmed',
      visitId: visit.id,
      scheduledAt: visit.scheduledAt,
      reply: forAgent
        ? `Visit confirmed.\n\n${visit.lead?.customerName ?? 'Customer'} - ${propertyName}\n${formatDateIST(visit.scheduledAt)}`
        : `Your visit for *${propertyName}* on ${formatDateIST(visit.scheduledAt)} is confirmed.`,
    };
  }

  if (action === 'cancel') {
    const result = await cancelVisitById({
      companyId: input.companyId,
      visitId: visit.id,
      notes: 'Cancelled via WhatsApp',
      suppressCustomerNotification: Boolean(input.suppressCustomerNotification),
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
  if (visit.leadId) {
    void import('./clientMemory.service').then(({ syncLeadClientMemory }) =>
      syncLeadClientMemory(visit.leadId!),
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

async function tryResolvePendingDisambiguation(
  input: VisitMutationFromChatInput,
  message: string,
): Promise<VisitMutationFromChatResult | null> {
  if (!config.features.visitDisambiguation || !input.conversationId) return null;
  const row = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { commitments: true },
  }).catch(() => null);
  const pending = parsePendingDisambiguation(row?.commitments);
  if (!pending) return null;

  const candidates = await loadCandidateVisitsByIds(input, pending.candidateVisitIds);
  if (!candidates.length) {
    await clearPendingDisambiguation(input.conversationId);
    return { handled: true, reply: "I couldn't find those visits anymore. Please ask again with the property name." };
  }

  const ordinal = parseOrdinalSelection(message, candidates.length);
  const namedMatches = ordinal === null ? narrowCandidatesByPropertyName(candidates, message) : [];
  const selected = ordinal !== null
    ? candidates[ordinal]
    : namedMatches.length === 1
      ? namedMatches[0]
      : null;

  if (!selected) {
    return {
      handled: true,
      mode: 'disambiguate',
      reply: buildDisambiguationReply(candidates, pending.action, resolveBuyerLanguage({ message })),
    };
  }

  const parsedNewSlot =
    parseRescheduleTargetFromMessage(message, istReferenceAnchor())
    ?? (pending.newScheduledAt ? new Date(pending.newScheduledAt) : null);
  const result = await executeVisitAction(input, selected, pending.action, parsedNewSlot);
  await clearPendingDisambiguation(input.conversationId);
  return result;
}

export async function clearVisitDisambiguationPending(conversationId: string): Promise<void> {
  await clearPendingDisambiguation(conversationId);
}

export async function readVisitDisambiguationPending(conversationId: string) {
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { commitments: true },
  }).catch(() => null);
  return parsePendingDisambiguation(row?.commitments);
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
  const pendingResult = await tryResolvePendingDisambiguation(input, message);
  if (pendingResult) return pendingResult;

  const isConfirm = config.features.visitDisambiguation && isVisitConfirmMutationMessage(message);
  if (
    !message
    || isVisitListQueryMessage(message)
    || (!isVisitCancelOrRescheduleMessage(message) && !isConfirm)
  ) {
    return { handled: false };
  }

  const reference = istReferenceAnchor();
  const newScheduledAt = parseRescheduleTargetFromMessage(message, reference);
  const cancelOnly = wantsCancelOnly(message, Boolean(newScheduledAt));
  const action: VisitMutationAction = isConfirm ? 'confirm' : cancelOnly ? 'cancel' : 'reschedule';

  const lang = resolveBuyerLanguage({ message: input.message });

  if (config.features.visitDisambiguation) {
    const target = await resolveVisitTarget(input, action);
    if (target.status === 'disambiguate') {
      await savePendingDisambiguation(input.conversationId, target.candidates, action, newScheduledAt);
      return {
        handled: true,
        mode: 'disambiguate',
        reply: buildDisambiguationReply(target.candidates, action, lang),
      };
    }
    if (target.status === 'none') {
      return {
        handled: true,
        reply:
          "I couldn't find an upcoming site visit to change. Reply with the property name or book a new visit with your preferred date and time.",
      };
    }
    return executeVisitAction(input, target.visit, action, newScheduledAt);
  }

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
      suppressCustomerNotification: Boolean(input.suppressCustomerNotification),
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
