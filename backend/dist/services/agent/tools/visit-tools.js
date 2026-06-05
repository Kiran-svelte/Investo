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
exports.createVisitTools = createVisitTools;
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../../../config/prisma"));
const logger_1 = __importDefault(require("../../../config/logger"));
const agent_tools_constants_1 = require("../../../constants/agent-tools.constants");
const confirmation_service_1 = require("../confirmation.service");
const format_helpers_1 = require("./format-helpers");
const langchain_runtime_1 = require("./langchain-runtime");
const visitStatus = zod_1.z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']);
function visitScope(context) {
    return (0, format_helpers_1.buildVisitScopeFilter)(context.companyId, context.userRole, context.userId);
}
function formatVisit(visit) {
    return [
        `${(0, format_helpers_1.getStatusEmoji)(visit.status)} *${visit.lead?.customerName ?? 'Unknown'}* (${(0, format_helpers_1.maskPhone)(visit.lead?.phone)})`,
        `Property: ${visit.property?.name ?? 'TBD'}`,
        `Time: ${(0, format_helpers_1.formatDateIST)(visit.scheduledAt)} | Status: ${visit.status}`,
        `Agent: ${visit.agent?.name ?? 'Unassigned'}`,
        `ID: ${visit.id}`,
    ].join('\n');
}
const include = {
    lead: { select: { customerName: true, phone: true } },
    property: { select: { name: true } },
    agent: { select: { name: true } },
};
function createVisitTools(context) {
    return [
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'listVisitsToday',
            description: 'List visits scheduled today. Sales agents see only their own visits.',
            schema: zod_1.z.object({ limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional() }),
            func: async ({ limit }) => {
                const [start, end] = (0, format_helpers_1.getISTDayBounds)((0, format_helpers_1.getTodayIST)());
                const visits = await prisma_1.default.visit.findMany({
                    where: { ...visitScope(context), scheduledAt: { gte: start, lte: end } },
                    include,
                    orderBy: { scheduledAt: 'asc' },
                    take: limit ?? agent_tools_constants_1.DEFAULT_LIST_LIMIT,
                });
                if (!visits.length)
                    return 'No visits scheduled today.';
                return ['*Today\'s Visits*', ...visits.map(formatVisit)].join('\n\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'listVisitsTomorrow',
            description: 'List visits scheduled for tomorrow (IST). Sales agents see their own visits and visits on their assigned leads.',
            schema: zod_1.z.object({ limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional() }),
            func: async ({ limit }) => {
                const date = (0, format_helpers_1.getTomorrowIST)();
                const [start, end] = (0, format_helpers_1.getISTDayBounds)(date);
                const visits = await prisma_1.default.visit.findMany({
                    where: { ...visitScope(context), scheduledAt: { gte: start, lte: end } },
                    include,
                    orderBy: { scheduledAt: 'asc' },
                    take: limit ?? agent_tools_constants_1.DEFAULT_LIST_LIMIT,
                });
                if (!visits.length)
                    return `No visits scheduled for tomorrow (${date}).`;
                return [`*Tomorrow's Visits (${date})*`, ...visits.map(formatVisit)].join('\n\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'listVisitsByDateRange',
            description: 'List visits in a date range with optional status and agent filter.',
            schema: zod_1.z.object({ startDate: zod_1.z.string(), endDate: zod_1.z.string(), status: visitStatus.optional(), agentId: zod_1.z.string().uuid().optional(), limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional() }),
            func: async ({ startDate, endDate, status, agentId, limit }) => {
                const [start] = (0, format_helpers_1.getISTDayBounds)(startDate);
                const [, end] = (0, format_helpers_1.getISTDayBounds)(endDate);
                const where = { ...visitScope(context), scheduledAt: { gte: start, lte: end }, ...(status ? { status } : {}) };
                if (agentId && context.userRole !== 'sales_agent')
                    where.agentId = agentId;
                const visits = await prisma_1.default.visit.findMany({ where, include, orderBy: { scheduledAt: 'asc' }, take: limit ?? agent_tools_constants_1.DEFAULT_LIST_LIMIT });
                if (!visits.length)
                    return 'No visits found.';
                return [`*Visits ${startDate} to ${endDate}*`, ...visits.map(formatVisit)].join('\n\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getVisitDetails',
            description: 'Get full visit details.',
            schema: zod_1.z.object({ visitId: zod_1.z.string().uuid() }),
            func: async ({ visitId }) => {
                const visit = await prisma_1.default.visit.findFirst({ where: { id: visitId, ...visitScope(context) }, include });
                if (!visit)
                    return 'Visit not found or access denied.';
                return formatVisit(visit);
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'scheduleVisit',
            description: 'Schedule a site visit and update new/contacted lead to visit_scheduled.',
            schema: zod_1.z.object({ leadId: zod_1.z.string().uuid(), propertyId: zod_1.z.string().uuid().optional(), scheduledAt: zod_1.z.string(), notes: zod_1.z.string().optional(), durationMinutes: zod_1.z.number().int().min(15).max(480).default(60) }),
            func: async ({ leadId, propertyId, scheduledAt, notes, durationMinutes }) => {
                const lead = await prisma_1.default.lead.findFirst({ where: { id: leadId, companyId: context.companyId }, select: { id: true, status: true } });
                if (!lead)
                    return 'Lead not found.';
                const visit = await prisma_1.default.visit.create({
                    data: { companyId: context.companyId, leadId, propertyId: propertyId ?? null, agentId: context.userId, scheduledAt: new Date(scheduledAt), notes: notes ?? null, durationMinutes, status: 'scheduled' },
                    include,
                });
                if (agent_tools_constants_1.LEAD_STATUSES_FOR_AUTO_VISIT_UPGRADE.has(lead.status)) {
                    await prisma_1.default.lead.update({ where: { id: leadId }, data: { status: 'visit_scheduled' } });
                }
                return `Visit scheduled.\n\n${formatVisit(visit)}`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'completeVisit',
            description: 'Mark a visit completed and move lead to visited.',
            schema: zod_1.z.object({ visitId: zod_1.z.string().uuid(), notes: zod_1.z.string().optional() }),
            func: async ({ visitId, notes }) => {
                const visit = await prisma_1.default.visit.findFirst({ where: { id: visitId, ...visitScope(context) }, select: { id: true, leadId: true, status: true } });
                if (!visit)
                    return 'Visit not found or access denied.';
                if (visit.status === 'cancelled')
                    return 'Cannot complete a cancelled visit.';
                const updated = await prisma_1.default.visit.update({ where: { id: visitId }, data: { status: 'completed', notes: notes ?? undefined }, include });
                await prisma_1.default.lead.update({ where: { id: visit.leadId }, data: { status: 'visited', lastContactAt: new Date() } });
                return `Visit completed.\n\n${formatVisit(updated)}`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'cancelVisit',
            description: 'Cancel a visit. Requires yes/no confirmation.',
            schema: zod_1.z.object({ visitId: zod_1.z.string().uuid(), reason: zod_1.z.string().optional() }),
            func: async ({ visitId, reason }) => {
                const visit = await prisma_1.default.visit.findFirst({ where: { id: visitId, ...visitScope(context) }, include });
                if (!visit)
                    return 'Visit not found or access denied.';
                if (visit.status === 'completed')
                    return 'Cannot cancel a completed visit.';
                if (!context.sessionId)
                    return 'Confirmation session unavailable.';
                const message = `Confirm cancellation of visit with ${visit.lead?.customerName ?? 'Unknown'} at ${(0, format_helpers_1.formatDateIST)(visit.scheduledAt)}?\nReply "yes" to confirm or "no" to cancel.`;
                await (0, confirmation_service_1.createPendingConfirmation)(context.sessionId, 'cancelVisit', { visitId, reason }, message);
                return message;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'rescheduleVisit',
            description: 'Reschedule a visit to a new date/time.',
            schema: zod_1.z.object({ visitId: zod_1.z.string().uuid(), newScheduledAt: zod_1.z.string() }),
            func: async ({ visitId, newScheduledAt }) => {
                const visit = await prisma_1.default.visit.findFirst({
                    where: { id: visitId, ...visitScope(context) },
                    // Fetch scheduledAt (old time) so the agent notification shows before/after delta.
                    select: { id: true, status: true, scheduledAt: true, leadId: true, companyId: true },
                });
                if (!visit)
                    return 'Visit not found or access denied.';
                if (visit.status === 'completed' || visit.status === 'cancelled')
                    return `Cannot reschedule a ${visit.status} visit.`;
                const oldScheduledAt = visit.scheduledAt;
                const updated = await prisma_1.default.visit.update({
                    where: { id: visitId },
                    data: { scheduledAt: new Date(newScheduledAt), reminderSent: false },
                    include,
                });
                // Notify the assigned agent immediately — dashboard DB record + WhatsApp message.
                // Fire-and-forget: a notification failure must never fail the reschedule itself.
                void (async () => {
                    try {
                        const { notificationEngine } = await Promise.resolve().then(() => __importStar(require('../../notification.engine')));
                        const company = await prisma_1.default.company.findUnique({ where: { id: visit.companyId } });
                        const lead = visit.leadId
                            ? await prisma_1.default.lead.findUnique({ where: { id: visit.leadId }, select: { customerName: true, phone: true } })
                            : null;
                        if (company && lead) {
                            await notificationEngine.onVisitRescheduled(updated, oldScheduledAt, new Date(newScheduledAt), lead, company);
                        }
                    }
                    catch (err) {
                        logger_1.default.warn('rescheduleVisit: agent notification failed', {
                            visitId,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                })();
                return `Visit rescheduled.\n\n${formatVisit(updated)}`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'bulkReassignVisits',
            description: 'Reassign all visits from one agent to another for a given date (defaults to today). ' +
                'Requires yes/no confirmation showing visit count.',
            schema: zod_1.z.object({
                toAgentId: zod_1.z.string().uuid().describe('Agent to receive the visits'),
                fromAgentId: zod_1.z.string().uuid().optional().describe('Agent whose visits to move (defaults to caller)'),
                date: zod_1.z.string().optional().describe('Date in YYYY-MM-DD format (defaults to today)'),
            }),
            func: async ({ toAgentId, fromAgentId, date }) => {
                const sourceAgentId = fromAgentId ?? context.userId;
                const targetDate = date ?? (0, format_helpers_1.getTodayIST)();
                const [start, end] = (0, format_helpers_1.getISTDayBounds)(targetDate);
                const toAgent = await prisma_1.default.user.findFirst({
                    where: { id: toAgentId, companyId: context.companyId, status: 'active' },
                    select: { id: true, name: true },
                });
                if (!toAgent)
                    return 'Target agent not found or inactive.';
                const visits = await prisma_1.default.visit.findMany({
                    where: {
                        companyId: context.companyId,
                        agentId: sourceAgentId,
                        scheduledAt: { gte: start, lte: end },
                        status: { in: ['scheduled', 'confirmed'] },
                    },
                    include,
                });
                if (!visits.length)
                    return `No scheduled visits found for ${targetDate}.`;
                if (!context.sessionId)
                    return 'Confirmation session unavailable.';
                const message = `Confirm reassignment of ${visits.length} visit(s) on ${targetDate} to ${toAgent.name}?\n` +
                    `Reply "yes" to confirm or "no" to cancel.`;
                await (0, confirmation_service_1.createPendingConfirmation)(context.sessionId, 'bulkUpdateVisits', { visitIds: visits.map((v) => v.id), toAgentId, targetDate }, message);
                return message;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'snoozeAllVisits',
            description: 'Postpone all of the caller\'s scheduled/confirmed visits by N days. ' +
                'Useful when the agent is sick or unavailable. Requires yes/no confirmation.',
            schema: zod_1.z.object({
                postponeByDays: zod_1.z.number().int().min(1).max(30).default(7).describe('Number of days to postpone'),
                date: zod_1.z.string().optional().describe('Date to snooze visits for in YYYY-MM-DD (defaults to today)'),
            }),
            func: async ({ postponeByDays, date }) => {
                const targetDate = date ?? (0, format_helpers_1.getTodayIST)();
                const [start, end] = (0, format_helpers_1.getISTDayBounds)(targetDate);
                const visits = await prisma_1.default.visit.findMany({
                    where: {
                        companyId: context.companyId,
                        agentId: context.userId,
                        scheduledAt: { gte: start, lte: end },
                        status: { in: ['scheduled', 'confirmed'] },
                    },
                    include,
                });
                if (!visits.length)
                    return `No scheduled visits found for ${targetDate}.`;
                if (!context.sessionId)
                    return 'Confirmation session unavailable.';
                const message = `Confirm postponing ${visits.length} visit(s) on ${targetDate} by ${postponeByDays} day(s)?\n` +
                    `Reply "yes" to confirm or "no" to cancel.`;
                await (0, confirmation_service_1.createPendingConfirmation)(context.sessionId, 'bulkUpdateVisits', { visitIds: visits.map((v) => v.id), postponeByDays, targetDate }, message);
                return message;
            },
        }),
    ];
}
