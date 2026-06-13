"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCalendarTools = createCalendarTools;
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../../../config/prisma"));
const agent_tools_constants_1 = require("../../../constants/agent-tools.constants");
const format_helpers_1 = require("./format-helpers");
const langchain_runtime_1 = require("./langchain-runtime");
const callRequest_service_1 = require("../../callRequest.service");
function createCalendarTools(context) {
    return [
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getCalendarEvents',
            description: 'Get visit and callback calendar events in a date range.',
            schema: zod_1.z.object({ startDate: zod_1.z.string(), endDate: zod_1.z.string(), agentId: zod_1.z.string().uuid().optional(), limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional() }),
            func: async ({ startDate, endDate, agentId, limit }) => {
                const [start] = (0, format_helpers_1.getISTDayBounds)(startDate);
                const [, end] = (0, format_helpers_1.getISTDayBounds)(endDate);
                const take = limit ?? agent_tools_constants_1.MAX_LIST_LIMIT;
                const scopedAgentId = context.userRole === 'sales_agent' ? context.userId : agentId;
                const where = { ...(0, format_helpers_1.buildVisitScopeFilter)(context.companyId, context.userRole, context.userId), scheduledAt: { gte: start, lte: end } };
                if (scopedAgentId)
                    where.agentId = scopedAgentId;
                await (0, callRequest_service_1.ensureCallRequestsSchema)();
                const callParams = [context.companyId, start, end];
                let callAgentClause = '';
                if (scopedAgentId) {
                    callParams.push(scopedAgentId);
                    callAgentClause = ` AND cr.agent_id = $${callParams.length}::uuid`;
                }
                const [visits, calls] = await Promise.all([
                    prisma_1.default.visit.findMany({ where, include: { lead: true, property: true, agent: true }, orderBy: { scheduledAt: 'asc' }, take }),
                    prisma_1.default.$queryRawUnsafe(`SELECT cr.id::text, cr.lead_id::text, cr.scheduled_at, cr.status, l.customer_name, l.phone AS customer_phone
             FROM call_requests cr
             LEFT JOIN leads l ON l.id = cr.lead_id
             WHERE cr.company_id = $1::uuid
               AND cr.scheduled_at >= $2
               AND cr.scheduled_at <= $3
               ${callAgentClause}
             ORDER BY cr.scheduled_at ASC
             LIMIT ${Math.max(1, Math.min(take, agent_tools_constants_1.MAX_LIST_LIMIT))}`, ...callParams),
                ]);
                const events = [
                    ...visits.map((v) => ({
                        at: v.scheduledAt,
                        line: `${(0, format_helpers_1.formatDateIST)(v.scheduledAt)} - Visit: ${v.lead?.customerName ?? 'Unknown'} at ${v.property?.name ?? 'TBD'} (${v.status}) ID: ${v.id}`,
                    })),
                    ...calls.map((c) => ({
                        at: new Date(c.scheduled_at),
                        line: `${(0, format_helpers_1.formatDateIST)(new Date(c.scheduled_at))} - Call: ${c.customer_name ?? c.customer_phone ?? 'Unknown'} (${c.status}) ID: ${c.id}`,
                    })),
                ].sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, take);
                if (!events.length)
                    return 'No events found.';
                return [`*Calendar ${startDate} to ${endDate}*`, ...events.map((event) => event.line)].join('\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getAvailableSlots',
            description: 'Find available one-hour property visit slots for a date.',
            schema: zod_1.z.object({ propertyId: zod_1.z.string().uuid(), date: zod_1.z.string() }),
            func: async ({ propertyId, date }) => {
                const property = await prisma_1.default.property.findFirst({ where: { id: propertyId, companyId: context.companyId }, select: { name: true } });
                if (!property)
                    return 'Property not found.';
                const [start, end] = (0, format_helpers_1.getISTDayBounds)(date);
                const visits = await prisma_1.default.visit.findMany({ where: { companyId: context.companyId, propertyId, scheduledAt: { gte: start, lte: end }, status: { in: ['scheduled', 'confirmed'] } }, select: { scheduledAt: true } });
                const busy = new Set(visits.map((v) => new Date(v.scheduledAt.getTime() + 5.5 * 60 * 60 * 1000).getUTCHours()));
                const slots = [];
                for (let hour = agent_tools_constants_1.SLOT_START_HOUR; hour < agent_tools_constants_1.SLOT_END_HOUR; hour += agent_tools_constants_1.SLOT_DURATION_MINUTES / 60) {
                    if (!busy.has(hour))
                        slots.push(`${String(hour).padStart(2, '0')}:00 IST`);
                }
                return slots.length ? [`*Available slots for ${property.name} on ${date}*`, ...slots.map((s, i) => `${i + 1}. ${s}`)].join('\n') : `No slots available for ${property.name} on ${date}.`;
            },
        }),
    ];
}
