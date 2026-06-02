"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVisitTools = createVisitTools;
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../../../config/prisma"));
const agent_tools_constants_1 = require("../../../constants/agent-tools.constants");
const confirmation_service_1 = require("../confirmation.service");
const format_helpers_1 = require("./format-helpers");
const langchain_runtime_1 = require("./langchain-runtime");
const visitStatus = zod_1.z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']);
function visitScope(context) {
    return (0, format_helpers_1.buildAgentScopeFilter)(context.companyId, context.userRole, context.userId, 'agentId');
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
                const visit = await prisma_1.default.visit.findFirst({ where: { id: visitId, ...visitScope(context) }, select: { id: true, status: true } });
                if (!visit)
                    return 'Visit not found or access denied.';
                if (visit.status === 'completed' || visit.status === 'cancelled')
                    return `Cannot reschedule a ${visit.status} visit.`;
                const updated = await prisma_1.default.visit.update({ where: { id: visitId }, data: { scheduledAt: new Date(newScheduledAt), reminderSent: false }, include });
                return `Visit rescheduled.\n\n${formatVisit(updated)}`;
            },
        }),
    ];
}
