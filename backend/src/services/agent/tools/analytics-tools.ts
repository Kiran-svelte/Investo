import { z } from 'zod';
import prisma from '../../../config/prisma';
import { ToolContext } from '../agent-state';
import { formatCurrencyINR, getISTDayBounds, getTodayIST, isAdminRole } from './format-helpers';
import { DynamicStructuredTool, type AgentTool } from './langchain-runtime';

const rangeSchema = z.object({ startDate: z.string().optional(), endDate: z.string().optional() }).optional();

function range(input?: { startDate?: string; endDate?: string }): [Date, Date] {
  const today = getTodayIST();
  const [start] = getISTDayBounds(input?.startDate ?? today);
  const [, end] = getISTDayBounds(input?.endDate ?? today);
  return [start, end];
}

function leadScope(context: ToolContext, agentId?: string): any {
  return { companyId: context.companyId, ...(context.userRole === 'sales_agent' ? { assignedAgentId: context.userId } : agentId ? { assignedAgentId: agentId } : {}) };
}

function visitScope(context: ToolContext, agentId?: string): any {
  return { companyId: context.companyId, ...(context.userRole === 'sales_agent' ? { agentId: context.userId } : agentId ? { agentId } : {}) };
}

export function createAnalyticsTools(context: ToolContext): AgentTool[] {
  return [
    new DynamicStructuredTool({
      name: 'getDashboardStats',
      description: 'Get KPI overview for leads, properties, visits, deals, and revenue.',
      schema: z.object({ dateRange: rangeSchema }),
      func: async ({ dateRange }) => {
        const [start, end] = range(dateRange);
        const [leads, newLeads, properties, visits, completed, won, lost, revenue] = await Promise.all([
          prisma.lead.count({ where: leadScope(context) }),
          prisma.lead.count({ where: { ...leadScope(context), status: 'new' } }),
          prisma.property.count({ where: { companyId: context.companyId } }),
          prisma.visit.count({ where: { ...visitScope(context), scheduledAt: { gte: start, lte: end } } }),
          prisma.visit.count({ where: { ...visitScope(context), status: 'completed', updatedAt: { gte: start, lte: end } } }),
          prisma.lead.count({ where: { ...leadScope(context), status: 'closed_won' } }),
          prisma.lead.count({ where: { ...leadScope(context), status: 'closed_lost' } }),
          prisma.analytics.aggregate({ where: { companyId: context.companyId, date: { gte: start, lte: end } }, _sum: { revenue: true } }),
        ]);
        return [`*Dashboard Summary*`, `Leads: ${leads} total | ${newLeads} new | ${won} won | ${lost} lost`, `Properties: ${properties}`, `Visits: ${visits} scheduled | ${completed} completed`, `Revenue: ${formatCurrencyINR(revenue._sum.revenue ?? 0)}`].join('\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'getAgentPerformance',
      description: 'Get agent or team performance. Sales agents see self only.',
      schema: z.object({ agentId: z.string().uuid().optional(), dateRange: rangeSchema }),
      func: async ({ agentId, dateRange }) => {
        const [start, end] = range(dateRange);
        const effectiveAgentId = context.userRole === 'sales_agent' ? context.userId : agentId;
        const agents = await prisma.user.findMany({ where: { companyId: context.companyId, role: 'sales_agent', status: 'active', ...(effectiveAgentId ? { id: effectiveAgentId } : {}) }, select: { id: true, name: true }, take: isAdminRole(context.userRole) ? 20 : 1 });
        if (!agents.length) return 'No agents found.';
        const rows = await Promise.all(agents.map(async (agent) => {
          const [leads, visits, completed, won] = await Promise.all([
            prisma.lead.count({ where: { companyId: context.companyId, assignedAgentId: agent.id } }),
            prisma.visit.count({ where: { companyId: context.companyId, agentId: agent.id, scheduledAt: { gte: start, lte: end } } }),
            prisma.visit.count({ where: { companyId: context.companyId, agentId: agent.id, status: 'completed', updatedAt: { gte: start, lte: end } } }),
            prisma.lead.count({ where: { companyId: context.companyId, assignedAgentId: agent.id, status: 'closed_won' } }),
          ]);
          return `${agent.name}: ${leads} leads | ${completed}/${visits} visits | ${won} won`;
        }));
        return ['*Agent Performance*', ...rows].join('\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'getLeadAnalytics',
      description: 'Get lead counts by source and status.',
      schema: z.object({ dateRange: rangeSchema }),
      func: async () => {
        const [sources, statuses] = await Promise.all([
          prisma.lead.groupBy({ by: ['source'], where: leadScope(context), _count: { _all: true } }),
          prisma.lead.groupBy({ by: ['status'], where: leadScope(context), _count: { _all: true } }),
        ]);
        return ['*Lead Analytics*', '*Sources*', ...sources.map((r) => `${r.source}: ${r._count._all}`), '*Statuses*', ...statuses.map((r) => `${r.status}: ${r._count._all}`)].join('\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'getPipelineFunnel',
      description: 'Get pipeline funnel by status.',
      schema: z.object({ dateRange: rangeSchema }),
      func: async () => {
        const rows = await prisma.lead.groupBy({ by: ['status'], where: leadScope(context), _count: { _all: true } });
        return ['*Pipeline Funnel*', ...rows.map((r) => `${r.status}: ${r._count._all}`)].join('\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'getMyPerformance',
      description: 'Get the caller performance.',
      schema: z.object({ dateRange: rangeSchema }),
      func: async ({ dateRange }) => {
        const [start, end] = range(dateRange);
        const [leads, visits, completed, won] = await Promise.all([
          prisma.lead.count({ where: { companyId: context.companyId, assignedAgentId: context.userId } }),
          prisma.visit.count({ where: { companyId: context.companyId, agentId: context.userId, scheduledAt: { gte: start, lte: end } } }),
          prisma.visit.count({ where: { companyId: context.companyId, agentId: context.userId, status: 'completed', updatedAt: { gte: start, lte: end } } }),
          prisma.lead.count({ where: { companyId: context.companyId, assignedAgentId: context.userId, status: 'closed_won' } }),
        ]);
        return [`*My Performance*`, `Leads: ${leads}`, `Visits: ${completed}/${visits}`, `Won: ${won}`].join('\n');
      },
    }),
  ];
}
