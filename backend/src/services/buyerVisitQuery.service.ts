/**
 * Deterministic buyer visit-status replies, no LLM required.
 * Matches ai.md: "When is my visit?", "Any visits booked for me?", etc.
 */

import prisma from '../config/prisma';
import { formatDateIST } from './agent/tools/format-helpers';
import {
  tBuyer,
  visitStatusLabel,
  resolveBuyerLanguage,
  nurtureMessageForReason,
} from '../utils/buyerI18n.util';

function formatVisitWhen(date: Date): string {
  return formatDateIST(date);
}

const BUYER_VISIT_STATUS_PATTERN = /\b(any\s+visits?|visits?\s+(booked|scheduled|for\s+me|for\s+(?:today|tomorrow|this\s+week)|today|tomorrow|this\s+week|on\b)|(do\s+i|have\s+i|did\s+i)\s+(have\s+)?(any\s+)?(a\s+)?(visit|booking)s?|when\s+(is|was|am\s+i)\s+(my\s+)?(visit|site\s+visit|appointment|booking)|what\s+time\s+(am\s+i|is\s+my\s+visit)|my\s+visit\s+details?|show\s+(my\s+)?visits?|list\s+(my\s+)?visits?|get\s+(my\s+)?visits?|check\s+(my\s+)?visits?|visit\s+status|upcoming\s+visits?|booked\s+for\s+me)\b/i;

/** Buyer asking whether an existing visit is already set — not a new booking request. */
const BUYER_EXISTING_VISIT_INQUIRY_PATTERN =
  /\b(already\s+(confirmed|scheduled|booked|set)|is\s+it\s+(already\s+)?(confirmed|scheduled|booked|set)|(?:wasn'?t|isn'?t)\s+it\s+(already\s+)?(confirmed|scheduled|booked)|(?:confirmed|scheduled|booked)\s+(right|rite|ryt|correct|na|no)\??|see\s+(here|this|above|message))\b/i;

const BUYER_VISIT_MUTATION_PATTERN =
  /\b(reschedule|cancel|postpone|prepone|move|push|change|call\s+off)\b/i;

export function isBuyerExistingVisitInquiry(message: string): boolean {
  const t = message.trim();
  if (!t || t.length > 200) return false;
  if (BUYER_VISIT_MUTATION_PATTERN.test(t)) return false;
  return BUYER_EXISTING_VISIT_INQUIRY_PATTERN.test(t);
}

export function isBuyerVisitStatusQuery(message: string): boolean {
  const t = message.trim();
  if (!t || t.length > 200) return false;
  if (BUYER_VISIT_MUTATION_PATTERN.test(t)) return false;
  if (isBuyerExistingVisitInquiry(t)) return true;
  return BUYER_VISIT_STATUS_PATTERN.test(t);
}

function statusLabel(status: string, lang = 'en'): string {
  return visitStatusLabel(lang, status);
}

/**
 * Builds a structured WhatsApp reply listing the lead's visits from the database.
 * Never throws; returns a helpful message even when the query fails.
 */
export async function buildBuyerVisitStatusReply(input: {
  leadId: string;
  companyId: string;
  companyName?: string;
  lang?: string;
  customerMessage?: string | null;
  leadLanguage?: string | null;
}): Promise<string> {
  const lang = resolveBuyerLanguage({
    message: input.customerMessage,
    leadLanguage: input.leadLanguage ?? input.lang,
    defaultLanguage: input.lang,
  });
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const visits = await prisma.visit.findMany({
    where: {
      companyId: input.companyId,
      leadId: input.leadId,
      OR: [
        {
          status: { in: ['scheduled', 'confirmed'] },
          scheduledAt: { gte: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
        },
        {
          scheduledAt: { gte: sevenDaysAgo },
          status: { in: ['completed', 'no_show', 'cancelled'] },
        },
      ],
    },
    orderBy: { scheduledAt: 'asc' },
    take: 5,
    include: {
      property: { select: { name: true } },
      agent: { select: { name: true, phone: true } },
    },
  });

  const upcoming = visits.filter((v) =>
    ['scheduled', 'confirmed'].includes(v.status) && new Date(v.scheduledAt) >= sevenDaysAgo,
  );

  if (upcoming.length === 0) {
    const recent = visits.filter((v) => !['scheduled', 'confirmed'].includes(v.status));
    if (recent.length === 0) {
      return tBuyer(lang, 'visit_status_none');
    }

    const last = recent[recent.length - 1];
    const prop = last.property?.name ?? 'your property';
    const when = formatVisitWhen(last.scheduledAt);
    return tBuyer(lang, 'visit_status_recent', {
      property: prop,
      when,
      status: statusLabel(last.status, lang),
    });
  }

  if (upcoming.length === 1) {
    const v = upcoming[0];
    const prop = v.property?.name ?? 'Property TBD';
    const when = formatVisitWhen(v.scheduledAt);
    const agentLine = v.agent?.name
      ? `\nAgent: *${v.agent.name}*${v.agent.phone ? ` (${v.agent.phone})` : ''}`
      : '';

    return [
      tBuyer(lang, 'visit_status_header'),
      '',
      `Property: *${prop}*`,
      `When: ${when}`,
      `Status: *${statusLabel(v.status, lang)}*${agentLine}`,
      '',
      tBuyer(lang, 'visit_status_single_footer'),
    ].join('\n');
  }

  const lines = upcoming.map((v, i) => {
    const prop = v.property?.name ?? 'Property TBD';
    const when = formatVisitWhen(v.scheduledAt);
    return `${i + 1}. *${prop}* - ${when} (${statusLabel(v.status, lang)})`;
  });

  return [
    tBuyer(lang, 'visit_status_multi_header', { count: upcoming.length }),
    '',
    ...lines,
    '',
    tBuyer(lang, 'visit_status_multi_footer'),
  ].join('\n');
}
