import cron from 'node-cron';
import config from '../../config';
import logger from '../../config/logger';
import prisma from '../../config/prisma';
import { CRON_SCHEDULES } from '../../constants/agent-ai.constants';
import { logAgentAction, purgeOldActionLogs } from '../agent-action-log.service';
import { cleanupExpiredConfirmations } from './confirmation.service';
import { formatDateIST, formatTimeIST, maskPhone, visitStatusEmoji } from './response-formatter.service';

type ScheduledTask = cron.ScheduledTask;
const tasks: ScheduledTask[] = [];

async function sendNotification(phone: string, companyId: string, message: string): Promise<void> {
  const { whatsappService } = await import('../whatsapp.service');
  await whatsappService.sendCompanyTextMessage(phone, message, companyId);
}

function istDayBounds(): [Date, Date] {
  const now = new Date();
  const offset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + offset);
  const start = new Date(ist.getFullYear(), ist.getMonth(), ist.getDate());
  const utcStart = new Date(start.getTime() - offset);
  return [utcStart, new Date(utcStart.getTime() + 24 * 60 * 60 * 1000 - 1)];
}

async function sendMorningBriefings(): Promise<void> {
  const [start, end] = istDayBounds();
  const agents = await prisma.user.findMany({ where: { status: 'active', role: 'sales_agent', phone: { not: null } }, select: { id: true, name: true, phone: true, companyId: true } });
  for (const agent of agents) {
    if (!agent.phone) continue;
    const visits = await prisma.visit.findMany({
      where: { companyId: agent.companyId, agentId: agent.id, scheduledAt: { gte: start, lte: end }, status: { in: ['scheduled', 'confirmed'] } },
      include: { lead: true, property: true },
      orderBy: { scheduledAt: 'asc' },
    });
    const newLeads = await prisma.lead.count({ where: { companyId: agent.companyId, assignedAgentId: agent.id, status: 'new' } });
    const lines = [`Good morning ${agent.name}.`, '', `*Today's Visits (${visits.length})*`];
    if (visits.length) {
      visits.forEach((visit, i) => lines.push(`${i + 1}. ${visit.lead?.customerName ?? 'Unknown'} -> ${visit.property?.name ?? 'TBD'} at ${formatTimeIST(visit.scheduledAt)} (${visitStatusEmoji(visit.status)} ${visit.status})`));
    } else {
      lines.push('No visits scheduled.');
    }
    lines.push('', `New leads assigned: ${newLeads}`, 'Reply with any CRM question.');
    await sendNotification(agent.phone, agent.companyId, lines.join('\n'));
  }
}

async function sendVisitReminders(): Promise<void> {
  const now = new Date();
  const soon = new Date(now.getTime() + 60 * 60 * 1000);
  const visits = await prisma.visit.findMany({
    where: { scheduledAt: { gte: now, lte: soon }, status: { in: ['scheduled', 'confirmed'] }, reminderSent: false },
    include: { agent: true, lead: true, property: true },
  });
  for (const visit of visits) {
    if (!visit.agent.phone) continue;
    await sendNotification(visit.agent.phone, visit.companyId, [`*Visit Reminder*`, `${visit.lead?.customerName ?? 'Unknown'} (${maskPhone(visit.lead?.phone)})`, `${visit.property?.name ?? 'TBD'} at ${formatTimeIST(visit.scheduledAt)}`].join('\n'));
    await prisma.visit.update({ where: { id: visit.id }, data: { reminderSent: true } });
  }
}

async function sendEndOfDaySummaries(): Promise<void> {
  const [start, end] = istDayBounds();
  const agents = await prisma.user.findMany({ where: { status: 'active', role: 'sales_agent', phone: { not: null } }, select: { id: true, name: true, phone: true, companyId: true } });
  for (const agent of agents) {
    if (!agent.phone) continue;
    const [total, completed, newLeads] = await Promise.all([
      prisma.visit.count({ where: { companyId: agent.companyId, agentId: agent.id, scheduledAt: { gte: start, lte: end } } }),
      prisma.visit.count({ where: { companyId: agent.companyId, agentId: agent.id, status: 'completed', updatedAt: { gte: start, lte: end } } }),
      prisma.lead.count({ where: { companyId: agent.companyId, assignedAgentId: agent.id, createdAt: { gte: start, lte: end } } }),
    ]);
    await sendNotification(agent.phone, agent.companyId, [`Good evening ${agent.name}.`, `*Today's Summary*`, `Visits completed: ${completed}/${total}`, `New leads: ${newLeads}`].join('\n'));
  }
}

async function sendFollowUpAlerts(): Promise<void> {
  const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const agents = await prisma.user.findMany({ where: { status: 'active', role: 'sales_agent', phone: { not: null } }, select: { id: true, phone: true, companyId: true } });
  for (const agent of agents) {
    if (!agent.phone) continue;
    const count = await prisma.lead.count({ where: { companyId: agent.companyId, assignedAgentId: agent.id, status: { in: ['contacted', 'visit_scheduled', 'visited', 'negotiation'] }, lastContactAt: { lt: threshold } } });
    if (count > 0) await sendNotification(agent.phone, agent.companyId, `*Follow-up Reminder*\n${count} lead(s) need follow-up.`);
  }
}

async function sendOwnerDailySummaries(): Promise<void> {
  const [start, end] = istDayBounds();
  const yesterday = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const admins = await prisma.user.findMany({
    where: { status: 'active', role: 'company_admin', phone: { not: null } },
    select: { name: true, phone: true, companyId: true },
  });
  for (const admin of admins) {
    if (!admin.phone) continue;
    const [newLeads, hotLeads, visitsToday, won] = await Promise.all([
      prisma.lead.count({ where: { companyId: admin.companyId, createdAt: { gte: yesterday, lte: end } } }),
      prisma.lead.count({
        where: {
          companyId: admin.companyId,
          status: { notIn: ['closed_won', 'closed_lost'] },
          metadata: { path: ['lead_score'], equals: 'hot' },
        },
      }),
      prisma.visit.count({
        where: {
          companyId: admin.companyId,
          scheduledAt: { gte: start, lte: end },
          status: { in: ['scheduled', 'confirmed'] },
        },
      }),
      prisma.lead.count({
        where: { companyId: admin.companyId, status: 'closed_won', updatedAt: { gte: yesterday } },
      }),
    ]);
    await sendNotification(
      admin.phone,
      admin.companyId,
      [
        `*Daily Lead Summary*`,
        `New leads (24h): ${newLeads}`,
        `Hot leads (active): ${hotLeads}`,
        `Visits today: ${visitsToday}`,
        `Deals won (24h): ${won}`,
      ].join('\n'),
    );
  }
}

async function sendStaleLeadAlerts(): Promise<void> {
  const threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const admins = await prisma.user.findMany({
    where: { status: 'active', role: 'company_admin', phone: { not: null } },
    select: { name: true, phone: true, companyId: true },
  });
  for (const admin of admins) {
    if (!admin.phone) continue;
    const stale = await prisma.lead.count({
      where: {
        companyId: admin.companyId,
        status: { in: ['contacted', 'visit_scheduled', 'visited', 'negotiation'] },
        lastContactAt: { lt: threshold },
      },
    });
    if (stale > 0) {
      await sendNotification(
        admin.phone,
        admin.companyId,
        `*Stale Lead Alert*\n${stale} lead(s) with no contact in 7+ days.`,
      );
    }
  }
}

async function sendWeeklyAdminReports(): Promise<void> {
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const admins = await prisma.user.findMany({ where: { status: 'active', role: 'company_admin', phone: { not: null } }, select: { name: true, phone: true, companyId: true } });
  for (const admin of admins) {
    if (!admin.phone) continue;
    const [newLeads, visits, won] = await Promise.all([
      prisma.lead.count({ where: { companyId: admin.companyId, createdAt: { gte: weekStart } } }),
      prisma.visit.count({ where: { companyId: admin.companyId, status: 'completed', updatedAt: { gte: weekStart } } }),
      prisma.lead.count({ where: { companyId: admin.companyId, status: 'closed_won', updatedAt: { gte: weekStart } } }),
    ]);
    await sendNotification(admin.phone, admin.companyId, [`*Weekly Report - ${admin.name}*`, `${formatDateIST(weekStart)} to ${formatDateIST(new Date())}`, `New leads: ${newLeads}`, `Visits completed: ${visits}`, `Deals won: ${won}`].join('\n'));
  }
}

const NO_SHOW_GRACE_MS = 30 * 60 * 1000;
const HOT_LEAD_SLA_MS = 4 * 60 * 60 * 1000;
const VISIT_NUDGE_MIN_MS = 2 * 60 * 60 * 1000;
const VISIT_NUDGE_MAX_MS = 4 * 60 * 60 * 1000;

async function logCronOutcome(
  name: string,
  status: 'success' | 'failed',
  durationMs: number,
  error?: unknown,
): Promise<void> {
  const companies = await prisma.company.findMany({ select: { id: true } });
  const errorMessage = error instanceof Error ? error.message : error != null ? String(error) : null;
  for (const { id: companyId } of companies) {
    void logAgentAction({
      companyId,
      triggeredBy: 'cron',
      action: name,
      status,
      durationMs,
      errorMessage,
      result: status === 'success' ? 'completed' : null,
    });
  }
}

async function alertCompanyAdminsCronFailure(cronName: string, error: unknown): Promise<void> {
  const errMsg = error instanceof Error ? error.message : String(error);
  const admins = await prisma.user.findMany({
    where: { role: 'company_admin', status: 'active', phone: { not: null } },
    select: { phone: true, companyId: true, name: true },
  });
  const retryHint =
    cronName === 'detectAndMarkNoShows'
      ? 'No visits were marked. Will retry in 30 min.'
      : 'The job will run again on its next schedule.';
  const message = [
    '⚠️ *AI Automation Alert*',
    `Job: ${cronName}`,
    `Time: ${formatDateIST(new Date())} ${formatTimeIST(new Date())} IST`,
    `Error: ${errMsg}`,
    'Affected: see server logs for record counts',
    `Action: ${retryHint}`,
    '',
    'Reply "show AI actions today" to inspect recent actions.',
  ].join('\n');
  const notified = new Set<string>();
  for (const admin of admins) {
    const key = `${admin.companyId}:${admin.phone}`;
    if (notified.has(key) || !admin.phone) continue;
    notified.add(key);
    try {
      await sendNotification(admin.phone, admin.companyId, message);
    } catch {
      // non-blocking
    }
  }
}

/** Mark visits as no-show 30 minutes after scheduled time; notify assigned agents. */
async function detectAndMarkNoShows(): Promise<void> {
  const cutoff = new Date(Date.now() - NO_SHOW_GRACE_MS);
  const visits = await prisma.visit.findMany({
    where: {
      scheduledAt: { lt: cutoff },
      status: { in: ['scheduled', 'confirmed'] },
    },
    include: { agent: true, lead: true, property: true },
  });
  for (const visit of visits) {
    await prisma.visit.update({ where: { id: visit.id }, data: { status: 'no_show' } });
    void logAgentAction({
      companyId: visit.companyId,
      triggeredBy: 'cron',
      action: 'detectAndMarkNoShows',
      resourceType: 'visit',
      resourceId: visit.id,
      status: 'success',
      result: `Marked no_show for ${visit.lead?.customerName ?? 'visit'}`,
    });
    if (!visit.agent.phone) continue;
    await sendNotification(
      visit.agent.phone,
      visit.companyId,
      [
        `*Visit Marked No-Show*`,
        `${visit.lead?.customerName ?? 'Unknown'} — ${visit.property?.name ?? 'TBD'}`,
        `Scheduled: ${formatDateIST(visit.scheduledAt)} ${formatTimeIST(visit.scheduledAt)}`,
        'Reply to reschedule or update the lead.',
      ].join('\n'),
    );
  }
}

/** Alert agents about hot leads with no contact in the last 4 hours. */
async function sendHotLeadSlaAlerts(): Promise<void> {
  const threshold = new Date(Date.now() - HOT_LEAD_SLA_MS);
  const agents = await prisma.user.findMany({
    where: { status: 'active', role: 'sales_agent', phone: { not: null } },
    select: { id: true, name: true, phone: true, companyId: true },
  });
  for (const agent of agents) {
    if (!agent.phone) continue;
    const hotLeads = await prisma.lead.findMany({
      where: {
        companyId: agent.companyId,
        assignedAgentId: agent.id,
        status: { notIn: ['closed_won', 'closed_lost'] },
        metadata: { path: ['lead_score'], equals: 'hot' },
        OR: [{ lastContactAt: null }, { lastContactAt: { lt: threshold } }],
      },
      select: { id: true, customerName: true, phone: true },
      take: 5,
    });
    if (!hotLeads.length) continue;
    const lines = hotLeads.map(
      (l, i) => `${i + 1}. ${l.customerName ?? 'Unknown'} (${maskPhone(l.phone)})`,
    );
    await sendNotification(
      agent.phone,
      agent.companyId,
      [`*Hot Lead SLA Alert*`, `${hotLeads.length} hot lead(s) need contact within 4h:`, ...lines].join('\n'),
    );
  }
}

/** Monday pipeline snapshot for each sales agent. */
async function sendAgentWeeklyPipelineReport(): Promise<void> {
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const agents = await prisma.user.findMany({
    where: { status: 'active', role: 'sales_agent', phone: { not: null } },
    select: { id: true, name: true, phone: true, companyId: true },
  });
  for (const agent of agents) {
    if (!agent.phone) continue;
    const [active, newLeads, visitsDone, won, hot] = await Promise.all([
      prisma.lead.count({
        where: {
          companyId: agent.companyId,
          assignedAgentId: agent.id,
          status: { notIn: ['closed_won', 'closed_lost'] },
        },
      }),
      prisma.lead.count({
        where: { companyId: agent.companyId, assignedAgentId: agent.id, createdAt: { gte: weekStart } },
      }),
      prisma.visit.count({
        where: { companyId: agent.companyId, agentId: agent.id, status: 'completed', updatedAt: { gte: weekStart } },
      }),
      prisma.lead.count({
        where: {
          companyId: agent.companyId,
          assignedAgentId: agent.id,
          status: 'closed_won',
          updatedAt: { gte: weekStart },
        },
      }),
      prisma.lead.count({
        where: {
          companyId: agent.companyId,
          assignedAgentId: agent.id,
          status: { notIn: ['closed_won', 'closed_lost'] },
          metadata: { path: ['lead_score'], equals: 'hot' },
        },
      }),
    ]);
    await sendNotification(
      agent.phone,
      agent.companyId,
      [
        `*Weekly Pipeline — ${agent.name}*`,
        `${formatDateIST(weekStart)} to ${formatDateIST(new Date())}`,
        `Active leads: ${active}`,
        `New this week: ${newLeads}`,
        `Hot leads: ${hot}`,
        `Visits completed: ${visitsDone}`,
        `Deals won: ${won}`,
      ].join('\n'),
    );
  }
}

/** Nudge agents 2h after a visit was marked completed to log outcome / next step. */
async function sendVisitCompletedNudge(): Promise<void> {
  const windowEnd = new Date(Date.now() - VISIT_NUDGE_MIN_MS);
  const windowStart = new Date(Date.now() - VISIT_NUDGE_MAX_MS);
  const visits = await prisma.visit.findMany({
    where: {
      status: 'completed',
      updatedAt: { gte: windowStart, lte: windowEnd },
    },
    include: { agent: true, lead: true, property: true },
  });
  for (const visit of visits) {
    if (!visit.agent.phone) continue;
    const alreadyNudged = await prisma.agentActionLog.findFirst({
      where: {
        companyId: visit.companyId,
        action: 'sendVisitCompletedNudge',
        resourceType: 'visit',
        resourceId: visit.id,
      },
      select: { id: true },
    });
    if (alreadyNudged) continue;
    await sendNotification(
      visit.agent.phone,
      visit.companyId,
      [
        `*Post-Visit Follow-up*`,
        `Completed: ${visit.lead?.customerName ?? 'Unknown'} @ ${visit.property?.name ?? 'TBD'}`,
        'Log notes or schedule the next step for this lead.',
      ].join('\n'),
    );
    void logAgentAction({
      companyId: visit.companyId,
      triggeredBy: 'cron',
      action: 'sendVisitCompletedNudge',
      resourceType: 'visit',
      resourceId: visit.id,
      status: 'success',
      result: 'Nudge sent',
    });
  }
}

/** First-of-month summary for company admins. */
async function sendMonthlyAdminReport(): Promise<void> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const admins = await prisma.user.findMany({
    where: { status: 'active', role: 'company_admin', phone: { not: null } },
    select: { name: true, phone: true, companyId: true },
  });
  for (const admin of admins) {
    if (!admin.phone) continue;
    const [newLeads, visits, won, lost, hot] = await Promise.all([
      prisma.lead.count({ where: { companyId: admin.companyId, createdAt: { gte: monthStart } } }),
      prisma.visit.count({ where: { companyId: admin.companyId, status: 'completed', updatedAt: { gte: monthStart } } }),
      prisma.lead.count({ where: { companyId: admin.companyId, status: 'closed_won', updatedAt: { gte: monthStart } } }),
      prisma.lead.count({ where: { companyId: admin.companyId, status: 'closed_lost', updatedAt: { gte: monthStart } } }),
      prisma.lead.count({
        where: {
          companyId: admin.companyId,
          status: { notIn: ['closed_won', 'closed_lost'] },
          metadata: { path: ['lead_score'], equals: 'hot' },
        },
      }),
    ]);
    await sendNotification(
      admin.phone,
      admin.companyId,
      [
        `*Monthly Report — ${formatDateIST(monthStart)}*`,
        `New leads: ${newLeads}`,
        `Hot pipeline: ${hot}`,
        `Visits completed: ${visits}`,
        `Won: ${won} | Lost: ${lost}`,
      ].join('\n'),
    );
  }
}

async function purgeActionLogCron(): Promise<void> {
  const deleted = await purgeOldActionLogs(90);
  logger.info('AgentActionLog purge completed', { deleted });
}

function wrap(name: string, handler: () => Promise<unknown>): () => void {
  return () => {
    void (async () => {
      const started = Date.now();
      try {
        await handler();
        await logCronOutcome(name, 'success', Date.now() - started);
      } catch (error: unknown) {
        const durationMs = Date.now() - started;
        await logCronOutcome(name, 'failed', durationMs, error);
        await alertCompanyAdminsCronFailure(name, error);
        logger.error(`Agent AI cron failed: ${name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  };
}

export function startCronScheduler(): void {
  if (!config.agentAi.cronEnabled || tasks.length) return;
  tasks.push(
    cron.schedule(CRON_SCHEDULES.MORNING_BRIEFING, wrap('morningBriefing', sendMorningBriefings)),
    cron.schedule(CRON_SCHEDULES.OWNER_DAILY_SUMMARY, wrap('ownerDailySummary', sendOwnerDailySummaries)),
    cron.schedule(CRON_SCHEDULES.END_OF_DAY_SUMMARY, wrap('endOfDaySummary', sendEndOfDaySummaries)),
    cron.schedule(CRON_SCHEDULES.VISIT_REMINDER_CHECK, wrap('visitReminder', sendVisitReminders)),
    cron.schedule(CRON_SCHEDULES.FOLLOW_UP_ALERT, wrap('followUpAlert', sendFollowUpAlerts)),
    cron.schedule(CRON_SCHEDULES.STALE_LEAD_ALERT, wrap('staleLeadAlert', sendStaleLeadAlerts)),
    cron.schedule(CRON_SCHEDULES.WEEKLY_ADMIN_REPORT, wrap('weeklyAdminReport', sendWeeklyAdminReports)),
    cron.schedule(CRON_SCHEDULES.EXPIRED_CONFIRMATION_CLEANUP, wrap('confirmationCleanup', cleanupExpiredConfirmations)),
    cron.schedule(CRON_SCHEDULES.NO_SHOW_CHECK, wrap('detectAndMarkNoShows', detectAndMarkNoShows)),
    cron.schedule(CRON_SCHEDULES.HOT_LEAD_SLA_CHECK, wrap('sendHotLeadSlaAlerts', sendHotLeadSlaAlerts)),
    cron.schedule(CRON_SCHEDULES.AGENT_WEEKLY_PIPELINE, wrap('sendAgentWeeklyPipelineReport', sendAgentWeeklyPipelineReport)),
    cron.schedule(CRON_SCHEDULES.VISIT_COMPLETED_NUDGE, wrap('sendVisitCompletedNudge', sendVisitCompletedNudge)),
    cron.schedule(CRON_SCHEDULES.MONTHLY_ADMIN_REPORT, wrap('sendMonthlyAdminReport', sendMonthlyAdminReport)),
    cron.schedule(CRON_SCHEDULES.ACTION_LOG_PURGE, wrap('purgeActionLog', purgeActionLogCron)),
  );
  logger.info('Agent AI cron scheduler started', { jobs: tasks.length });
}

export function stopCronScheduler(): void {
  tasks.forEach((task) => task.stop());
  tasks.length = 0;
  logger.info('Agent AI cron scheduler stopped');
}
