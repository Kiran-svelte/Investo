import { z } from 'zod';
import prisma from '../../../config/prisma';
import logger from '../../../config/logger';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../../constants/agent-tools.constants';
import { ToolContext } from '../agent-state';
import { createPendingConfirmation } from '../confirmation.service';
import { scheduleVisit } from '../../visitBooking.service';
import { markVisitAttended, markVisitNoShow, rescheduleVisitById } from '../../visitState.service';
import { buildVisitIdempotencyKey } from '../../visitBooking.service';
import {
  buildVisitScopeFilter,
  formatDateIST,
  getISTDayBounds,
  getStatusEmoji,
  getTodayIST,
  getTomorrowIST,
  maskPhone,
} from './format-helpers';
import { DynamicStructuredTool, type AgentTool } from './langchain-runtime';

const visitStatus = z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']);

function visitScope(context: ToolContext): Record<string, unknown> {
  return buildVisitScopeFilter(context.companyId, context.userRole, context.userId);
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
      name: 'listVisitsTomorrow',
      description: 'List visits scheduled for tomorrow (IST). Sales agents see their own visits and visits on their assigned leads.',
      schema: z.object({ limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional() }),
      func: async ({ limit }) => {
        const date = getTomorrowIST();
        const [start, end] = getISTDayBounds(date);
        const visits = await prisma.visit.findMany({
          where: { ...visitScope(context), scheduledAt: { gte: start, lte: end } },
          include,
          orderBy: { scheduledAt: 'asc' },
          take: limit ?? DEFAULT_LIST_LIMIT,
        });
        if (!visits.length) return `No visits scheduled for tomorrow (${date}).`;
        return [`*Tomorrow's Visits (${date})*`, ...visits.map(formatVisit)].join('\n\n');
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
        if (!propertyId) return 'Which property should I schedule the visit for?';
        const scheduledDate = new Date(scheduledAt);
        if (Number.isNaN(scheduledDate.getTime())) return 'Invalid visit date/time.';
        const booking = await scheduleVisit({
          companyId: context.companyId,
          leadId,
          propertyId,
          scheduledAt: scheduledDate,
          notes,
          durationMinutes,
          agentId: context.userRole === 'sales_agent' ? context.userId : undefined,
          idempotencyKey: buildVisitIdempotencyKey(
            context.companyId,
            leadId,
            scheduledDate.toISOString(),
          ),
        });
        if (!booking.success || !booking.visit) {
          if (booking.error === 'past_date') return 'Cannot schedule a visit in the past.';
          if (booking.error === 'agent_conflict') return 'That slot overlaps with another visit. Choose another time.';
          if (booking.error === 'invalid_lead_transition') return 'This lead cannot be moved to visit scheduled from its current status.';
          if (booking.error === 'property_not_found') return 'Property not found or not available.';
          if (booking.error === 'no_agent') return 'No active agent is available for this visit.';
          return 'Lead not found.';
        }
        const visit = await prisma.visit.findUnique({ where: { id: booking.visit.id }, include });
        if (!visit) return 'Visit scheduled, but I could not load the visit details.';
        return `Visit scheduled.\n\n${formatVisit(visit)}`;
      },
    }),
    new DynamicStructuredTool({
      name: 'completeVisit',
      description: 'Mark a visit completed and move lead to visited. Requires yes/no confirmation.',
      schema: z.object({ visitId: z.string().uuid(), notes: z.string().optional() }),
      func: async ({ visitId, notes }) => {
        const visit = await prisma.visit.findFirst({
          where: { id: visitId, ...visitScope(context) },
          include: { lead: { select: { customerName: true } }, property: { select: { name: true } } },
        });
        if (!visit) return 'Visit not found or access denied.';
        if (visit.status === 'completed') {
          return `Visit already completed.\n\n${formatVisit(visit)}`;
        }
        if (!context.sessionId) return 'Confirmation session unavailable.';
        const message =
          `Confirm marking ${visit.lead?.customerName ?? 'customer'}'s visit at ` +
          `${visit.property?.name ?? 'the property'} (${formatDateIST(visit.scheduledAt)}) as completed?\n` +
          `Reply "yes" to confirm or "no" to cancel.`;
        await createPendingConfirmation(context.sessionId, 'completeVisit', { visitId, notes }, message);
        return message;
      },
    }),
    new DynamicStructuredTool({
      name: 'markVisitNoShow',
      description: 'Mark a visit as no-show. Requires yes/no confirmation.',
      schema: z.object({ visitId: z.string().uuid(), notes: z.string().optional() }),
      func: async ({ visitId, notes }) => {
        const visit = await prisma.visit.findFirst({
          where: { id: visitId, ...visitScope(context) },
          include: { lead: { select: { customerName: true } }, property: { select: { name: true } } },
        });
        if (!visit) return 'Visit not found or access denied.';
        if (visit.status === 'no_show') {
          return `Visit already marked no-show.\n\n${formatVisit(visit)}`;
        }
        if (!context.sessionId) return 'Confirmation session unavailable.';
        const message =
          `Should I mark ${visit.lead?.customerName ?? 'customer'}'s visit at ` +
          `${visit.property?.name ?? 'the property'} (${formatDateIST(visit.scheduledAt)}) as no-show?\n` +
          `Reply "yes" to confirm or "no" to cancel.`;
        await createPendingConfirmation(context.sessionId, 'markVisitNoShow', { visitId, notes }, message);
        return message;
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
        const visit = await prisma.visit.findFirst({
          where: { id: visitId, ...visitScope(context) },
          select: { id: true, status: true, scheduledAt: true },
        });
        if (!visit) return 'Visit not found or access denied.';
        const scheduledDate = new Date(newScheduledAt);
        if (Number.isNaN(scheduledDate.getTime())) return 'Invalid new visit date/time.';
        const result = await rescheduleVisitById({
          companyId: context.companyId,
          visitId,
          scheduledAt: scheduledDate,
        });
        if (!result.success) {
          if (result.error === 'past_date') return 'Cannot reschedule a visit to the past.';
          if (result.error === 'visit_completed' || result.error === 'visit_cancelled' || result.error === 'visit_no_show') {
            return `Cannot reschedule a ${visit.status} visit.`;
          }
          return 'Visit not found or access denied.';
        }
        const updated = await prisma.visit.findUnique({ where: { id: visitId }, include });
        if (!updated) return 'Visit rescheduled.';
        return `Visit rescheduled.\n\n${formatVisit(updated)}`;
      },
    }),
    new DynamicStructuredTool({
      name: 'bulkReassignVisits',
      description:
        'Reassign all visits from one agent to another for a given date (defaults to today). ' +
        'Requires yes/no confirmation showing visit count.',
      schema: z.object({
        toAgentId: z.string().uuid().describe('Agent to receive the visits'),
        fromAgentId: z.string().uuid().optional().describe('Agent whose visits to move (defaults to caller)'),
        date: z.string().optional().describe('Date in YYYY-MM-DD format (defaults to today)'),
      }),
      func: async ({ toAgentId, fromAgentId, date }) => {
        const sourceAgentId = fromAgentId ?? context.userId;
        const targetDate = date ?? getTodayIST();
        const [start, end] = getISTDayBounds(targetDate);

        const toAgent = await prisma.user.findFirst({
          where: { id: toAgentId, companyId: context.companyId, status: 'active' },
          select: { id: true, name: true },
        });
        if (!toAgent) return 'Target agent not found or inactive.';

        const visits = await prisma.visit.findMany({
          where: {
            companyId: context.companyId,
            agentId: sourceAgentId,
            scheduledAt: { gte: start, lte: end },
            status: { in: ['scheduled', 'confirmed'] },
          },
          include,
        });
        if (!visits.length) return `No scheduled visits found for ${targetDate}.`;

        if (!context.sessionId) return 'Confirmation session unavailable.';
        const message =
          `Confirm reassignment of ${visits.length} visit(s) on ${targetDate} to ${toAgent.name}?\n` +
          `Reply "yes" to confirm or "no" to cancel.`;
        await createPendingConfirmation(
          context.sessionId,
          'bulkUpdateVisits',
          { visitIds: visits.map((v) => v.id), toAgentId, targetDate },
          message,
        );
        return message;
      },
    }),
    new DynamicStructuredTool({
      name: 'snoozeAllVisits',
      description:
        'Postpone all of the caller\'s scheduled/confirmed visits by N days. ' +
        'Useful when the agent is sick or unavailable. Requires yes/no confirmation.',
      schema: z.object({
        postponeByDays: z.number().int().min(1).max(30).default(7).describe('Number of days to postpone'),
        date: z.string().optional().describe('Date to snooze visits for in YYYY-MM-DD (defaults to today)'),
      }),
      func: async ({ postponeByDays, date }) => {
        const targetDate = date ?? getTodayIST();
        const [start, end] = getISTDayBounds(targetDate);

        const visits = await prisma.visit.findMany({
          where: {
            companyId: context.companyId,
            agentId: context.userId,
            scheduledAt: { gte: start, lte: end },
            status: { in: ['scheduled', 'confirmed'] },
          },
          include,
        });
        if (!visits.length) return `No scheduled visits found for ${targetDate}.`;

        if (!context.sessionId) return 'Confirmation session unavailable.';
        const message =
          `Confirm postponing ${visits.length} visit(s) on ${targetDate} by ${postponeByDays} day(s)?\n` +
          `Reply "yes" to confirm or "no" to cancel.`;
        await createPendingConfirmation(
          context.sessionId,
          'bulkUpdateVisits',
          { visitIds: visits.map((v) => v.id), postponeByDays, targetDate },
          message,
        );
        return message;
      },
    }),
  ];
}
