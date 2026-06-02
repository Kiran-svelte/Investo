import { z } from 'zod';
import prisma from '../../../config/prisma';
import { DEFAULT_LIST_LIMIT, LEAD_STATUSES_FOR_AUTO_VISIT_UPGRADE, MAX_LIST_LIMIT } from '../../../constants/agent-tools.constants';
import { ToolContext } from '../agent-state';
import { createPendingConfirmation } from '../confirmation.service';
import { buildAgentScopeFilter, formatDateIST, getISTDayBounds, getStatusEmoji, getTodayIST, maskPhone } from './format-helpers';
import { DynamicStructuredTool, type AgentTool } from './langchain-runtime';

const visitStatus = z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']);

function visitScope(context: ToolContext): Record<string, unknown> {
  return buildAgentScopeFilter(context.companyId, context.userRole, context.userId, 'agentId');
}

function formatVisit(visit: any): string {
  return [
    `${getStatusEmoji(visit.status)} *${visit.lead?.customerName ?? 'Unknown'}* (${maskPhone(visit.lead?.phone)})`,
    `Property: ${visit.property?.name ?? 'TBD'}`,
    `Time: ${formatDateIST(visit.scheduledAt)} | Status: ${visit.status}`,
    `Agent: ${visit.agent?.name ?? 'Unassigned'}`,
    `ID: ${visit.id}`,
  ].join('\n');
}

const include = {
  lead: { select: { customerName: true, phone: true } },
  property: { select: { name: true } },
  agent: { select: { name: true } },
};

export function createVisitTools(context: ToolContext): AgentTool[] {
  return [
    new DynamicStructuredTool({
      name: 'listVisitsToday',
      description: 'List visits scheduled today. Sales agents see only their own visits.',
      schema: z.object({ limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional() }),
      func: async ({ limit }) => {
        const [start, end] = getISTDayBounds(getTodayIST());
        const visits = await prisma.visit.findMany({
          where: { ...visitScope(context), scheduledAt: { gte: start, lte: end } },
          include,
          orderBy: { scheduledAt: 'asc' },
          take: limit ?? DEFAULT_LIST_LIMIT,
        });
        if (!visits.length) return 'No visits scheduled today.';
        return ['*Today\'s Visits*', ...visits.map(formatVisit)].join('\n\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'listVisitsByDateRange',
      description: 'List visits in a date range with optional status and agent filter.',
      schema: z.object({ startDate: z.string(), endDate: z.string(), status: visitStatus.optional(), agentId: z.string().uuid().optional(), limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional() }),
      func: async ({ startDate, endDate, status, agentId, limit }) => {
        const [start] = getISTDayBounds(startDate);
        const [, end] = getISTDayBounds(endDate);
        const where: any = { ...visitScope(context), scheduledAt: { gte: start, lte: end }, ...(status ? { status } : {}) };
        if (agentId && context.userRole !== 'sales_agent') where.agentId = agentId;
        const visits = await prisma.visit.findMany({ where, include, orderBy: { scheduledAt: 'asc' }, take: limit ?? DEFAULT_LIST_LIMIT });
        if (!visits.length) return 'No visits found.';
        return [`*Visits ${startDate} to ${endDate}*`, ...visits.map(formatVisit)].join('\n\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'getVisitDetails',
      description: 'Get full visit details.',
      schema: z.object({ visitId: z.string().uuid() }),
      func: async ({ visitId }) => {
        const visit = await prisma.visit.findFirst({ where: { id: visitId, ...visitScope(context) }, include });
        if (!visit) return 'Visit not found or access denied.';
        return formatVisit(visit);
      },
    }),
    new DynamicStructuredTool({
      name: 'scheduleVisit',
      description: 'Schedule a site visit and update new/contacted lead to visit_scheduled.',
      schema: z.object({ leadId: z.string().uuid(), propertyId: z.string().uuid().optional(), scheduledAt: z.string(), notes: z.string().optional(), durationMinutes: z.number().int().min(15).max(480).default(60) }),
      func: async ({ leadId, propertyId, scheduledAt, notes, durationMinutes }) => {
        const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId: context.companyId }, select: { id: true, status: true } });
        if (!lead) return 'Lead not found.';
        const visit = await prisma.visit.create({
          data: { companyId: context.companyId, leadId, propertyId: propertyId ?? null, agentId: context.userId, scheduledAt: new Date(scheduledAt), notes: notes ?? null, durationMinutes, status: 'scheduled' },
          include,
        });
        if (LEAD_STATUSES_FOR_AUTO_VISIT_UPGRADE.has(lead.status)) {
          await prisma.lead.update({ where: { id: leadId }, data: { status: 'visit_scheduled' } });
        }
        return `Visit scheduled.\n\n${formatVisit(visit)}`;
      },
    }),
    new DynamicStructuredTool({
      name: 'completeVisit',
      description: 'Mark a visit completed and move lead to visited.',
      schema: z.object({ visitId: z.string().uuid(), notes: z.string().optional() }),
      func: async ({ visitId, notes }) => {
        const visit = await prisma.visit.findFirst({ where: { id: visitId, ...visitScope(context) }, select: { id: true, leadId: true, status: true } });
        if (!visit) return 'Visit not found or access denied.';
        if (visit.status === 'cancelled') return 'Cannot complete a cancelled visit.';
        const updated = await prisma.visit.update({ where: { id: visitId }, data: { status: 'completed', notes: notes ?? undefined }, include });
        await prisma.lead.update({ where: { id: visit.leadId }, data: { status: 'visited', lastContactAt: new Date() } });
        return `Visit completed.\n\n${formatVisit(updated)}`;
      },
    }),
    new DynamicStructuredTool({
      name: 'cancelVisit',
      description: 'Cancel a visit. Requires yes/no confirmation.',
      schema: z.object({ visitId: z.string().uuid(), reason: z.string().optional() }),
      func: async ({ visitId, reason }) => {
        const visit = await prisma.visit.findFirst({ where: { id: visitId, ...visitScope(context) }, include });
        if (!visit) return 'Visit not found or access denied.';
        if (visit.status === 'completed') return 'Cannot cancel a completed visit.';
        if (!context.sessionId) return 'Confirmation session unavailable.';
        const message = `Confirm cancellation of visit with ${visit.lead?.customerName ?? 'Unknown'} at ${formatDateIST(visit.scheduledAt)}?\nReply "yes" to confirm or "no" to cancel.`;
        await createPendingConfirmation(context.sessionId, 'cancelVisit', { visitId, reason }, message);
        return message;
      },
    }),
    new DynamicStructuredTool({
      name: 'rescheduleVisit',
      description: 'Reschedule a visit to a new date/time.',
      schema: z.object({ visitId: z.string().uuid(), newScheduledAt: z.string() }),
      func: async ({ visitId, newScheduledAt }) => {
        const visit = await prisma.visit.findFirst({ where: { id: visitId, ...visitScope(context) }, select: { id: true, status: true } });
        if (!visit) return 'Visit not found or access denied.';
        if (visit.status === 'completed' || visit.status === 'cancelled') return `Cannot reschedule a ${visit.status} visit.`;
        const updated = await prisma.visit.update({ where: { id: visitId }, data: { scheduledAt: new Date(newScheduledAt), reminderSent: false }, include });
        return `Visit rescheduled.\n\n${formatVisit(updated)}`;
      },
    }),
  ];
}
