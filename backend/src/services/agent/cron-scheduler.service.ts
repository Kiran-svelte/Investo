import cron from 'node-cron';
import config from '../../config';
import logger from '../../config/logger';
import prisma from '../../config/prisma';
import { CRON_SCHEDULES } from '../../constants/agent-ai.constants';
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
  const threshold = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const agents = await prisma.user.findMany({ where: { status: 'active', role: 'sales_agent', phone: { not: null } }, select: { id: true, phone: true, companyId: true } });
  for (const agent of agents) {
    if (!agent.phone) continue;
    const count = await prisma.lead.count({ where: { companyId: agent.companyId, assignedAgentId: agent.id, status: { in: ['contacted', 'visit_scheduled', 'visited', 'negotiation'] }, lastContactAt: { lt: threshold } } });
    if (count > 0) await sendNotification(agent.phone, agent.companyId, `*Follow-up Reminder*\n${count} lead(s) need follow-up.`);
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

function wrap(name: string, handler: () => Promise<unknown>): () => void {
  return () => {
    handler().catch((error: any) => logger.error(`Agent AI cron failed: ${name}`, { error: error?.message }));
  };
}

export function startCronScheduler(): void {
  if (!config.agentAi.cronEnabled || tasks.length) return;
  tasks.push(
    cron.schedule(CRON_SCHEDULES.MORNING_BRIEFING, wrap('morningBriefing', sendMorningBriefings)),
    cron.schedule(CRON_SCHEDULES.END_OF_DAY_SUMMARY, wrap('endOfDaySummary', sendEndOfDaySummaries)),
    cron.schedule(CRON_SCHEDULES.VISIT_REMINDER_CHECK, wrap('visitReminder', sendVisitReminders)),
    cron.schedule(CRON_SCHEDULES.FOLLOW_UP_ALERT, wrap('followUpAlert', sendFollowUpAlerts)),
    cron.schedule(CRON_SCHEDULES.WEEKLY_ADMIN_REPORT, wrap('weeklyAdminReport', sendWeeklyAdminReports)),
    cron.schedule(CRON_SCHEDULES.EXPIRED_CONFIRMATION_CLEANUP, wrap('confirmationCleanup', cleanupExpiredConfirmations)),
  );
  logger.info('Agent AI cron scheduler started', { jobs: tasks.length });
}

export function stopCronScheduler(): void {
  tasks.forEach((task) => task.stop());
  tasks.length = 0;
  logger.info('Agent AI cron scheduler stopped');
}
