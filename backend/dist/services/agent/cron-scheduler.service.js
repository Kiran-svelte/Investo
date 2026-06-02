"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCronScheduler = startCronScheduler;
exports.stopCronScheduler = stopCronScheduler;
const node_cron_1 = __importDefault(require("node-cron"));
const config_1 = __importDefault(require("../../config"));
const logger_1 = __importDefault(require("../../config/logger"));
const prisma_1 = __importDefault(require("../../config/prisma"));
const agent_ai_constants_1 = require("../../constants/agent-ai.constants");
const confirmation_service_1 = require("./confirmation.service");
const response_formatter_service_1 = require("./response-formatter.service");
const tasks = [];
async function sendNotification(phone, companyId, message) {
    const { whatsappService } = await Promise.resolve().then(() => __importStar(require('../whatsapp.service')));
    await whatsappService.sendCompanyTextMessage(phone, message, companyId);
}
function istDayBounds() {
    const now = new Date();
    const offset = 5.5 * 60 * 60 * 1000;
    const ist = new Date(now.getTime() + offset);
    const start = new Date(ist.getFullYear(), ist.getMonth(), ist.getDate());
    const utcStart = new Date(start.getTime() - offset);
    return [utcStart, new Date(utcStart.getTime() + 24 * 60 * 60 * 1000 - 1)];
}
async function sendMorningBriefings() {
    const [start, end] = istDayBounds();
    const agents = await prisma_1.default.user.findMany({ where: { status: 'active', role: 'sales_agent', phone: { not: null } }, select: { id: true, name: true, phone: true, companyId: true } });
    for (const agent of agents) {
        if (!agent.phone)
            continue;
        const visits = await prisma_1.default.visit.findMany({
            where: { companyId: agent.companyId, agentId: agent.id, scheduledAt: { gte: start, lte: end }, status: { in: ['scheduled', 'confirmed'] } },
            include: { lead: true, property: true },
            orderBy: { scheduledAt: 'asc' },
        });
        const newLeads = await prisma_1.default.lead.count({ where: { companyId: agent.companyId, assignedAgentId: agent.id, status: 'new' } });
        const lines = [`Good morning ${agent.name}.`, '', `*Today's Visits (${visits.length})*`];
        if (visits.length) {
            visits.forEach((visit, i) => lines.push(`${i + 1}. ${visit.lead?.customerName ?? 'Unknown'} -> ${visit.property?.name ?? 'TBD'} at ${(0, response_formatter_service_1.formatTimeIST)(visit.scheduledAt)} (${(0, response_formatter_service_1.visitStatusEmoji)(visit.status)} ${visit.status})`));
        }
        else {
            lines.push('No visits scheduled.');
        }
        lines.push('', `New leads assigned: ${newLeads}`, 'Reply with any CRM question.');
        await sendNotification(agent.phone, agent.companyId, lines.join('\n'));
    }
}
async function sendVisitReminders() {
    const now = new Date();
    const soon = new Date(now.getTime() + 60 * 60 * 1000);
    const visits = await prisma_1.default.visit.findMany({
        where: { scheduledAt: { gte: now, lte: soon }, status: { in: ['scheduled', 'confirmed'] }, reminderSent: false },
        include: { agent: true, lead: true, property: true },
    });
    for (const visit of visits) {
        if (!visit.agent.phone)
            continue;
        await sendNotification(visit.agent.phone, visit.companyId, [`*Visit Reminder*`, `${visit.lead?.customerName ?? 'Unknown'} (${(0, response_formatter_service_1.maskPhone)(visit.lead?.phone)})`, `${visit.property?.name ?? 'TBD'} at ${(0, response_formatter_service_1.formatTimeIST)(visit.scheduledAt)}`].join('\n'));
        await prisma_1.default.visit.update({ where: { id: visit.id }, data: { reminderSent: true } });
    }
}
async function sendEndOfDaySummaries() {
    const [start, end] = istDayBounds();
    const agents = await prisma_1.default.user.findMany({ where: { status: 'active', role: 'sales_agent', phone: { not: null } }, select: { id: true, name: true, phone: true, companyId: true } });
    for (const agent of agents) {
        if (!agent.phone)
            continue;
        const [total, completed, newLeads] = await Promise.all([
            prisma_1.default.visit.count({ where: { companyId: agent.companyId, agentId: agent.id, scheduledAt: { gte: start, lte: end } } }),
            prisma_1.default.visit.count({ where: { companyId: agent.companyId, agentId: agent.id, status: 'completed', updatedAt: { gte: start, lte: end } } }),
            prisma_1.default.lead.count({ where: { companyId: agent.companyId, assignedAgentId: agent.id, createdAt: { gte: start, lte: end } } }),
        ]);
        await sendNotification(agent.phone, agent.companyId, [`Good evening ${agent.name}.`, `*Today's Summary*`, `Visits completed: ${completed}/${total}`, `New leads: ${newLeads}`].join('\n'));
    }
}
async function sendFollowUpAlerts() {
    const threshold = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const agents = await prisma_1.default.user.findMany({ where: { status: 'active', role: 'sales_agent', phone: { not: null } }, select: { id: true, phone: true, companyId: true } });
    for (const agent of agents) {
        if (!agent.phone)
            continue;
        const count = await prisma_1.default.lead.count({ where: { companyId: agent.companyId, assignedAgentId: agent.id, status: { in: ['contacted', 'visit_scheduled', 'visited', 'negotiation'] }, lastContactAt: { lt: threshold } } });
        if (count > 0)
            await sendNotification(agent.phone, agent.companyId, `*Follow-up Reminder*\n${count} lead(s) need follow-up.`);
    }
}
async function sendWeeklyAdminReports() {
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const admins = await prisma_1.default.user.findMany({ where: { status: 'active', role: 'company_admin', phone: { not: null } }, select: { name: true, phone: true, companyId: true } });
    for (const admin of admins) {
        if (!admin.phone)
            continue;
        const [newLeads, visits, won] = await Promise.all([
            prisma_1.default.lead.count({ where: { companyId: admin.companyId, createdAt: { gte: weekStart } } }),
            prisma_1.default.visit.count({ where: { companyId: admin.companyId, status: 'completed', updatedAt: { gte: weekStart } } }),
            prisma_1.default.lead.count({ where: { companyId: admin.companyId, status: 'closed_won', updatedAt: { gte: weekStart } } }),
        ]);
        await sendNotification(admin.phone, admin.companyId, [`*Weekly Report - ${admin.name}*`, `${(0, response_formatter_service_1.formatDateIST)(weekStart)} to ${(0, response_formatter_service_1.formatDateIST)(new Date())}`, `New leads: ${newLeads}`, `Visits completed: ${visits}`, `Deals won: ${won}`].join('\n'));
    }
}
function wrap(name, handler) {
    return () => {
        handler().catch((error) => logger_1.default.error(`Agent AI cron failed: ${name}`, { error: error?.message }));
    };
}
function startCronScheduler() {
    if (!config_1.default.agentAi.cronEnabled || tasks.length)
        return;
    tasks.push(node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.MORNING_BRIEFING, wrap('morningBriefing', sendMorningBriefings)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.END_OF_DAY_SUMMARY, wrap('endOfDaySummary', sendEndOfDaySummaries)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.VISIT_REMINDER_CHECK, wrap('visitReminder', sendVisitReminders)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.FOLLOW_UP_ALERT, wrap('followUpAlert', sendFollowUpAlerts)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.WEEKLY_ADMIN_REPORT, wrap('weeklyAdminReport', sendWeeklyAdminReports)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.EXPIRED_CONFIRMATION_CLEANUP, wrap('confirmationCleanup', confirmation_service_1.cleanupExpiredConfirmations)));
    logger_1.default.info('Agent AI cron scheduler started', { jobs: tasks.length });
}
function stopCronScheduler() {
    tasks.forEach((task) => task.stop());
    tasks.length = 0;
    logger_1.default.info('Agent AI cron scheduler stopped');
}
