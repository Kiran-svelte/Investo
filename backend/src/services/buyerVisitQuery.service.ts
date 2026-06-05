/**
 * Deterministic buyer visit-status replies — no LLM required.
 * Matches ai.md: "When is my visit?", "Any visits booked for me?", etc.
 */

import prisma from '../config/prisma';
import { formatDateIST } from './agent/tools/format-helpers';

function formatVisitWhen(date: Date): string {
  const time = date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${formatDateIST(date)} ${time}`;
}

const BUYER_VISIT_STATUS_PATTERN = /\b(any\s+visits?|visits?\s+(booked|scheduled|for\s+me|today|tomorrow|this\s+week|on\b)|(do\s+i|have\s+i|did\s+i)\s+(have\s+)?(any\s+)?(a\s+)?(visit|booking)s?|when\s+(is|was|am\s+i)\s+(my\s+)?(visit|site\s+visit|appointment|booking)|what\s+time\s+(am\s+i|is\s+my\s+visit)|my\s+visit\s+details?|show\s+(my\s+)?visits?|list\s+(my\s+)?visits?|get\s+(my\s+)?visits?|check\s+(my\s+)?visits?|visit\s+status|upcoming\s+visits?|booked\s+for\s+me)\b/i;

export function isBuyerVisitStatusQuery(message: string): boolean {
  const t = message.trim();
  if (!t || t.length > 200) return false;
  return BUYER_VISIT_STATUS_PATTERN.test(t);
}

function statusEmoji(status: string): string {
  const map: Record<string, string> = {
    scheduled: '📅',
    confirmed: '✅',
    completed: '✔️',
    cancelled: '❌',
    no_show: '⚠️',
    rescheduled: '🔄',
  };
  return map[status] ?? '📋';
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    scheduled: 'Scheduled',
    confirmed: 'Confirmed',
    completed: 'Completed',
    cancelled: 'Cancelled',
    no_show: 'No-show',
    rescheduled: 'Rescheduled',
  };
  return map[status] ?? status;
}

/**
 * Builds a structured WhatsApp reply listing the lead's visits from the database.
 * Never throws — returns a helpful message even when the query fails.
 */
export async function buildBuyerVisitStatusReply(input: {
  leadId: string;
  companyId: string;
  companyName?: string;
}): Promise<string> {
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
      return (
        `You don't have any upcoming visits right now.\n\n` +
        `Would you like to *book a free site visit*? Reply with a property name and preferred date/time.`
      );
    }

    const last = recent[recent.length - 1];
    const prop = last.property?.name ?? 'your property';
    const when = formatVisitWhen(last.scheduledAt);
    return (
      `Your most recent visit was to *${prop}* (${when}) — status: *${statusLabel(last.status)}* ${statusEmoji(last.status)}\n\n` +
      `You don't have an upcoming visit scheduled. Would you like to *book a new site visit*?`
    );
  }

  if (upcoming.length === 1) {
    const v = upcoming[0];
    const prop = v.property?.name ?? 'Property TBD';
    const when = formatVisitWhen(v.scheduledAt);
    const agentLine = v.agent?.name
      ? `\n👤 Agent: *${v.agent.name}*${v.agent.phone ? ` (${v.agent.phone})` : ''}`
      : '';

    return [
      `🏠 *YOUR VISIT*`,
      '',
      `📍 *${prop}*`,
      `📅 ${when}`,
      `${statusEmoji(v.status)} Status: *${statusLabel(v.status)}*${agentLine}`,
      '',
      `Would you like to:`,
      `✅ Confirm  |  📅 Reschedule  |  ❌ Cancel`,
    ].join('\n');
  }

  const lines = upcoming.map((v, i) => {
    const prop = v.property?.name ?? 'Property TBD';
    const when = formatVisitWhen(v.scheduledAt);
    return `${i + 1}. ${statusEmoji(v.status)} *${prop}* — ${when} (${statusLabel(v.status)})`;
  });

  return [
    `You have *${upcoming.length} upcoming visits*:`,
    '',
    ...lines,
    '',
    `Reply with the property name to *Confirm*, *Reschedule*, or *Cancel* a specific visit.`,
  ].join('\n');
}
