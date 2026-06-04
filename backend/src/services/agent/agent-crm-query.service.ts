import prisma from '../../config/prisma';
import logger from '../../config/logger';
import type { ToolContext } from './agent-state';
import { applyVisitMutationFromChat } from '../visitMutationFromChat.service';
import { isVisitCancelOrRescheduleMessage, isVisitListQueryMessage } from '../visitIntentFromMessage.service';
import type { LeadPipelineStatus } from '../../constants/agent-intent.constants';
import { LEAD_PIPELINE_STATUSES } from '../../constants/agent-intent.constants';
import { updateLeadStatusById } from './lead-status-actions';
import { resolveLeadForIntent, type LeadResolveParams } from './agent-lead-resolution.service';
import {
  getRecentAgentSessionMessages,
  type AgentSessionMessage,
} from './agent-session-messages.service';
import {
  buildAgentScopeFilter,
  buildVisitScopeFilter,
  formatDateIST,
  getISTDayBounds,
  getStatusEmoji,
  getTodayIST,
  getTomorrowIST,
  maskPhone,
} from './tools/format-helpers';

/**
 * Month name to zero-indexed month number (IST calendar lookups).
 * Used by parseSpecificDateFromMessage.
 */
const MONTH_NAME_TO_INDEX: Readonly<Record<string, number>> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

/**
 * Extracts a specific calendar date from a freeform message in IST.
 * Handles patterns:
 *   - "6th June", "June 6", "6 june", "6/6", "6-6", "06/06/2026"
 * Returns a YYYY-MM-DD string (IST local date) or null if no date found.
 *
 * @param message - Raw WhatsApp message text.
 * @returns IST date string in 'YYYY-MM-DD' format, or null.
 */
export function parseSpecificDateFromMessage(message: string): string | null {
  const text = message.trim();
  if (!text) return null;

  const istYear = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 4);
  const currentYear = Number(istYear);

  // Pattern 1: "6th June 2026", "June 6th", "6 june", "June 6"
  const namedMonthPattern =
    /(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(\d{4}))?/i;
  const namedMonthAltPattern =
    /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?/i;

  const namedMatch = text.match(namedMonthPattern) ?? text.match(namedMonthAltPattern);
  if (namedMatch) {
    const dayStr = namedMatch[1]?.replace(/[^0-9]/g, '') ?? namedMatch[2]?.replace(/[^0-9]/g, '');
    const monthStr = namedMatch[2]?.toLowerCase() ?? namedMatch[1]?.toLowerCase();
    const yearStr = namedMatch[3];
    const day = Number(dayStr);
    const monthIndex = MONTH_NAME_TO_INDEX[monthStr ?? ''];
    if (
      !Number.isNaN(day) && day >= 1 && day <= 31 &&
      monthIndex !== undefined
    ) {
      const year = yearStr ? Number(yearStr) : currentYear;
      const mm = String(monthIndex + 1).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      return `${year}-${mm}-${dd}`;
    }
  }

  // Pattern 2: numeric dates "06/06", "6/6", "06-06", "06/06/2026"
  const numericPattern = /(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{4}))?/;
  const numericMatch = text.match(numericPattern);
  if (numericMatch) {
    const day = Number(numericMatch[1]);
    const month = Number(numericMatch[2]);
    const year = numericMatch[3] ? Number(numericMatch[3]) : currentYear;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const mm = String(month).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      return `${year}-${mm}-${dd}`;
    }
  }

  return null;
}

/**
 * Returns true when a staff message is a visit LIST request for a specific date
 * (e.g. "visits on 6th June", "site visits 15 July").
 * Explicitly guards against cancel/reschedule intent.
 *
 * @param text - Trimmed message text.
 * @returns True when this is a date-specific visit lookup.
 */
export function wantsVisitOnSpecificDate(text: string): boolean {
  if (isVisitCancelOrRescheduleMessage(text)) return false;
  if (!/\b(visit|visits|site\s*visit|appointment|schedule|scheduled)\b/i.test(text)) return false;
  const date = parseSpecificDateFromMessage(text);
  return date !== null;
}

const visitInclude = {
  lead: { select: { customerName: true, phone: true } },
  property: { select: { name: true } },
  agent: { select: { name: true } },
};

function formatVisitLine(visit: {
  id: string;
  status: string;
  scheduledAt: Date;
  lead: { customerName: string | null; phone: string | null } | null;
  property: { name: string | null } | null;
  agent: { name: string | null } | null;
}): string {
  return [
    `${getStatusEmoji(visit.status)} *${visit.lead?.customerName ?? 'Unknown'}* (${maskPhone(visit.lead?.phone)})`,
    `Property: ${visit.property?.name ?? 'TBD'}`,
    `Time: ${formatDateIST(visit.scheduledAt)} | Status: ${visit.status}`,
    `Agent: ${visit.agent?.name ?? 'Unassigned'}`,
    `ID: ${visit.id}`,
  ].join('\n');
}

async function fetchVisitsForDate(
  context: ToolContext,
  date: string,
  label: string,
): Promise<string> {
  const [start, end] = getISTDayBounds(date);
  const visits = await prisma.visit.findMany({
    where: {
      ...buildVisitScopeFilter(context.companyId, context.userRole, context.userId),
      scheduledAt: { gte: start, lte: end },
    },
    include: visitInclude,
    orderBy: { scheduledAt: 'asc' },
    take: 25,
  });
  if (!visits.length) {
    return `No visits scheduled for ${label.toLowerCase()} (${date}).`;
  }
  const heading = label === 'Today' || label === 'Tomorrow' ? `*${label}'s visits (${date})*` : `*Visits on ${label} (${date})*`;
  return [heading, ...visits.map(formatVisitLine)].join('\n\n');
}

async function fetchLeadsAddedToday(context: ToolContext): Promise<string> {
  const [start, end] = getISTDayBounds(getTodayIST());
  const leads = await prisma.lead.findMany({
    where: {
      ...buildAgentScopeFilter(context.companyId, context.userRole, context.userId),
      createdAt: { gte: start, lte: end },
    },
    include: { assignedAgent: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 25,
  });
  if (!leads.length) {
    return `No new leads were added today (${getTodayIST()}) in your scope.`;
  }
  return [
    `*New leads today (${getTodayIST()})*`,
    ...leads.map(
      (lead, i) =>
        `${i + 1}. ${getStatusEmoji(lead.status)} *${lead.customerName ?? 'Unknown'}* ${maskPhone(lead.phone)}\n   Status: ${lead.status} | Agent: ${lead.assignedAgent?.name ?? 'Unassigned'}\n   ID: ${lead.id}`,
    ),
  ].join('\n\n');
}

function wantsVisitTomorrow(text: string): boolean {
  if (/^\s*for\s+tomorrow\s*$/i.test(text)) return true;
  if (/^\s*(and\s+)?tomorrow\s*$/i.test(text)) return true;
  return (
    /\btomorrow\b/i.test(text)
    && /\b(visit|visits|schedule|scheduled|appointment|site|calendar|booked)\b/i.test(text)
  );
}

function wantsVisitToday(text: string): boolean {
  return (
    /\btoday\b/i.test(text)
    && /\b(visit|visits|schedule|scheduled|appointment|site|booked)\b/i.test(text)
  );
}

function wantsNewLeadsToday(text: string): boolean {
  if (/\b(update|set|mark|change|move)\b.*\b(lead|status)\b/i.test(text)) return false;
  if (/\bstatus\b.*\b(to|as)\b/i.test(text)) return false;
  if (/\bvisited\b/i.test(text) && /\b(lead|status)\b/i.test(text)) return false;
  return (
    /\b(new\s+leads?|leads?\s+(we\s+)?got|leads?\s+added|added\s+today|any\s+leads?)\b/i.test(text)
    || (/\bleads?\b/i.test(text) && /\btoday\b/i.test(text) && !/\b(update|status|visited)\b/i.test(text))
  );
}

function wantsVisitScheduleLookup(text: string): boolean {
  return (
    /\b(when|what\s+time|which\s+day|what\s+date|time\s+is)\b/i.test(text)
    && /\b(visits?|viste|site\s*visits?|appointment)\b/i.test(text)
    && /\b(book|booked|scheduled|fix|arranged|set)\b/i.test(text)
  );
}

async function fetchUpcomingVisitLookup(context: ToolContext): Promise<string> {
  const visit = await prisma.visit.findFirst({
    where: {
      ...buildVisitScopeFilter(context.companyId, context.userRole, context.userId),
      status: { in: ['scheduled', 'confirmed'] },
      scheduledAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    },
    orderBy: { scheduledAt: 'asc' },
    include: visitInclude,
  });
  if (!visit) {
    return 'No upcoming site visit found in your scope. Say "visits today" or book one from the dashboard.';
  }
  return `Your next site visit:\n\n${formatVisitLine(visit)}`;
}

function wantsConfirmVisit(text: string): boolean {
  if (/\b(update|set|mark|change|move)\b.*\b(status|lead)\b/i.test(text)) return false;
  if (/\bstatus\b.*\b(to|as)\b/i.test(text)) return false;
  const mentionsVisit =
    /\b(?:site\s+)?visits?\b/i.test(text)
    || /\bappointments?\b/i.test(text)
    || /\bthe\s+visit\b/i.test(text);
  return /\b(confirm|confirmed)\b/i.test(text) && mentionsVisit;
}

function wantsUpdateLeadStatus(text: string): boolean {
  return (
    /\b(update|set|mark|change|move)\b/i.test(text)
    && /\b(lead|status|customer|client)\b/i.test(text)
  ) || (
    /\bstatus\b/i.test(text)
    && /\b(to|as)\b/i.test(text)
    && /\b(lead|visited|contacted|negotiation|closed)\b/i.test(text)
  );
}

function parseLeadStatusFromMessage(text: string): LeadPipelineStatus | undefined {
  for (const status of LEAD_PIPELINE_STATUSES) {
    if (new RegExp(`\\b${status.replace('_', '[\\s_]?')}\\b`, 'i').test(text)) {
      return status;
    }
  }
  if (/\bvisited\b/i.test(text)) return 'visited';
  if (/\bcontacted\b/i.test(text)) return 'contacted';
  if (/\bnegotiat/i.test(text)) return 'negotiation';
  if (/\bclosed\s*won\b/i.test(text)) return 'closed_won';
  if (/\bclosed\s*lost\b/i.test(text)) return 'closed_lost';
  return undefined;
}

function parseLeadNameHintFromUpdateMessage(text: string): string | undefined {
  const patterns = [
    /\blead\s+(.+?)\s+status\b/i,
    /\bupdate\s+lead\s+(.+?)\s+status\b/i,
    /\b(?:for|of)\s+(.+?)\s+(?:status|to)\b/i,
    /\bstatus\s+(?:of|for)\s+(.+?)\s+to\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const hint = match?.[1]?.trim();
    if (hint && hint.length >= 2) return hint.replace(/\bto\s+visited\b/i, '').trim();
  }
  const toMatch = text.match(/\bto\s+(\w[\w\s]{1,40}?)\s*$/i);
  if (toMatch) return undefined;
  const nameMatch = text.match(
    /\b(?:lead|customer|client)\s+([a-z][a-z0-9\s]{2,40}?)(?:\s+status|\s+to\b)/i,
  );
  return nameMatch?.[1]?.trim();
}

async function tryDeterministicUpdateLeadStatus(
  context: ToolContext,
  text: string,
  recentMessages: AgentSessionMessage[] = [],
  sessionLeadId?: string | null,
): Promise<string | null> {
  if (!wantsUpdateLeadStatus(text)) return null;
  const status = parseLeadStatusFromMessage(text);
  if (!status) return null;

  const params: Partial<LeadResolveParams> = {
    leadName: parseLeadNameHintFromUpdateMessage(text),
  };
  const lead = await resolveLeadForIntent(context, params, sessionLeadId, recentMessages);
  if (!lead) {
    return 'Which lead should I update? Share the customer name or lead ID from your list.';
  }
  const result = await updateLeadStatusById(context, lead.leadId, status);
  return result.reply;
}

async function confirmNextUpcomingVisit(context: ToolContext): Promise<string> {
  const { getAgentSessionContext } = await import('../clientMemory.service');
  const sessionCtx = await getAgentSessionContext(context.sessionId);

  if (sessionCtx.lastVisitId) {
    const focused = await prisma.visit.findFirst({
      where: {
        id: sessionCtx.lastVisitId,
        ...buildVisitScopeFilter(context.companyId, context.userRole, context.userId),
        status: { in: ['scheduled', 'confirmed'] },
      },
      include: visitInclude,
    });
    if (focused && focused.status === 'scheduled') {
      const updated = await prisma.visit.update({
        where: { id: focused.id },
        data: { status: 'confirmed' },
        include: visitInclude,
      });
      return `✅ Visit confirmed.\n\n${formatVisitLine(updated)}`;
    }
    if (focused?.status === 'confirmed') {
      return `That visit is already confirmed.\n\n${formatVisitLine(focused)}`;
    }
  }

  const visit = await prisma.visit.findFirst({
    where: {
      ...buildVisitScopeFilter(context.companyId, context.userRole, context.userId),
      status: 'scheduled',
      scheduledAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
    },
    orderBy: { scheduledAt: 'asc' },
    include: visitInclude,
  });
  if (!visit) {
    return 'No upcoming scheduled visit found in your scope to confirm.';
  }
  const updated = await prisma.visit.update({
    where: { id: visit.id },
    data: { status: 'confirmed' },
    include: visitInclude,
  });
  return `✅ Visit confirmed.\n\n${formatVisitLine(updated)}`;
}

/**
 * Deterministic Zero-UI replies for common CRM lookups (no LLM hallucination).
 */
export async function tryDeterministicAgentVisitMutation(
  context: ToolContext,
  messageText: string,
): Promise<string | null> {
  if (!isVisitCancelOrRescheduleMessage(messageText)) return null;
  const mutation = await applyVisitMutationFromChat({
    companyId: context.companyId,
    message: messageText,
    visitScope: buildVisitScopeFilter(context.companyId, context.userRole, context.userId),
  });
  if (!mutation.handled || !mutation.reply) return null;
  return mutation.reply;
}

/**
 * Visit list lookups (today / tomorrow / specific date / schedule lookup).
 * Runs before mutations and LLM so "visits on 6th June" never reschedules.
 */
export async function tryResolveVisitListReply(
  context: ToolContext,
  messageText: string,
): Promise<string | null> {
  const text = messageText.trim();
  if (!text) return null;

  if (wantsVisitScheduleLookup(text)) {
    return fetchUpcomingVisitLookup(context);
  }
  if (wantsVisitTomorrow(text)) {
    return fetchVisitsForDate(context, getTomorrowIST(), 'Tomorrow');
  }
  if (wantsVisitToday(text)) {
    return fetchVisitsForDate(context, getTodayIST(), 'Today');
  }
  if (wantsVisitOnSpecificDate(text) || isVisitListQueryMessage(text)) {
    const specificDate = parseSpecificDateFromMessage(text);
    if (specificDate) {
      const label = new Date(`${specificDate}T12:00:00+05:30`).toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      return fetchVisitsForDate(context, specificDate, label);
    }
  }
  return null;
}

export async function tryDeterministicAgentCrmReply(
  context: ToolContext,
  messageText: string,
  options?: { sessionLeadId?: string | null },
): Promise<string | null> {
  const text = messageText.trim();
  if (!text) return null;

  try {
    const visitList = await tryResolveVisitListReply(context, text);
    if (visitList) {
      return visitList;
    }

    const recentMessages = context.sessionId
      ? await getRecentAgentSessionMessages(context.sessionId, 5)
      : [];
    const statusUpdate = await tryDeterministicUpdateLeadStatus(
      context,
      text,
      recentMessages,
      options?.sessionLeadId,
    );
    if (statusUpdate) return statusUpdate;

    if (wantsConfirmVisit(text)) {
      return confirmNextUpcomingVisit(context);
    }

    if (wantsNewLeadsToday(text)) {
      return fetchLeadsAddedToday(context);
    }

    const visitMutation = await tryDeterministicAgentVisitMutation(context, text);
    if (visitMutation) {
      return visitMutation;
    }
    return null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Deterministic CRM query failed', { error: message, userId: context.userId });
    return `I could not load that from Investo right now (${message}). Please try again in a minute.`;
  }
}
