"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPropertyTools = createPropertyTools;
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../../../config/prisma"));
const agent_tools_constants_1 = require("../../../constants/agent-tools.constants");
const format_helpers_1 = require("./format-helpers");
const langchain_runtime_1 = require("./langchain-runtime");
const propertyCompleteness_service_1 = require("../../propertyCompleteness.service");
const propertyKnowledge_service_1 = require("../../propertyKnowledge.service");
const propertyType = zod_1.z.enum(['villa', 'apartment', 'plot', 'commercial', 'other']);
const propertyStatus = zod_1.z.enum(['available', 'sold', 'upcoming']);
function price(min, max) {
    if (min && max)
        return `${(0, format_helpers_1.formatCurrencyINR)(min)}-${(0, format_helpers_1.formatCurrencyINR)(max)}`;
    if (min)
        return `From ${(0, format_helpers_1.formatCurrencyINR)(min)}`;
    if (max)
        return `Up to ${(0, format_helpers_1.formatCurrencyINR)(max)}`;
    return 'not set';
}
function formatProperty(property) {
    return [
        `${(0, format_helpers_1.getStatusEmoji)(property.status)} *${property.name}*`,
        `Type: ${property.propertyType} | Status: ${property.status}`,
        `Price: ${price(property.priceMin, property.priceMax)}`,
        `Location: ${[property.locationArea, property.locationCity].filter(Boolean).join(', ') || 'not set'}`,
        property.bedrooms != null ? `Bedrooms: ${property.bedrooms}` : '',
        `ID: ${property.id}`,
    ].filter(Boolean).join('\n');
}
function createPropertyTools(context) {
    return [
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'listProperties',
            description: 'List properties with filters.',
            schema: zod_1.z.object({ search: zod_1.z.string().optional(), propertyType: propertyType.optional(), status: propertyStatus.optional(), city: zod_1.z.string().optional(), limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional() }),
            func: async ({ search, propertyType, status, city, limit }) => {
                const where = { companyId: context.companyId, ...(propertyType ? { propertyType } : {}), ...(status ? { status } : {}) };
                if (city)
                    where.locationCity = { contains: city, mode: 'insensitive' };
                if (search)
                    where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { builder: { contains: search, mode: 'insensitive' } }];
                const properties = await prisma_1.default.property.findMany({ where, orderBy: { updatedAt: 'desc' }, take: limit ?? agent_tools_constants_1.DEFAULT_LIST_LIMIT });
                if (!properties.length)
                    return 'No properties found.';
                return ['*Properties*', ...properties.map(formatProperty)].join('\n\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'getPropertyDetails',
            description: 'Get property details.',
            schema: zod_1.z.object({ propertyId: zod_1.z.string().uuid() }),
            func: async ({ propertyId }) => {
                const property = await prisma_1.default.property.findFirst({ where: { id: propertyId, companyId: context.companyId }, include: { _count: { select: { visits: true } } } });
                if (!property)
                    return 'Property not found.';
                const amenities = Array.isArray(property.amenities) ? property.amenities.join(', ') : '';
                return [formatProperty(property), property.builder ? `Builder: ${property.builder}` : '', property.reraNumber ? `RERA: ${property.reraNumber}` : '', amenities ? `Amenities: ${amenities}` : '', property.description ? `Description: ${property.description}` : '', `Visits: ${property._count.visits}`].filter(Boolean).join('\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'createProperty',
            description: 'Create a property. Admin only.',
            schema: zod_1.z.object({ name: zod_1.z.string().min(1), builder: zod_1.z.string().optional(), locationCity: zod_1.z.string().optional(), locationArea: zod_1.z.string().optional(), propertyType, priceMin: zod_1.z.number().optional(), priceMax: zod_1.z.number().optional(), bedrooms: zod_1.z.number().int().optional(), amenities: zod_1.z.array(zod_1.z.string()).optional(), description: zod_1.z.string().optional() }),
            func: async (input) => {
                if (!(0, format_helpers_1.isAdminRole)(context.userRole))
                    return 'Only admins can create properties.';
                const property = await prisma_1.default.property.create({ data: { companyId: context.companyId, name: input.name, builder: input.builder ?? null, locationCity: input.locationCity ?? null, locationArea: input.locationArea ?? null, propertyType: input.propertyType, priceMin: input.priceMin ?? null, priceMax: input.priceMax ?? null, bedrooms: input.bedrooms ?? null, amenities: input.amenities ?? [], description: input.description ?? null, status: 'available' } });
                return `Property created.\n\n${formatProperty(property)}`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'updateProperty',
            description: 'Update a property. Admin only.',
            schema: zod_1.z.object({ propertyId: zod_1.z.string().uuid(), name: zod_1.z.string().optional(), builder: zod_1.z.string().optional(), locationCity: zod_1.z.string().optional(), locationArea: zod_1.z.string().optional(), propertyType: propertyType.optional(), status: propertyStatus.optional(), priceMin: zod_1.z.number().optional(), priceMax: zod_1.z.number().optional(), bedrooms: zod_1.z.number().int().optional(), amenities: zod_1.z.array(zod_1.z.string()).optional(), description: zod_1.z.string().optional() }),
            func: async ({ propertyId, ...fields }) => {
                if (!(0, format_helpers_1.isAdminRole)(context.userRole))
                    return 'Only admins can update properties.';
                const existing = await prisma_1.default.property.findFirst({ where: { id: propertyId, companyId: context.companyId }, select: { id: true } });
                if (!existing)
                    return 'Property not found.';
                const data = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
                if (!Object.keys(data).length)
                    return 'No fields provided.';
                await prisma_1.default.property.update({ where: { id: propertyId }, data });
                return `Property updated: ${Object.keys(data).join(', ')}`;
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'checkPropertyCompleteness',
            description: 'Check if a property has all required fields for customer-facing AI (publishable).',
            schema: zod_1.z.object({ propertyId: zod_1.z.string().uuid() }),
            func: async ({ propertyId }) => {
                const property = await prisma_1.default.property.findFirst({
                    where: { id: propertyId, companyId: context.companyId },
                });
                if (!property)
                    return 'Property not found.';
                return (0, propertyCompleteness_service_1.formatCompletenessForAgentTool)((0, propertyCompleteness_service_1.assessPropertyCompleteness)(property));
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'searchCatalogByCustomerMessage',
            description: 'Match published properties by customer message (type + location). Use before claiming a project exists. Returns brochure URLs when available.',
            schema: zod_1.z.object({
                message: zod_1.z.string().min(1),
                limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional(),
            }),
            func: async ({ message, limit }) => {
                const matches = await (0, propertyKnowledge_service_1.matchCatalogPropertiesForQuery)({
                    companyId: context.companyId,
                    query: message,
                    limit: limit ?? 5,
                });
                if (!matches.length) {
                    return 'No matching published properties in catalog for that message. Do not invent project names.';
                }
                return [
                    '*Catalog matches (grounded)*',
                    ...matches.map((p) => [
                        `*${p.name}* (${p.propertyType || 'type unknown'})`,
                        `Location: ${[p.locationArea, p.locationCity].filter(Boolean).join(', ') || 'not set'}`,
                        `ID: ${p.id}`,
                        p.brochureUrl ? 'Brochure PDF: on file' : 'Brochure: not on file',
                        `Match score: ${p.score}`,
                    ].join('\n')),
                ].join('\n\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'searchPropertiesForLead',
            description: 'Find available properties matching a lead preferences.',
            schema: zod_1.z.object({ leadId: zod_1.z.string().uuid(), limit: zod_1.z.number().int().min(1).max(agent_tools_constants_1.MAX_LIST_LIMIT).optional() }),
            func: async ({ leadId, limit }) => {
                const lead = await prisma_1.default.lead.findFirst({ where: { id: leadId, companyId: context.companyId } });
                if (!lead)
                    return 'Lead not found.';
                const where = { companyId: context.companyId, status: 'available' };
                if (lead.propertyType)
                    where.propertyType = lead.propertyType;
                if (lead.locationPreference)
                    where.OR = [{ locationArea: { contains: lead.locationPreference, mode: 'insensitive' } }, { locationCity: { contains: lead.locationPreference, mode: 'insensitive' } }];
                if (lead.budgetMax)
                    where.priceMin = { lte: lead.budgetMax };
                if (lead.budgetMin)
                    where.priceMax = { gte: lead.budgetMin };
                const properties = await prisma_1.default.property.findMany({ where, take: limit ?? agent_tools_constants_1.DEFAULT_LIST_LIMIT });
                if (!properties.length)
                    return 'No matching properties found.';
                return [`*Matches for ${lead.customerName ?? 'lead'}*`, ...properties.map(formatProperty)].join('\n\n');
            },
        }),
    ];
}
