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
function createCalendarTools(context) {
    return [
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getCalendarEvents',
            description: 'Get visit calendar events in a date range.',
            schema: zod_1.z.object({ startDate: zod_1.z.string(), endDate: zod_1.z.string(), agentId: zod_1.z.string().uuid().optional(), limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional() }),
            func: async ({ startDate, endDate, agentId, limit }) => {
                const [start] = (0, format_helpers_1.getISTDayBounds)(startDate);
                const [, end] = (0, format_helpers_1.getISTDayBounds)(endDate);
                const where = { ...(0, format_helpers_1.buildVisitScopeFilter)(context.companyId, context.userRole, context.userId), scheduledAt: { gte: start, lte: end } };
                if (agentId && context.userRole !== 'sales_agent')
                    where.agentId = agentId;
                const visits = await prisma_1.default.visit.findMany({ where, include: { lead: true, property: true, agent: true }, orderBy: { scheduledAt: 'asc' }, take: limit ?? agent_tools_constants_1.MAX_LIST_LIMIT });
                if (!visits.length)
                    return 'No events found.';
                return [`*Calendar ${startDate} to ${endDate}*`, ...visits.map((v) => `${(0, format_helpers_1.formatDateIST)(v.scheduledAt)} - ${v.lead?.customerName ?? 'Unknown'} at ${v.property?.name ?? 'TBD'} (${v.status}) ID: ${v.id}`)].join('\n');
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
