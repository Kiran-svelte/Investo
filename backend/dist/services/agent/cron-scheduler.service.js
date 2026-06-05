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
exports.logCronOutcome = logCronOutcome;
exports.alertCompanyAdminsCronFailure = alertCompanyAdminsCronFailure;
exports.startCronScheduler = startCronScheduler;
exports.stopCronScheduler = stopCronScheduler;
const node_cron_1 = __importDefault(require("node-cron"));
const config_1 = __importDefault(require("../../config"));
const logger_1 = __importDefault(require("../../config/logger"));
const prisma_1 = __importDefault(require("../../config/prisma"));
const agent_ai_constants_1 = require("../../constants/agent-ai.constants");
const agent_action_log_service_1 = require("../agent-action-log.service");
const confirmation_service_1 = require("./confirmation.service");
const response_formatter_service_1 = require("./response-formatter.service");
const tasks = [];
function cronResultFromIds(ids) {
    const list = [...new Set(ids)].filter(Boolean);
    return list.length ? { affectedCompanyIds: list } : {};
}
function trackCompanyIds() {
    const ids = new Set();
    return {
        add(id) {
            if (id)
                ids.add(id);
        },
        result() {
            return cronResultFromIds(ids);
        },
    };
}
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
    const affected = trackCompanyIds();
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
        affected.add(agent.companyId);
    }
    return affected.result();
}
async function sendVisitReminders() {
    const affected = trackCompanyIds();
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
        affected.add(visit.companyId);
    }
    return affected.result();
}
async function sendEndOfDaySummaries() {
    const affected = trackCompanyIds();
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
        affected.add(agent.companyId);
    }
    return affected.result();
}
async function sendFollowUpAlerts() {
    const affected = trackCompanyIds();
    const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const agents = await prisma_1.default.user.findMany({ where: { status: 'active', role: 'sales_agent', phone: { not: null } }, select: { id: true, phone: true, companyId: true } });
    for (const agent of agents) {
        if (!agent.phone)
            continue;
        const count = await prisma_1.default.lead.count({ where: { companyId: agent.companyId, assignedAgentId: agent.id, status: { in: ['contacted', 'visit_scheduled', 'visited', 'negotiation'] }, lastContactAt: { lt: threshold } } });
        if (count > 0) {
            await sendNotification(agent.phone, agent.companyId, `*Follow-up Reminder*\n${count} lead(s) need follow-up.`);
            affected.add(agent.companyId);
        }
    }
    return affected.result();
}
async function sendOwnerDailySummaries() {
    const affected = trackCompanyIds();
    const [start, end] = istDayBounds();
    const yesterday = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    const admins = await prisma_1.default.user.findMany({
        where: { status: 'active', role: 'company_admin', phone: { not: null } },
        select: { name: true, phone: true, companyId: true },
    });
    for (const admin of admins) {
        if (!admin.phone)
            continue;
        const [newLeads, hotLeads, visitsToday, won] = await Promise.all([
            prisma_1.default.lead.count({ where: { companyId: admin.companyId, createdAt: { gte: yesterday, lte: end } } }),
            prisma_1.default.lead.count({
                where: {
                    companyId: admin.companyId,
                    status: { notIn: ['closed_won', 'closed_lost'] },
                    metadata: { path: ['lead_score'], equals: 'hot' },
                },
            }),
            prisma_1.default.visit.count({
                where: {
                    companyId: admin.companyId,
                    scheduledAt: { gte: start, lte: end },
                    status: { in: ['scheduled', 'confirmed'] },
                },
            }),
            prisma_1.default.lead.count({
                where: { companyId: admin.companyId, status: 'closed_won', updatedAt: { gte: yesterday } },
            }),
        ]);
        await sendNotification(admin.phone, admin.companyId, [
            `*Daily Lead Summary*`,
            `New leads (24h): ${newLeads}`,
            `Hot leads (active): ${hotLeads}`,
            `Visits today: ${visitsToday}`,
            `Deals won (24h): ${won}`,
        ].join('\n'));
        affected.add(admin.companyId);
    }
    return affected.result();
}
async function sendStaleLeadAlerts() {
    const affected = trackCompanyIds();
    const threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const admins = await prisma_1.default.user.findMany({
        where: { status: 'active', role: 'company_admin', phone: { not: null } },
        select: { name: true, phone: true, companyId: true },
    });
    for (const admin of admins) {
        if (!admin.phone)
            continue;
        const stale = await prisma_1.default.lead.count({
            where: {
                companyId: admin.companyId,
                status: { in: ['contacted', 'visit_scheduled', 'visited', 'negotiation'] },
                lastContactAt: { lt: threshold },
            },
        });
        if (stale > 0) {
            await sendNotification(admin.phone, admin.companyId, `*Stale Lead Alert*\n${stale} lead(s) with no contact in 7+ days.`);
            affected.add(admin.companyId);
        }
    }
    return affected.result();
}
async function sendWeeklyAdminReports() {
    const affected = trackCompanyIds();
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
        affected.add(admin.companyId);
    }
    return affected.result();
}
const NO_SHOW_GRACE_MS = 30 * 60 * 1000;
const HOT_LEAD_SLA_MS = 4 * 60 * 60 * 1000;
const VISIT_NUDGE_MIN_MS = 2 * 60 * 60 * 1000;
const VISIT_NUDGE_MAX_MS = 4 * 60 * 60 * 1000;
async function logCronOutcome(name, status, durationMs, error, affectedCompanyIds) {
    const companyIds = [...new Set((affectedCompanyIds ?? []).filter(Boolean))];
    if (companyIds.length === 0) {
        return;
    }
    const errorMessage = error instanceof Error ? error.message : error != null ? String(error) : null;
    for (const companyId of companyIds) {
        void (0, agent_action_log_service_1.logAgentAction)({
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
function buildCronFailureMessage(cronName, errMsg) {
    const retryHint = cronName === 'detectAndMarkNoShows'
        ? 'No visits were marked. Will retry in 30 min.'
        : 'The job will run again on its next schedule.';
    return [
        '⚠️ *AI Automation Alert*',
        `Job: ${cronName}`,
        `Time: ${(0, response_formatter_service_1.formatDateIST)(new Date())} ${(0, response_formatter_service_1.formatTimeIST)(new Date())} IST`,
        `Error: ${errMsg}`,
        'Affected: see server logs for record counts',
        `Action: ${retryHint}`,
        '',
        'Reply "show AI actions today" to inspect recent actions.',
    ].join('\n');
}
async function notifyAdminsByRole(cronName, error, where) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const message = buildCronFailureMessage(cronName, errMsg);
    const admins = await prisma_1.default.user.findMany({
        where: { ...where, status: 'active', phone: { not: null } },
        select: { phone: true, companyId: true },
    });
    const notified = new Set();
    for (const admin of admins) {
        const key = `${admin.companyId}:${admin.phone}`;
        if (notified.has(key) || !admin.phone)
            continue;
        notified.add(key);
        try {
            await sendNotification(admin.phone, admin.companyId, message);
        }
        catch {
            // non-blocking
        }
    }
}
async function alertCompanyAdminsCronFailure(cronName, error, affectedCompanyIds) {
    const companyIds = [...new Set((affectedCompanyIds ?? []).filter(Boolean))];
    if (companyIds.length === 0) {
        await notifyAdminsByRole(cronName, error, { role: 'super_admin' });
        return;
    }
    await notifyAdminsByRole(cronName, error, { role: 'company_admin', companyId: { in: companyIds } });
}
/** Mark visits as no-show 30 minutes after scheduled time; ask agents YES/NO attendance. */
async function detectAndMarkNoShows() {
    const affected = trackCompanyIds();
    const cutoff = new Date(Date.now() - NO_SHOW_GRACE_MS);
    const visits = await prisma_1.default.visit.findMany({
        where: {
            scheduledAt: { lt: cutoff },
            status: { in: ['scheduled', 'confirmed'] },
        },
        include: { agent: true, lead: true, property: true },
    });
    for (const visit of visits) {
        affected.add(visit.companyId);
        await prisma_1.default.visit.update({ where: { id: visit.id }, data: { status: 'no_show' } });
        void (0, agent_action_log_service_1.logAgentAction)({
            companyId: visit.companyId,
            triggeredBy: 'cron',
            action: 'detectAndMarkNoShows',
            resourceType: 'visit',
            resourceId: visit.id,
            status: 'success',
            result: `Marked no_show for ${visit.lead?.customerName ?? 'visit'}`,
        });
        if (!visit.agent.phone)
            continue;
        // Find or create an AgentSession for the assigned agent so we can store a PendingAction.
        // This enables the staff copilot to pick up the agent's YES/NO reply.
        const session = await prisma_1.default.agentSession.upsert({
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
        await prisma_1.default.pendingAction.create({
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
        await sendNotification(visit.agent.phone, visit.companyId, [
            `*Attendance Check Required*`,
            `Visit: ${visit.lead?.customerName ?? 'Unknown'} \u2014 ${visit.property?.name ?? 'TBD'}`,
            `Scheduled: ${(0, response_formatter_service_1.formatDateIST)(visit.scheduledAt)} ${(0, response_formatter_service_1.formatTimeIST)(visit.scheduledAt)}`,
            ``,
            `Did the customer show up?`,
            `Reply *YES* if they came \u2705`,
            `Reply *NO* if they didn\u2019t \u274C`,
        ].join('\n'));
    }
    return affected.result();
}
/**
 * EOD attendance check at 7:00 PM IST \u2014 for all visits scheduled today that are still
 * in scheduled/confirmed status 30+ min past their time (catches visits missed by the
 * 30-min rolling no-show check due to restart/race conditions).
 */
async function sendEodAttendanceChecks() {
    const affected = trackCompanyIds();
    const [start, end] = istDayBounds();
    const cutoff = new Date(Date.now() - NO_SHOW_GRACE_MS);
    const visits = await prisma_1.default.visit.findMany({
        where: {
            scheduledAt: { gte: start, lte: cutoff },
            status: { in: ['scheduled', 'confirmed'] },
        },
        include: { agent: true, lead: true, property: true },
    });
    for (const visit of visits) {
        affected.add(visit.companyId);
        if (!visit.agent.phone)
            continue;
        // Check if we already sent an attendance check for this visit.
        const existingAction = await prisma_1.default.pendingAction.findFirst({
            where: {
                actionType: 'attendance_check',
                status: 'awaiting',
                actionParams: { path: ['visitId'], equals: visit.id },
            },
            select: { id: true },
        });
        if (existingAction)
            continue; // Already asked
        const session = await prisma_1.default.agentSession.upsert({
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
        await prisma_1.default.pendingAction.create({
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
        await sendNotification(visit.agent.phone, visit.companyId, [
            `\uD83C\uDF07 *End-of-Day Attendance Check*`,
            ``,
            `Visit: *${visit.lead?.customerName ?? 'Unknown'}*`,
            `Property: ${visit.property?.name ?? 'TBD'}`,
            `Time: ${(0, response_formatter_service_1.formatTimeIST)(visit.scheduledAt)}`,
            ``,
            `Did they show up today?`,
            `Reply *YES* \u2705 or *NO* \u274C`,
        ].join('\n'));
        void (0, agent_action_log_service_1.logAgentAction)({
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
async function sendHotLeadSlaAlerts() {
    const affected = trackCompanyIds();
    const threshold = new Date(Date.now() - HOT_LEAD_SLA_MS);
    const agents = await prisma_1.default.user.findMany({
        where: { status: 'active', role: 'sales_agent', phone: { not: null } },
        select: { id: true, name: true, phone: true, companyId: true },
    });
    for (const agent of agents) {
        if (!agent.phone)
            continue;
        const hotLeads = await prisma_1.default.lead.findMany({
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
        if (!hotLeads.length)
            continue;
        const lines = hotLeads.map((l, i) => `${i + 1}. ${l.customerName ?? 'Unknown'} (${(0, response_formatter_service_1.maskPhone)(l.phone)})`);
        await sendNotification(agent.phone, agent.companyId, [`*Hot Lead SLA Alert*`, `${hotLeads.length} hot lead(s) need contact within 4h:`, ...lines].join('\n'));
        affected.add(agent.companyId);
    }
    return affected.result();
}
/** Monday pipeline snapshot for each sales agent. */
async function sendAgentWeeklyPipelineReport() {
    const affected = trackCompanyIds();
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const agents = await prisma_1.default.user.findMany({
        where: { status: 'active', role: 'sales_agent', phone: { not: null } },
        select: { id: true, name: true, phone: true, companyId: true },
    });
    for (const agent of agents) {
        if (!agent.phone)
            continue;
        const [active, newLeads, visitsDone, won, hot] = await Promise.all([
            prisma_1.default.lead.count({
                where: {
                    companyId: agent.companyId,
                    assignedAgentId: agent.id,
                    status: { notIn: ['closed_won', 'closed_lost'] },
                },
            }),
            prisma_1.default.lead.count({
                where: { companyId: agent.companyId, assignedAgentId: agent.id, createdAt: { gte: weekStart } },
            }),
            prisma_1.default.visit.count({
                where: { companyId: agent.companyId, agentId: agent.id, status: 'completed', updatedAt: { gte: weekStart } },
            }),
            prisma_1.default.lead.count({
                where: {
                    companyId: agent.companyId,
                    assignedAgentId: agent.id,
                    status: 'closed_won',
                    updatedAt: { gte: weekStart },
                },
            }),
            prisma_1.default.lead.count({
                where: {
                    companyId: agent.companyId,
                    assignedAgentId: agent.id,
                    status: { notIn: ['closed_won', 'closed_lost'] },
                    metadata: { path: ['lead_score'], equals: 'hot' },
                },
            }),
        ]);
        await sendNotification(agent.phone, agent.companyId, [
            `*Weekly Pipeline — ${agent.name}*`,
            `${(0, response_formatter_service_1.formatDateIST)(weekStart)} to ${(0, response_formatter_service_1.formatDateIST)(new Date())}`,
            `Active leads: ${active}`,
            `New this week: ${newLeads}`,
            `Hot leads: ${hot}`,
            `Visits completed: ${visitsDone}`,
            `Deals won: ${won}`,
        ].join('\n'));
        affected.add(agent.companyId);
    }
    return affected.result();
}
/** Nudge agents 2h after a visit was marked completed to log outcome / next step. */
async function sendVisitCompletedNudge() {
    const affected = trackCompanyIds();
    const windowEnd = new Date(Date.now() - VISIT_NUDGE_MIN_MS);
    const windowStart = new Date(Date.now() - VISIT_NUDGE_MAX_MS);
    const visits = await prisma_1.default.visit.findMany({
        where: {
            status: 'completed',
            updatedAt: { gte: windowStart, lte: windowEnd },
        },
        include: { agent: true, lead: true, property: true },
    });
    for (const visit of visits) {
        affected.add(visit.companyId);
        if (!visit.agent.phone)
            continue;
        const alreadyNudged = await prisma_1.default.agentActionLog.findFirst({
            where: {
                companyId: visit.companyId,
                action: 'sendVisitCompletedNudge',
                resourceType: 'visit',
                resourceId: visit.id,
            },
            select: { id: true },
        });
        if (alreadyNudged)
            continue;
        await sendNotification(visit.agent.phone, visit.companyId, [
            `*Post-Visit Follow-up*`,
            `Completed: ${visit.lead?.customerName ?? 'Unknown'} @ ${visit.property?.name ?? 'TBD'}`,
            'Log notes or schedule the next step for this lead.',
        ].join('\n'));
        void (0, agent_action_log_service_1.logAgentAction)({
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
async function sendMonthlyAdminReport() {
    const affected = trackCompanyIds();
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const admins = await prisma_1.default.user.findMany({
        where: { status: 'active', role: 'company_admin', phone: { not: null } },
        select: { name: true, phone: true, companyId: true },
    });
    for (const admin of admins) {
        if (!admin.phone)
            continue;
        const [newLeads, visits, won, lost, hot] = await Promise.all([
            prisma_1.default.lead.count({ where: { companyId: admin.companyId, createdAt: { gte: monthStart } } }),
            prisma_1.default.visit.count({ where: { companyId: admin.companyId, status: 'completed', updatedAt: { gte: monthStart } } }),
            prisma_1.default.lead.count({ where: { companyId: admin.companyId, status: 'closed_won', updatedAt: { gte: monthStart } } }),
            prisma_1.default.lead.count({ where: { companyId: admin.companyId, status: 'closed_lost', updatedAt: { gte: monthStart } } }),
            prisma_1.default.lead.count({
                where: {
                    companyId: admin.companyId,
                    status: { notIn: ['closed_won', 'closed_lost'] },
                    metadata: { path: ['lead_score'], equals: 'hot' },
                },
            }),
        ]);
        await sendNotification(admin.phone, admin.companyId, [
            `*Monthly Report — ${(0, response_formatter_service_1.formatDateIST)(monthStart)}*`,
            `New leads: ${newLeads}`,
            `Hot pipeline: ${hot}`,
            `Visits completed: ${visits}`,
            `Won: ${won} | Lost: ${lost}`,
        ].join('\n'));
        affected.add(admin.companyId);
    }
    return affected.result();
}
async function purgeActionLogCron() {
    const deleted = await (0, agent_action_log_service_1.purgeOldActionLogs)(90);
    logger_1.default.info('AgentActionLog purge completed', { deleted });
    return {};
}
async function runConfirmationCleanup() {
    await (0, confirmation_service_1.cleanupExpiredConfirmations)();
    return {};
}
function wrap(name, handler) {
    return () => {
        void (async () => {
            const started = Date.now();
            let affectedCompanyIds;
            try {
                const result = await handler();
                affectedCompanyIds = result.affectedCompanyIds;
                await logCronOutcome(name, 'success', Date.now() - started, undefined, affectedCompanyIds);
            }
            catch (error) {
                const durationMs = Date.now() - started;
                await logCronOutcome(name, 'failed', durationMs, error, affectedCompanyIds);
                await alertCompanyAdminsCronFailure(name, error, affectedCompanyIds);
                logger_1.default.error(`Agent AI cron failed: ${name}`, {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        })();
    };
}
function startCronScheduler() {
    if (!config_1.default.agentAi.cronEnabled || tasks.length)
        return;
    tasks.push(node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.MORNING_BRIEFING, wrap('morningBriefing', sendMorningBriefings)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.OWNER_DAILY_SUMMARY, wrap('ownerDailySummary', sendOwnerDailySummaries)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.END_OF_DAY_SUMMARY, wrap('endOfDaySummary', sendEndOfDaySummaries)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.VISIT_REMINDER_CHECK, wrap('visitReminder', sendVisitReminders)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.FOLLOW_UP_ALERT, wrap('followUpAlert', sendFollowUpAlerts)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.STALE_LEAD_ALERT, wrap('staleLeadAlert', sendStaleLeadAlerts)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.WEEKLY_ADMIN_REPORT, wrap('weeklyAdminReport', sendWeeklyAdminReports)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.EXPIRED_CONFIRMATION_CLEANUP, wrap('confirmationCleanup', runConfirmationCleanup)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.NO_SHOW_CHECK, wrap('detectAndMarkNoShows', detectAndMarkNoShows)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.HOT_LEAD_SLA_CHECK, wrap('sendHotLeadSlaAlerts', sendHotLeadSlaAlerts)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.AGENT_WEEKLY_PIPELINE, wrap('sendAgentWeeklyPipelineReport', sendAgentWeeklyPipelineReport)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.VISIT_COMPLETED_NUDGE, wrap('sendVisitCompletedNudge', sendVisitCompletedNudge)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.MONTHLY_ADMIN_REPORT, wrap('sendMonthlyAdminReport', sendMonthlyAdminReport)), node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.ACTION_LOG_PURGE, wrap('purgeActionLog', purgeActionLogCron)), 
    // EOD attendance check — 7:00 PM IST = 13:30 UTC. Asks agents YES/NO for unresolved visits.
    node_cron_1.default.schedule(agent_ai_constants_1.CRON_SCHEDULES.EOD_ATTENDANCE_CHECK, wrap('eodAttendanceChecks', sendEodAttendanceChecks)));
    logger_1.default.info('Agent AI cron scheduler started', { jobs: tasks.length });
}
function stopCronScheduler() {
    tasks.forEach((task) => task.stop());
    tasks.length = 0;
    logger_1.default.info('Agent AI cron scheduler stopped');
}
