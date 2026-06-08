import { z } from 'zod';
import prisma from '../../../config/prisma';
import { MAX_LIST_LIMIT, SLOT_DURATION_MINUTES, SLOT_END_HOUR, SLOT_START_HOUR } from '../../../constants/agent-tools.constants';
import { ToolContext } from '../agent-state';
import { buildVisitScopeFilter, formatDateIST, getISTDayBounds } from './format-helpers';
import { DynamicStructuredTool, type AgentTool } from './langchain-runtime';
import { ensureCallRequestsSchema } from '../../callRequest.service';

export function createCalendarTools(context: ToolContext): AgentTool[] {
  return [
    new DynamicStructuredTool({
      name: 'getCalendarEvents',
      description: 'Get visit and callback calendar events in a date range.',
      schema: z.object({ startDate: z.string(), endDate: z.string(), agentId: z.string().uuid().optional(), limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional() }),
      func: async ({ startDate, endDate, agentId, limit }) => {
        const [start] = getISTDayBounds(startDate);
        const [, end] = getISTDayBounds(endDate);
        const take = limit ?? MAX_LIST_LIMIT;
        const scopedAgentId = context.userRole === 'sales_agent' ? context.userId : agentId;
        const where: any = { ...buildVisitScopeFilter(context.companyId, context.userRole, context.userId), scheduledAt: { gte: start, lte: end } };
        if (scopedAgentId) where.agentId = scopedAgentId;

        await ensureCallRequestsSchema();
        const callParams: unknown[] = [context.companyId, start, end];
        let callAgentClause = '';
        if (scopedAgentId) {
          callParams.push(scopedAgentId);
          callAgentClause = ` AND cr.agent_id = $${callParams.length}::uuid`;
        }

        const [visits, calls] = await Promise.all([
          prisma.visit.findMany({ where, include: { lead: true, property: true, agent: true }, orderBy: { scheduledAt: 'asc' }, take }),
          prisma.$queryRawUnsafe<Array<{
            id: string;
            lead_id: string;
            scheduled_at: Date;
            status: string;
            customer_name: string | null;
            customer_phone: string | null;
          }>>(
            `SELECT cr.id::text, cr.lead_id::text, cr.scheduled_at, cr.status, l.customer_name, l.phone AS customer_phone
             FROM call_requests cr
             LEFT JOIN leads l ON l.id = cr.lead_id
             WHERE cr.company_id = $1::uuid
               AND cr.scheduled_at >= $2
               AND cr.scheduled_at <= $3
               ${callAgentClause}
             ORDER BY cr.scheduled_at ASC
             LIMIT ${Math.max(1, Math.min(take, MAX_LIST_LIMIT))}`,
            ...callParams,
          ),
        ]);

        const events = [
          ...visits.map((v) => ({
            at: v.scheduledAt,
            line: `${formatDateIST(v.scheduledAt)} - Visit: ${v.lead?.customerName ?? 'Unknown'} at ${v.property?.name ?? 'TBD'} (${v.status}) ID: ${v.id}`,
          })),
          ...calls.map((c) => ({
            at: new Date(c.scheduled_at),
            line: `${formatDateIST(new Date(c.scheduled_at))} - Call: ${c.customer_name ?? c.customer_phone ?? 'Unknown'} (${c.status}) ID: ${c.id}`,
          })),
        ].sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, take);

        if (!events.length) return 'No events found.';
        return [`*Calendar ${startDate} to ${endDate}*`, ...events.map((event) => event.line)].join('\n');
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
