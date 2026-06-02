import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import prisma from '../../../config/prisma';
import { MAX_LIST_LIMIT, SLOT_DURATION_MINUTES, SLOT_END_HOUR, SLOT_START_HOUR } from '../../../constants/agent-tools.constants';
import { ToolContext } from '../agent-state';
import { buildAgentScopeFilter, formatDateIST, getISTDayBounds } from './format-helpers';

export function createCalendarTools(context: ToolContext): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: 'getCalendarEvents',
      description: 'Get visit calendar events in a date range.',
      schema: z.object({ startDate: z.string(), endDate: z.string(), agentId: z.string().uuid().optional(), limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional() }),
      func: async ({ startDate, endDate, agentId, limit }) => {
        const [start] = getISTDayBounds(startDate);
        const [, end] = getISTDayBounds(endDate);
        const where: any = { ...buildAgentScopeFilter(context.companyId, context.userRole, context.userId, 'agentId'), scheduledAt: { gte: start, lte: end } };
        if (agentId && context.userRole !== 'sales_agent') where.agentId = agentId;
        const visits = await prisma.visit.findMany({ where, include: { lead: true, property: true, agent: true }, orderBy: { scheduledAt: 'asc' }, take: limit ?? MAX_LIST_LIMIT });
        if (!visits.length) return 'No events found.';
        return [`*Calendar ${startDate} to ${endDate}*`, ...visits.map((v) => `${formatDateIST(v.scheduledAt)} - ${v.lead?.customerName ?? 'Unknown'} at ${v.property?.name ?? 'TBD'} (${v.status}) ID: ${v.id}`)].join('\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'getAvailableSlots',
      description: 'Find available one-hour property visit slots for a date.',
      schema: z.object({ propertyId: z.string().uuid(), date: z.string() }),
      func: async ({ propertyId, date }) => {
        const property = await prisma.property.findFirst({ where: { id: propertyId, companyId: context.companyId }, select: { name: true } });
        if (!property) return 'Property not found.';
        const [start, end] = getISTDayBounds(date);
        const visits = await prisma.visit.findMany({ where: { companyId: context.companyId, propertyId, scheduledAt: { gte: start, lte: end }, status: { in: ['scheduled', 'confirmed'] } }, select: { scheduledAt: true } });
        const busy = new Set(visits.map((v) => new Date(v.scheduledAt.getTime() + 5.5 * 60 * 60 * 1000).getUTCHours()));
        const slots: string[] = [];
        for (let hour = SLOT_START_HOUR; hour < SLOT_END_HOUR; hour += SLOT_DURATION_MINUTES / 60) {
          if (!busy.has(hour)) slots.push(`${String(hour).padStart(2, '0')}:00 IST`);
        }
        return slots.length ? [`*Available slots for ${property.name} on ${date}*`, ...slots.map((s, i) => `${i + 1}. ${s}`)].join('\n') : `No slots available for ${property.name} on ${date}.`;
      },
    }),
  ];
}
