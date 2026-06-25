import cron from 'node-cron';
import config from '../../config';
import logger from '../../config/logger';
import prisma from '../../config/prisma';
import { CRON_SCHEDULES } from '../../constants/agent-ai.constants';
import { tryAcquireCronLeaderLock } from '../../utils/cronLeaderLock.util';
import {
  isEndOfDayBriefingDue,
  isMorningBriefingDue,
  parseCompanyWorkingHours,
  type CompanyWorkingHours,
} from '../../utils/istCalendar.util';
import { logAgentAction, purgeOldActionLogs } from '../agent-action-log.service';
import { recordDailyOpsRollup, DAILY_OPS_ROLLUP_CRON } from '../opsMetrics.service';
import { cleanupExpiredConfirmations } from './confirmation.service';
import { formatDateIST, formatTimeIST, maskPhone } from './response-formatter.service';
import {
  buildAgentEndOfDaySummary,
  buildAgentMorningBriefing,
  istDayBounds,
  logCronBriefingSent,
  wasCronBriefingSentToday,
} from './staffShiftBriefing.service';

type ScheduledTask = cron.ScheduledTask;
const tasks: ScheduledTask[] = [];
let staffShiftBriefingTask: ScheduledTask | null = null;

/** Result from a cron handler — scopes logs and failure alerts to affected tenants. */
export type CronRunResult = {
  affectedCompanyIds?: string[];
};

function cronResultFromIds(ids: Iterable<string>): CronRunResult {
  const list = [...new Set(ids)].filter(Boolean);
  return list.length ? { affectedCompanyIds: list } : {};
}

function trackCompanyIds(): { add: (id: string) => void; result: () => CronRunResult } {
  const ids = new Set<string>();
  return {
    add(id: string) {
      if (id) ids.add(id);
    },
    result() {
      return cronResultFromIds(ids);
    },
  };
}

async function sendNotification(phone: string, companyId: string, message: string): Promise<void> {
  const { whatsappService } = await import('../whatsapp.service');
  // sendCompanyTextMessage signature is (to, text, companyId).
  await whatsappService.sendCompanyTextMessage(phone, message, companyId);
}

const STAFF_SHIFT_BRIEFING_LOCK_TTL_SECONDS = 10 * 60;

async function loadCompanyWorkingHoursMap(companyIds: string[]): Promise<Map<string, CompanyWorkingHours>> {
  const uniqueIds = [...new Set(companyIds.filter(Boolean))];
  const map = new Map<string, CompanyWorkingHours>();
  if (!uniqueIds.length) return map;

  const settings = await prisma.aiSetting.findMany({
    where: { companyId: { in: uniqueIds } },
    select: { companyId: true, workingHours: true },
  });
  for (const row of settings) {
    map.set(row.companyId, parseCompanyWorkingHours(row.workingHours));
  }
  for (const companyId of uniqueIds) {
    if (!map.has(companyId)) {
      map.set(companyId, parseCompanyWorkingHours(null));
    }
  }
  return map;
}

/**
 * Proactive staff check-in / check-out WhatsApp briefings.
 * Polls every 15 min against each company's ai_settings.working_hours so messages
 * still fire after Railway restarts (90-min windows + boot catch-up).
 */
export async function processStaffShiftBriefings(at: Date = new Date()): Promise<CronRunResult> {
  const affected = trackCompanyIds();
  const agents = await prisma.user.findMany({
    where: { status: 'active', role: 'sales_agent', phone: { not: null } },
    select: { id: true, name: true, phone: true, companyId: true },
  });
  const hoursByCompany = await loadCompanyWorkingHoursMap(agents.map((a) => a.companyId));

  for (const agent of agents) {
    if (!agent.phone) continue;
    const workingHours = hoursByCompany.get(agent.companyId) ?? parseCompanyWorkingHours(null);

    if (isMorningBriefingDue(workingHours, at)) {
      try {
        if (await wasCronBriefingSentToday(agent.id, agent.companyId, 'cron_morning_briefing')) continue;
        const message = await buildAgentMorningBriefing(agent.id, agent.companyId, agent.name);
        await sendNotification(agent.phone, agent.companyId, message);
        await logCronBriefingSent(agent.id, agent.companyId, 'cron_morning_briefing');
        affected.add(agent.companyId);
      } catch (agentErr: unknown) {
        logger.warn('processStaffShiftBriefings: morning briefing failed', {
          agentId: agent.id,
          companyId: agent.companyId,
          error: agentErr instanceof Error ? agentErr.message : String(agentErr),
        });
      }
    }

    if (isEndOfDayBriefingDue(workingHours, at)) {
      try {
        if (await wasCronBriefingSentToday(agent.id, agent.companyId, 'cron_eod_summary')) continue;
        const message = await buildAgentEndOfDaySummary(agent.id, agent.companyId, agent.name);
        await sendNotification(agent.phone, agent.companyId, message);
        await logCronBriefingSent(agent.id, agent.companyId, 'cron_eod_summary');
        affected.add(agent.companyId);
      } catch (agentErr: unknown) {
        logger.warn('processStaffShiftBriefings: EOD briefing failed', {
          agentId: agent.id,
          companyId: agent.companyId,
          error: agentErr instanceof Error ? agentErr.message : String(agentErr),
        });
      }
    }
  }

  return affected.result();
}

async function runStaffShiftBriefingPoll(): Promise<CronRunResult> {
  const acquired = await tryAcquireCronLeaderLock(
    'staff_shift_briefing_poll',
    STAFF_SHIFT_BRIEFING_LOCK_TTL_SECONDS,
  );
  if (!acquired) {
    logger.debug('staffShiftBriefingPoll: skipped — another instance holds the lock');
    return {};
  }
  return processStaffShiftBriefings();
}

async function sendVisitReminders(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
  const now = new Date();
  const soon = new Date(now.getTime() + 60 * 60 * 1000);
  // Only remind for confirmed visits. Sending reminders for 'scheduled' (pending-approval) visits
  // confuses agents because they haven't confirmed the visit yet.
  const visits = await prisma.visit.findMany({
    where: { scheduledAt: { gte: now, lte: soon }, status: 'confirmed' },
    include: { agent: true, lead: true, property: true },
  });
  for (const visit of visits) {
    if (!visit.agent.phone) continue;
    const alreadySent = await prisma.agentActionLog.findFirst({
      where: {
        companyId: visit.companyId,
        action: 'cron_visit_agent_reminder',
        resourceType: 'visit',
        resourceId: visit.id,
      },
      select: { id: true },
    });
    if (alreadySent) continue;
    await sendNotification(visit.agent.phone, visit.companyId, [`*Visit Reminder*`, `${visit.lead?.customerName ?? 'Unknown'} (${maskPhone(visit.lead?.phone)})`, `${visit.property?.name ?? 'TBD'} at ${formatTimeIST(visit.scheduledAt)}`].join('\n'));
    void logAgentAction({
      companyId: visit.companyId,
      triggeredBy: 'cron',
      action: 'cron_visit_agent_reminder',
      resourceType: 'visit',
      resourceId: visit.id,
      status: 'success',
      result: 'Agent visit reminder sent (1h window)',
    });
    affected.add(visit.companyId);
  }
  return affected.result();
}

async function sendFollowUpAlerts(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
  const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const agents = await prisma.user.findMany({ where: { status: 'active', role: 'sales_agent', phone: { not: null } }, select: { id: true, phone: true, companyId: true } });
  for (const agent of agents) {
    if (!agent.phone) continue;
    const count = await prisma.lead.count({ where: { companyId: agent.companyId, assignedAgentId: agent.id, status: { in: ['contacted', 'visit_scheduled', 'visited', 'negotiation'] }, lastContactAt: { lt: threshold } } });
    if (count > 0) {
      await sendNotification(agent.phone, agent.companyId, `*Follow-up Reminder*\n${count} lead(s) need follow-up.`);
      affected.add(agent.companyId);
    }
  }
  return affected.result();
}

async function sendOwnerDailySummaries(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
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
    affected.add(admin.companyId);
  }
  return affected.result();
}

async function sendStaleLeadAlerts(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
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
      affected.add(admin.companyId);
    }
  }
  return affected.result();
}

async function sendWeeklyAdminReports(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
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
    affected.add(admin.companyId);
  }
  return affected.result();
}

const NO_SHOW_GRACE_MS = 30 * 60 * 1000;
const HOT_LEAD_SLA_MS = 4 * 60 * 60 * 1000;
const VISIT_NUDGE_MIN_MS = 2 * 60 * 60 * 1000;
const VISIT_NUDGE_MAX_MS = 4 * 60 * 60 * 1000;

export async function logCronOutcome(
  name: string,
  status: 'success' | 'failed',
  durationMs: number,
  error?: unknown,
  affectedCompanyIds?: string[],
): Promise<void> {
  const companyIds = [...new Set((affectedCompanyIds ?? []).filter(Boolean))];
  if (companyIds.length === 0) {
    return;
  }
  const errorMessage = error instanceof Error ? error.message : error != null ? String(error) : null;
  for (const companyId of companyIds) {
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

function buildCronFailureMessage(cronName: string, errMsg: string): string {
  const retryHint =
    cronName === 'detectAndMarkNoShows'
      ? 'No visits were marked. Will retry in 30 min.'
      : 'The job will run again on its next schedule.';
  return [
    '⚠️ *AI Automation Alert*',
    `Job: ${cronName}`,
    `Time: ${formatDateIST(new Date())} ${formatTimeIST(new Date())} IST`,
    `Error: ${errMsg}`,
    'Affected: see server logs for record counts',
    `Action: ${retryHint}`,
    '',
    'Reply "show AI actions today" to inspect recent actions.',
  ].join('\n');
}

async function notifyAdminsByRole(
  cronName: string,
  error: unknown,
  where: { role: 'company_admin' | 'super_admin'; companyId?: { in: string[] } },
): Promise<void> {
  const errMsg = error instanceof Error ? error.message : String(error);
  const message = buildCronFailureMessage(cronName, errMsg);
  const admins = await prisma.user.findMany({
    where: { ...where, status: 'active', phone: { not: null } },
    select: { phone: true, companyId: true },
  });
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

export async function alertCompanyAdminsCronFailure(
  cronName: string,
  error: unknown,
  affectedCompanyIds?: string[],
): Promise<void> {
  const companyIds = [...new Set((affectedCompanyIds ?? []).filter(Boolean))];
  if (companyIds.length === 0) {
    await notifyAdminsByRole(cronName, error, { role: 'super_admin' });
    return;
  }
  await notifyAdminsByRole(cronName, error, { role: 'company_admin', companyId: { in: companyIds } });
}

/** Ask agents to confirm attendance after the visit grace period; do not mark no-show until they answer. */
async function detectAndMarkNoShows(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
  const cutoff = new Date(Date.now() - NO_SHOW_GRACE_MS);
  const visits = await prisma.visit.findMany({
    where: {
      scheduledAt: { lt: cutoff },
      status: { in: ['scheduled', 'confirmed'] },
    },
    include: { agent: true, lead: true, property: true },
  });
  for (const visit of visits) {
    affected.add(visit.companyId);
    const existingAction = await prisma.pendingAction.findFirst({
      where: {
        actionType: 'attendance_check',
        status: 'awaiting',
        actionParams: { path: ['visitId'], equals: visit.id },
      },
      select: { id: true },
    });
    if (existingAction) continue;

    void logAgentAction({
      companyId: visit.companyId,
      triggeredBy: 'cron',
      action: 'detectAndMarkNoShows',
      resourceType: 'visit',
      resourceId: visit.id,
      status: 'success',
      result: `Attendance check requested for ${visit.lead?.customerName ?? 'visit'}`,
    });
    if (!visit.agent.phone) continue;
    // Find or create an AgentSession for the assigned agent so we can store a PendingAction.
    // This enables the staff copilot to pick up the agent's YES/NO reply.
    const session = await prisma.agentSession.upsert({
      where: { userId_phone: { userId: visit.agentId, phone: visit.agent.phone } },
      create: {
        userId: visit.agentId,
        companyId: visit.companyId,
        phone: visit.agent.phone,
        threadId: `agent-${visit.agentId}`,
        status: 'active',
        lastActiveAt: new Date(),
      },
      update: { lastActiveAt: new Date() },
    });
    // Create a pending attendance-check action (expires in 12 hours).
    await prisma.pendingAction.create({
      data: {
        sessionId: session.id,
        actionType: 'attendance_check',
        actionParams: {
          visitId: visit.id,
          leadId: visit.leadId,
          companyId: visit.companyId,
          customerName: visit.lead?.customerName ?? 'Customer',
          customerPhone: visit.lead?.phone ?? '',
          propertyName: visit.property?.name ?? 'Property',
        },
        displayMessage: `Did ${visit.lead?.customerName ?? 'the customer'} show up?`,
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      },
    });
    const { sendAttendanceCheck } = await import('../attendanceWorkflow.service');
    await sendAttendanceCheck(
      {
        id: visit.id,
        companyId: visit.companyId,
        scheduledAt: visit.scheduledAt,
        customerName: visit.lead?.customerName,
        propertyName: visit.property?.name,
      },
      { phone: visit.agent.phone, companyId: visit.companyId },
    );
  }
  return affected.result();
}

/**
 * EOD attendance check at 7:00 PM IST \u2014 for all visits scheduled today that are still
 * in scheduled/confirmed status 30+ min past their time (catches visits missed by the
 * 30-min rolling no-show check due to restart/race conditions).
 */
async function sendEodAttendanceChecks(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
  const [start, end] = istDayBounds();
  const cutoff = new Date(Date.now() - NO_SHOW_GRACE_MS);
  const visits = await prisma.visit.findMany({
    where: {
      scheduledAt: { gte: start, lte: cutoff },
      status: { in: ['scheduled', 'confirmed'] },
    },
    include: { agent: true, lead: true, property: true },
  });
  for (const visit of visits) {
    affected.add(visit.companyId);
    if (!visit.agent.phone) continue;
    // Check if we already sent an attendance check for this visit.
    const existingAction = await prisma.pendingAction.findFirst({
      where: {
        actionType: 'attendance_check',
        status: 'awaiting',
        actionParams: { path: ['visitId'], equals: visit.id },
      },
      select: { id: true },
    });
    if (existingAction) continue; // Already asked
    const session = await prisma.agentSession.upsert({
      where: { userId_phone: { userId: visit.agentId, phone: visit.agent.phone } },
      create: {
        userId: visit.agentId,
        companyId: visit.companyId,
        phone: visit.agent.phone,
        threadId: `agent-${visit.agentId}`,
        status: 'active',
        lastActiveAt: new Date(),
      },
      update: { lastActiveAt: new Date() },
    });
    await prisma.pendingAction.create({
      data: {
        sessionId: session.id,
        actionType: 'attendance_check',
        actionParams: {
          visitId: visit.id,
          leadId: visit.leadId,
          companyId: visit.companyId,
          customerName: visit.lead?.customerName ?? 'Customer',
          customerPhone: visit.lead?.phone ?? '',
          propertyName: visit.property?.name ?? 'Property',
        },
        displayMessage: `Did ${visit.lead?.customerName ?? 'the customer'} show up?`,
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      },
    });
    const { sendAttendanceCheck } = await import('../attendanceWorkflow.service');
    await sendAttendanceCheck(
      {
        id: visit.id,
        companyId: visit.companyId,
        scheduledAt: visit.scheduledAt,
        customerName: visit.lead?.customerName,
        propertyName: visit.property?.name,
      },
      { phone: visit.agent.phone, companyId: visit.companyId },
    );
    void logAgentAction({
      companyId: visit.companyId,
      triggeredBy: 'cron',
      action: 'sendEodAttendanceChecks',
      resourceType: 'visit',
      resourceId: visit.id,
      status: 'success',
      result: 'EOD attendance check sent',
    });
  }
  return affected.result();
}

/** Alert agents about hot leads with no contact in the last 4 hours. */
async function sendHotLeadSlaAlerts(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
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
    affected.add(agent.companyId);
  }
  return affected.result();
}

/** Monday pipeline snapshot for each sales agent. */
async function sendAgentWeeklyPipelineReport(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
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
    affected.add(agent.companyId);
  }
  return affected.result();
}

/** Nudge agents 2h after a visit was marked completed to log outcome / next step. */
async function sendVisitCompletedNudge(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
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
    affected.add(visit.companyId);
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
  return affected.result();
}

/** First-of-month summary for company admins. */
async function sendMonthlyAdminReport(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
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
    affected.add(admin.companyId);
  }
  return affected.result();
}

async function purgeActionLogCron(): Promise<CronRunResult> {
  const deleted = await purgeOldActionLogs(90);
  logger.info('AgentActionLog purge completed', { deleted });
  return {};
}

/**
 * G13 — Nightly conversation summary cron.
 *
 * For each lead that had WhatsApp activity in the last 24 hours, extract the
 * most recent messages (up to 10) and patch `lead_memory.conversationSummary`
 * with a compact plain-text digest. This preserves long-thread continuity for
 * the buyer AI so it never needs to ask the same questions again.
 *
 * Design:
 *   - Idempotent: processing the same lead twice overwrites with identical text.
 *   - Capped at 200 leads per run to prevent memory spikes on large tenants.
 *   - Never touches leads with no recent activity (no wasted DB writes).
 *   - All errors are caught per-lead; one bad lead does not abort the batch.
 *
 * @returns CronRunResult with affected company IDs.
 */
async function refreshNightlyConversationSummaries(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Find leads with recent inbound messages — these are the ones whose
  // conversationSummary is most likely to be stale.
  const activeLeads = await prisma.lead.findMany({
    where: {
      conversations: {
        some: {
          messages: {
            some: { createdAt: { gte: since }, senderType: 'customer' },
          },
        },
      },
    },
    select: { id: true, companyId: true, customerName: true },
    take: 200,
  });

  logger.info('refreshNightlyConversationSummaries started', { leadCount: activeLeads.length });

  const { patchLeadMemory } = await import('../lead-memory.service');

  for (const lead of activeLeads) {
    try {
      // Fetch the latest messages for this lead from the most recent conversation.
      const recentMessages = await prisma.message.findMany({
        where: { conversation: { leadId: lead.id } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { content: true, senderType: true, createdAt: true },
      });

      if (!recentMessages.length) continue;

      const summaryLines = recentMessages
        .reverse()
        .map((m) => {
          const role = m.senderType === 'customer' ? 'Buyer' : m.senderType === 'ai' ? 'AI' : 'Agent';
          return `${role}: ${m.content.slice(0, 100)}`;
        });

      const summary = summaryLines.join(' | ').slice(0, 400);

      await patchLeadMemory(lead.id, { conversationSummary: summary });
      affected.add(lead.companyId);
    } catch (leadErr: unknown) {
      logger.warn('refreshNightlyConversationSummaries: lead failed', {
        leadId: lead.id,
        error: leadErr instanceof Error ? leadErr.message : String(leadErr),
      });
    }
  }

  logger.info('refreshNightlyConversationSummaries completed', {
    processed: activeLeads.length,
    affectedCompanies: [...new Set(activeLeads.map((l) => l.companyId))].length,
  });

  return affected.result();
}

async function runConfirmationCleanup(): Promise<CronRunResult> {
  await cleanupExpiredConfirmations();
  return {};
}

/**
 * Reconciliation cron: finds workflow_run_records stuck in `needs_reconciliation`
 * for more than 1 hour and alerts company admins + logs for on-call triage.
 * Idempotent — safe to re-run. Does not modify any data.
 *
 * @returns CronRunResult with affected company IDs.
 */
async function reconcileWorkflowRuns(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
  const threshold = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago

  const stuckRuns = await prisma.$queryRawUnsafe<Array<{ id: string; company_id: string; workflow_id: string; created_at: Date }>>(
    `SELECT id, company_id, workflow_id, created_at
     FROM workflow_run_records
     WHERE status = 'needs_reconciliation'
       AND created_at < $1::timestamptz
     LIMIT 50`,
    threshold,
  );

  if (!stuckRuns.length) return {};

  for (const run of stuckRuns) {
    affected.add(run.company_id);
    void logAgentAction({
      companyId: run.company_id,
      triggeredBy: 'cron',
      action: 'workflow_needs_reconciliation',
      resourceType: 'workflow_run',
      resourceId: run.id,
      status: 'failed',
      result: `WorkflowRun ${run.workflow_id} stuck in needs_reconciliation since ${run.created_at.toISOString()}`,
    });
  }

  logger.warn('Workflow reconciliation: stuck runs detected', {
    count: stuckRuns.length,
    workflowIds: [...new Set(stuckRuns.map((r) => r.workflow_id))],
  });

  return affected.result();
}

function wrap(name: string, handler: () => Promise<CronRunResult>): () => void {
  return () => {
    void (async () => {
      const started = Date.now();
      let affectedCompanyIds: string[] | undefined;
      try {
        const result = await handler();
        affectedCompanyIds = result.affectedCompanyIds;
        await logCronOutcome(name, 'success', Date.now() - started, undefined, affectedCompanyIds);
      } catch (error: unknown) {
        const durationMs = Date.now() - started;
        await logCronOutcome(name, 'failed', durationMs, error, affectedCompanyIds);
        await alertCompanyAdminsCronFailure(name, error, affectedCompanyIds);
        logger.error(`Agent AI cron failed: ${name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  };
}

/**
 * Auto-expire pending visit/call approvals older than 4 hours.
 * New approvals live in booking_approval_requests; the notification scan below is a legacy fallback.
 */
async function expireStalePendingApprovals(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
  const { expireStaleBookingApprovals } = await import('../bookingApproval.service');
  const expiredNewApprovals = await expireStaleBookingApprovals(50);
  if (expiredNewApprovals > 0) {
    logger.info('expireStalePendingApprovals: expired booking approval requests', {
      count: expiredNewApprovals,
    });
  }

  const threshold = new Date(Date.now() - 4 * 60 * 60 * 1000);

  const staleRows = await prisma.notification.findMany({
    where: {
      createdAt: { lt: threshold },
      type: { in: ['visit_scheduled', 'call_requested'] },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  for (const row of staleRows) {
    const data = (row.data as Record<string, unknown>) || {};
    if (data.pendingApproval !== true) continue;
    if (data.resolvedAt) continue;

    const companyId = row.companyId;
    affected.add(companyId);

    // Mark as auto-expired
    await prisma.notification.update({
      where: { id: row.id },
      data: {
        data: {
          ...data,
          pendingApproval: false,
          resolvedAt: new Date().toISOString(),
          resolution: 'auto_expired',
        },
      },
    }).catch((err: unknown) => {
      logger.warn('expireStalePendingApprovals: update failed', {
        rowId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Notify customer
    const customerPhone = typeof data.customerPhone === 'string' ? data.customerPhone : null;
    const customerName = typeof data.customerName === 'string' ? data.customerName : 'there';
    const isVisit = row.type === 'visit_scheduled';

    if (customerPhone && companyId) {
      const msg = isVisit
        ? `Hi ${customerName}, unfortunately we were unable to confirm your visit booking. Please contact us or message again to rebook. Sorry for the inconvenience!`
        : `Hi ${customerName}, unfortunately we were unable to connect you with an agent for your call request. Please try again or contact us directly.`;

      try {
        const { whatsappService } = await import('../whatsapp.service');
        await whatsappService.sendCompanyTextMessage(customerPhone, msg, companyId);
      } catch (sendErr: unknown) {
        logger.warn('expireStalePendingApprovals: customer notification failed', {
          rowId: row.id,
          error: sendErr instanceof Error ? sendErr.message : String(sendErr),
        });
      }
    }

    void logAgentAction({
      companyId,
      triggeredBy: 'cron',
      action: 'auto_expire_pending_approval',
      resourceType: isVisit ? 'visit' : 'call_request',
      resourceId: typeof data.approvalId === 'string' ? data.approvalId : row.id,
      status: 'success',
      result: 'Auto-expired after 4h without agent response',
    });
  }

  return affected.result();
}

type FollowUpDueInputs = { dueAt?: string; note?: string };

/**
 * Picks up agent-tool `follow_up_due` action logs whose dueAt has passed
 * and sends WhatsApp reminders to the agent who scheduled them.
 */
async function processDueFollowUps(): Promise<CronRunResult> {
  const affected = trackCompanyIds();
  const now = new Date();
  const pending = await prisma.agentActionLog.findMany({
    where: { action: 'follow_up_due', status: 'success' },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  for (const row of pending) {
    const inputs = (row.inputs ?? {}) as FollowUpDueInputs;
    const dueAtRaw = inputs.dueAt;
    if (!dueAtRaw || !row.resourceId || !row.actorId) continue;
    const dueAt = new Date(dueAtRaw);
    if (Number.isNaN(dueAt.getTime()) || dueAt > now) continue;

    const alreadySent = await prisma.agentActionLog.findFirst({
      where: {
        companyId: row.companyId,
        action: 'follow_up_reminder_sent',
        resourceType: 'lead',
        resourceId: row.resourceId,
        createdAt: { gte: row.createdAt },
      },
      select: { id: true },
    });
    if (alreadySent) continue;

    const [agent, lead] = await Promise.all([
      prisma.user.findUnique({
        where: { id: row.actorId },
        select: { phone: true, name: true },
      }),
      prisma.lead.findUnique({
        where: { id: row.resourceId },
        select: { customerName: true, phone: true, status: true },
      }),
    ]);
    if (!agent?.phone || !lead) continue;

    const noteLine = inputs.note ? `\nNote: ${inputs.note}` : '';
    const message = [
      '*Follow-up Reminder*',
      `Lead: ${lead.customerName ?? 'Unknown'} (${lead.status ?? 'active'})`,
      `Scheduled follow-up is due now.${noteLine}`,
      'Reply with a CRM command to update this lead.',
    ].join('\n');

    await sendNotification(agent.phone, row.companyId, message);
    void logAgentAction({
      companyId: row.companyId,
      triggeredBy: 'cron',
      action: 'follow_up_reminder_sent',
      actorId: row.actorId,
      resourceType: 'lead',
      resourceId: row.resourceId,
      inputs: { sourceLogId: row.id, dueAt: dueAtRaw },
      status: 'success',
      result: `Follow-up reminder sent to ${agent.name ?? 'agent'}`,
    });
    affected.add(row.companyId);
  }

  return affected.result();
}

async function runComplianceRetentionPurge(): Promise<CronRunResult> {
  if (!config.features.complianceRetention) {
    return {};
  }
  const affected = trackCompanyIds();
  const { retentionService } = await import('../../compliance/retention.service');
  const companies = await prisma.company.findMany({
    where: { status: 'active' },
    select: { id: true },
    take: 500,
  });
  for (const company of companies) {
    try {
      const result = await retentionService.runNightlyPurge(company.id);
      const purgedTotal = Object.values(result.purged).reduce((sum, n) => sum + n, 0);
      if (purgedTotal > 0) {
        affected.add(company.id);
      }
    } catch (err: unknown) {
      logger.warn('complianceRetentionPurge: company failed', {
        companyId: company.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return affected.result();
}

export function startCronScheduler(): void {
  if (!config.agentAi.cronEnabled || tasks.length) return;
  tasks.push(
    cron.schedule(
      CRON_SCHEDULES.STAFF_SHIFT_BRIEFING_POLL,
      wrap('staffShiftBriefingPoll', runStaffShiftBriefingPoll),
    ),
    cron.schedule(CRON_SCHEDULES.OWNER_DAILY_SUMMARY, wrap('ownerDailySummary', sendOwnerDailySummaries)),
    cron.schedule(CRON_SCHEDULES.VISIT_REMINDER_CHECK, wrap('visitReminder', sendVisitReminders)),
    cron.schedule(CRON_SCHEDULES.FOLLOW_UP_ALERT, wrap('followUpAlert', sendFollowUpAlerts)),
    cron.schedule(CRON_SCHEDULES.STALE_LEAD_ALERT, wrap('staleLeadAlert', sendStaleLeadAlerts)),
    cron.schedule(CRON_SCHEDULES.WEEKLY_ADMIN_REPORT, wrap('weeklyAdminReport', sendWeeklyAdminReports)),
    cron.schedule(CRON_SCHEDULES.EXPIRED_CONFIRMATION_CLEANUP, wrap('confirmationCleanup', runConfirmationCleanup)),
    cron.schedule(CRON_SCHEDULES.NO_SHOW_CHECK, wrap('detectAndMarkNoShows', detectAndMarkNoShows)),
    cron.schedule(CRON_SCHEDULES.HOT_LEAD_SLA_CHECK, wrap('sendHotLeadSlaAlerts', sendHotLeadSlaAlerts)),
    cron.schedule(CRON_SCHEDULES.AGENT_WEEKLY_PIPELINE, wrap('sendAgentWeeklyPipelineReport', sendAgentWeeklyPipelineReport)),
    cron.schedule(CRON_SCHEDULES.VISIT_COMPLETED_NUDGE, wrap('sendVisitCompletedNudge', sendVisitCompletedNudge)),
    cron.schedule(CRON_SCHEDULES.MONTHLY_ADMIN_REPORT, wrap('sendMonthlyAdminReport', sendMonthlyAdminReport)),
    cron.schedule(CRON_SCHEDULES.ACTION_LOG_PURGE, wrap('purgeActionLog', purgeActionLogCron)),
    // EOD attendance check — 7:00 PM IST = 13:30 UTC. Asks agents YES/NO for unresolved visits.
    cron.schedule(CRON_SCHEDULES.EOD_ATTENDANCE_CHECK, wrap('eodAttendanceChecks', sendEodAttendanceChecks)),
    // Workflow saga reconciliation — nightly 2:30 AM IST. Alerts on needs_reconciliation runs.
    cron.schedule(CRON_SCHEDULES.WORKFLOW_RECONCILIATION_CHECK, wrap('reconcileWorkflowRuns', reconcileWorkflowRuns)),
    // G13: Nightly conversation summary — 2:10 AM IST. Patches lead_memory.conversationSummary.
    cron.schedule(CRON_SCHEDULES.NIGHTLY_CONVERSATION_SUMMARY, wrap('refreshNightlyConversationSummaries', refreshNightlyConversationSummaries)),
    // Auto-expire pending visit/call approvals older than 4 hours — every 30 minutes.
    cron.schedule(CRON_SCHEDULES.PENDING_APPROVAL_EXPIRE, wrap('expireStalePendingApprovals', expireStalePendingApprovals)),
    cron.schedule(CRON_SCHEDULES.FOLLOW_UP_DUE_CHECK, wrap('processDueFollowUps', processDueFollowUps)),
    cron.schedule(CRON_SCHEDULES.COMPLIANCE_RETENTION_PURGE, wrap('complianceRetentionPurge', runComplianceRetentionPurge)),
    cron.schedule(DAILY_OPS_ROLLUP_CRON, wrap('recordDailyOpsRollup', async () => {
      await recordDailyOpsRollup();
      return {};
    })),
  );
  logger.info('Agent AI cron scheduler started', { jobs: tasks.length });
  runStaffShiftBriefingBootCatchUp();
}

export function stopCronScheduler(): void {
  tasks.forEach((task) => task.stop());
  tasks.length = 0;
  if (staffShiftBriefingTask) {
    staffShiftBriefingTask.stop();
    staffShiftBriefingTask = null;
  }
  logger.info('Agent AI cron scheduler stopped');
}

function runStaffShiftBriefingBootCatchUp(): void {
  void (async () => {
    const started = Date.now();
    try {
      const result = await runStaffShiftBriefingPoll();
      await logCronOutcome(
        'staffShiftBriefingBootCatchUp',
        'success',
        Date.now() - started,
        undefined,
        result.affectedCompanyIds,
      );
    } catch (error: unknown) {
      await logCronOutcome(
        'staffShiftBriefingBootCatchUp',
        'failed',
        Date.now() - started,
        error,
      );
      logger.warn('Staff shift briefing boot catch-up failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
}

/**
 * Lightweight scheduler for worker runtimes — only staff check-in/out proactive messages.
 * Uses Redis leader lock so it is safe alongside the API cron scheduler.
 */
export function startStaffShiftBriefingScheduler(): void {
  if (!config.agentAi.cronEnabled || staffShiftBriefingTask) return;
  staffShiftBriefingTask = cron.schedule(
    CRON_SCHEDULES.STAFF_SHIFT_BRIEFING_POLL,
    wrap('staffShiftBriefingPoll', runStaffShiftBriefingPoll),
  );
  logger.info('Staff shift briefing scheduler started (worker mode)');
  runStaffShiftBriefingBootCatchUp();
}
