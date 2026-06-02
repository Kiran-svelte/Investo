"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAnalyticsTools = createAnalyticsTools;
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../../../config/prisma"));
const format_helpers_1 = require("./format-helpers");
const langchain_runtime_1 = require("./langchain-runtime");
const rangeSchema = zod_1.z.object({ startDate: zod_1.z.string().optional(), endDate: zod_1.z.string().optional() }).optional();
function range(input) {
    const today = (0, format_helpers_1.getTodayIST)();
    const [start] = (0, format_helpers_1.getISTDayBounds)(input?.startDate ?? today);
    const [, end] = (0, format_helpers_1.getISTDayBounds)(input?.endDate ?? today);
    return [start, end];
}
function leadScope(context, agentId) {
    return { companyId: context.companyId, ...(context.userRole === 'sales_agent' ? { assignedAgentId: context.userId } : agentId ? { assignedAgentId: agentId } : {}) };
}
function visitScope(context, agentId) {
    return { companyId: context.companyId, ...(context.userRole === 'sales_agent' ? { agentId: context.userId } : agentId ? { agentId } : {}) };
}
function createAnalyticsTools(context) {
    return [
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getDashboardStats',
            description: 'Get KPI overview for leads, properties, visits, deals, and revenue.',
            schema: zod_1.z.object({ dateRange: rangeSchema }),
            func: async ({ dateRange }) => {
                const [start, end] = range(dateRange);
                const [leads, newLeads, properties, visits, completed, won, lost, revenue] = await Promise.all([
                    prisma_1.default.lead.count({ where: leadScope(context) }),
                    prisma_1.default.lead.count({ where: { ...leadScope(context), status: 'new' } }),
                    prisma_1.default.property.count({ where: { companyId: context.companyId } }),
                    prisma_1.default.visit.count({ where: { ...visitScope(context), scheduledAt: { gte: start, lte: end } } }),
                    prisma_1.default.visit.count({ where: { ...visitScope(context), status: 'completed', updatedAt: { gte: start, lte: end } } }),
                    prisma_1.default.lead.count({ where: { ...leadScope(context), status: 'closed_won' } }),
                    prisma_1.default.lead.count({ where: { ...leadScope(context), status: 'closed_lost' } }),
                    prisma_1.default.analytics.aggregate({ where: { companyId: context.companyId, date: { gte: start, lte: end } }, _sum: { revenue: true } }),
                ]);
                return [`*Dashboard Summary*`, `Leads: ${leads} total | ${newLeads} new | ${won} won | ${lost} lost`, `Properties: ${properties}`, `Visits: ${visits} scheduled | ${completed} completed`, `Revenue: ${(0, format_helpers_1.formatCurrencyINR)(revenue._sum.revenue ?? 0)}`].join('\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getAgentPerformance',
            description: 'Get agent or team performance. Sales agents see self only.',
            schema: zod_1.z.object({ agentId: zod_1.z.string().uuid().optional(), dateRange: rangeSchema }),
            func: async ({ agentId, dateRange }) => {
                const [start, end] = range(dateRange);
                const effectiveAgentId = context.userRole === 'sales_agent' ? context.userId : agentId;
                const agents = await prisma_1.default.user.findMany({ where: { companyId: context.companyId, role: 'sales_agent', status: 'active', ...(effectiveAgentId ? { id: effectiveAgentId } : {}) }, select: { id: true, name: true }, take: (0, format_helpers_1.isAdminRole)(context.userRole) ? 20 : 1 });
                if (!agents.length)
                    return 'No agents found.';
                const rows = await Promise.all(agents.map(async (agent) => {
                    const [leads, visits, completed, won] = await Promise.all([
                        prisma_1.default.lead.count({ where: { companyId: context.companyId, assignedAgentId: agent.id } }),
                        prisma_1.default.visit.count({ where: { companyId: context.companyId, agentId: agent.id, scheduledAt: { gte: start, lte: end } } }),
                        prisma_1.default.visit.count({ where: { companyId: context.companyId, agentId: agent.id, status: 'completed', updatedAt: { gte: start, lte: end } } }),
                        prisma_1.default.lead.count({ where: { companyId: context.companyId, assignedAgentId: agent.id, status: 'closed_won' } }),
                    ]);
                    return `${agent.name}: ${leads} leads | ${completed}/${visits} visits | ${won} won`;
                }));
                return ['*Agent Performance*', ...rows].join('\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getLeadAnalytics',
            description: 'Get lead counts by source and status.',
            schema: zod_1.z.object({ dateRange: rangeSchema }),
            func: async () => {
                const [sources, statuses] = await Promise.all([
                    prisma_1.default.lead.groupBy({ by: ['source'], where: leadScope(context), _count: { _all: true } }),
                    prisma_1.default.lead.groupBy({ by: ['status'], where: leadScope(context), _count: { _all: true } }),
                ]);
                return ['*Lead Analytics*', '*Sources*', ...sources.map((r) => `${r.source}: ${r._count._all}`), '*Statuses*', ...statuses.map((r) => `${r.status}: ${r._count._all}`)].join('\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getPipelineFunnel',
            description: 'Get pipeline funnel by status.',
            schema: zod_1.z.object({ dateRange: rangeSchema }),
            func: async () => {
                const rows = await prisma_1.default.lead.groupBy({ by: ['status'], where: leadScope(context), _count: { _all: true } });
                return ['*Pipeline Funnel*', ...rows.map((r) => `${r.status}: ${r._count._all}`)].join('\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getMyPerformance',
            description: 'Get the caller performance.',
            schema: zod_1.z.object({ dateRange: rangeSchema }),
            func: async ({ dateRange }) => {
                const [start, end] = range(dateRange);
                const [leads, visits, completed, won] = await Promise.all([
                    prisma_1.default.lead.count({ where: { companyId: context.companyId, assignedAgentId: context.userId } }),
                    prisma_1.default.visit.count({ where: { companyId: context.companyId, agentId: context.userId, scheduledAt: { gte: start, lte: end } } }),
                    prisma_1.default.visit.count({ where: { companyId: context.companyId, agentId: context.userId, status: 'completed', updatedAt: { gte: start, lte: end } } }),
                    prisma_1.default.lead.count({ where: { companyId: context.companyId, assignedAgentId: context.userId, status: 'closed_won' } }),
                ]);
                return [`*My Performance*`, `Leads: ${leads}`, `Visits: ${completed}/${visits}`, `Won: ${won}`].join('\n');
            },
        }),
    ];
}
