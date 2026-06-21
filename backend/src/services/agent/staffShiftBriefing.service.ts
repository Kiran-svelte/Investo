import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { formatTimeIST, visitStatusEmoji } from './response-formatter.service';
import { logAgentAction } from '../agent-action-log.service';

export type StaffBriefingCronAction = 'cron_morning_briefing' | 'cron_eod_summary';
export type StaffShiftAction = 'staff_check_in' | 'staff_check_out';

const SHIFT_ACTION_COOLDOWN_MS = 60 * 1000;

/** IST calendar-day bounds as UTC Date pair [start, end]. */
export function istDayBounds(): [Date, Date] {
  const now = new Date();
  const offset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + offset);
  const start = new Date(ist.getFullYear(), ist.getMonth(), ist.getDate());
  const utcStart = new Date(start.getTime() - offset);
  return [utcStart, new Date(utcStart.getTime() + 24 * 60 * 60 * 1000 - 1)];
}

async function countStaleFollowUps(agentId: string, companyId: string): Promise<number> {
  const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return prisma.lead.count({
    where: {
      companyId,
      assignedAgentId: agentId,
      status: { in: ['contacted', 'visit_scheduled', 'visited', 'negotiation'] },
      lastContactAt: { lt: threshold },
    },
  });
}

async function fetchTodayVisits(agentId: string, companyId: string) {
  const [start, end] = istDayBounds();
  return prisma.visit.findMany({
    where: {
      companyId,
      agentId,
      scheduledAt: { gte: start, lte: end },
      status: { in: ['scheduled', 'confirmed'] },
    },
    include: { lead: true, property: true },
    orderBy: { scheduledAt: 'asc' },
  });
}

async function fetchTodayStats(agentId: string, companyId: string) {
  const [start, end] = istDayBounds();
  const [totalVisits, completedVisits, newLeads, followUpCount, pendingVisits] = await Promise.all([
    prisma.visit.count({
      where: { companyId, agentId, scheduledAt: { gte: start, lte: end } },
    }),
    prisma.visit.count({
      where: {
        companyId,
        agentId,
        status: 'completed',
        updatedAt: { gte: start, lte: end },
      },
    }),
    prisma.lead.count({
      where: { companyId, assignedAgentId: agentId, createdAt: { gte: start, lte: end } },
    }),
    countStaleFollowUps(agentId, companyId),
    prisma.visit.count({
      where: {
        companyId,
        agentId,
        scheduledAt: { gte: start, lte: end },
        status: { in: ['scheduled', 'confirmed'] },
      },
    }),
  ]);
  return { totalVisits, completedVisits, newLeads, followUpCount, pendingVisits };
}

function buildBriefingFallback(agentName: string, mode: 'check_in' | 'check_out'): string {
  if (mode === 'check_in') {
    return [
      `Good morning ${agentName}.`,
      `Your briefing is temporarily unavailable — CRM data could not be loaded.`,
      `Try *visits today* or *new leads today* in a moment.`,
    ].join('\n');
  }
  return [
    `Good evening ${agentName}.`,
    `Your end-of-day summary is temporarily unavailable.`,
    `Try *CHECK OUT* again shortly, or ask *visits today* for your schedule.`,
  ].join('\n');
}

/**
 * Morning check-in briefing — today's visits, new leads, follow-up backlog.
 */
export async function buildAgentMorningBriefing(
  agentId: string,
  companyId: string,
  agentName: string,
): Promise<string> {
  try {
    const [visits, newLeads] = await Promise.all([
      fetchTodayVisits(agentId, companyId),
      prisma.lead.count({
        where: { companyId, assignedAgentId: agentId, status: 'new' },
      }),
    ]);
    const followUpCount = await countStaleFollowUps(agentId, companyId);

    const lines = [
      `Good morning ${agentName}. You're checked in.`,
      '',
      `*Today's Visits (${visits.length})*`,
    ];
    if (visits.length) {
      visits.forEach((visit, i) => {
        lines.push(
          `${i + 1}. ${visit.lead?.customerName ?? 'Unknown'} → ${visit.property?.name ?? 'TBD'} at ${formatTimeIST(visit.scheduledAt)} (${visitStatusEmoji(visit.status)} ${visit.status})`,
        );
      });
    } else {
      lines.push('No visits scheduled.');
    }
    lines.push(
      '',
      `New leads assigned: ${newLeads}`,
      followUpCount > 0 ? `Leads needing follow-up: ${followUpCount}` : 'All leads contacted within 24h.',
      '',
      'Reply with any CRM question, or *CHECK OUT* at end of day.',
    );
    return lines.join('\n');
  } catch (err: unknown) {
    logger.error('buildAgentMorningBriefing failed', {
      agentId,
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return buildBriefingFallback(agentName, 'check_in');
  }
}

/**
 * End-of-day check-out summary — completed visits, new leads, pending items.
 */
export async function buildAgentEndOfDaySummary(
  agentId: string,
  companyId: string,
  agentName: string,
): Promise<string> {
  try {
    const stats = await fetchTodayStats(agentId, companyId);
    const lines = [
      `Good evening ${agentName}. You're checked out.`,
      '',
      '*Today\'s Summary*',
      `Visits completed: ${stats.completedVisits}/${stats.totalVisits}`,
      `New leads: ${stats.newLeads}`,
    ];
    if (stats.pendingVisits > 0) {
      lines.push(`Unresolved visits still open: ${stats.pendingVisits}`);
    }
    if (stats.followUpCount > 0) {
      lines.push(`Leads needing follow-up: ${stats.followUpCount}`);
    }
    lines.push('', 'See you tomorrow. Reply *CHECK IN* to start your next shift.');
    return lines.join('\n');
  } catch (err: unknown) {
    logger.error('buildAgentEndOfDaySummary failed', {
      agentId,
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return buildBriefingFallback(agentName, 'check_out');
  }
}

export async function wasCronBriefingSentToday(
  agentId: string,
  companyId: string,
  action: StaffBriefingCronAction,
): Promise<boolean> {
  const [start, end] = istDayBounds();
  const existing = await prisma.agentActionLog.findFirst({
    where: {
      companyId,
      actorId: agentId,
      action,
      createdAt: { gte: start, lte: end },
    },
    select: { id: true },
  });
  return !!existing;
}

export async function logCronBriefingSent(
  agentId: string,
  companyId: string,
  action: StaffBriefingCronAction,
): Promise<void> {
  void logAgentAction({
    companyId,
    triggeredBy: 'cron',
    action,
    actorId: agentId,
    resourceType: 'user',
    resourceId: agentId,
    status: 'success',
    result: 'Proactive briefing sent',
  });
}

export async function wasStaffShiftActionRecently(
  agentId: string,
  companyId: string,
  action: StaffShiftAction,
): Promise<boolean> {
  const since = new Date(Date.now() - SHIFT_ACTION_COOLDOWN_MS);
  const existing = await prisma.agentActionLog.findFirst({
    where: {
      companyId,
      actorId: agentId,
      action,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  return !!existing;
}

export async function logStaffShiftAction(
  agentId: string,
  companyId: string,
  action: StaffShiftAction,
): Promise<void> {
  void logAgentAction({
    companyId,
    triggeredBy: 'inbound_message',
    action,
    actorId: agentId,
    resourceType: 'user',
    resourceId: agentId,
    status: 'success',
    result: action === 'staff_check_in' ? 'Agent checked in via WhatsApp' : 'Agent checked out via WhatsApp',
  });
}

export function buildShiftThrottleAck(agentName: string, action: StaffShiftAction): string {
  if (action === 'staff_check_in') {
    return `Hi ${agentName} — you're already checked in. Ask *visits today* for a live update, or wait a moment and send *CHECK IN* again.`;
  }
  return `Hi ${agentName} — your check-out was just recorded. Send *CHECK OUT* again in a minute if you need an updated summary.`;
}
