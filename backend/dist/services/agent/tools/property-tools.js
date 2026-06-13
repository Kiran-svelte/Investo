"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPropertyTools = createPropertyTools;
const zod_1 = require("zod");
const prisma_1 = __importDefault(require("../../../config/prisma"));
const config_1 = __importDefault(require("../../../config"));
const agent_tools_constants_1 = require("../../../constants/agent-tools.constants");
const format_helpers_1 = require("./format-helpers");
const langchain_runtime_1 = require("./langchain-runtime");
const propertyCompleteness_service_1 = require("../../propertyCompleteness.service");
const propertyKnowledge_service_1 = require("../../propertyKnowledge.service");
const extractExtendedPropertyAttributes_util_1 = require("../../../utils/extractExtendedPropertyAttributes.util");
const extractExtendedPropertyAttributes_util_2 = require("../../../utils/extractExtendedPropertyAttributes.util");
const propertyPromptLimits_util_1 = require("../../../utils/propertyPromptLimits.util");
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
    const extended = property.extendedAttributes && typeof property.extendedAttributes === 'object'
        ? (0, extractExtendedPropertyAttributes_util_1.formatExtendedAttributesForPrompt)(property.extendedAttributes)
        : '';
    return [
        `${(0, format_helpers_1.getStatusEmoji)(property.status)} *${property.name}*`,
        `Type: ${property.propertyType} | Status: ${property.status}`,
        `Price: ${price(property.priceMin, property.priceMax)}`,
        `Location: ${[property.locationArea, property.locationCity].filter(Boolean).join(', ') || 'not set'}`,
        property.bedrooms != null ? `Bedrooms: ${property.bedrooms}` : '',
        extended ? `Extended attributes:\n${extended}` : '',
        `ID: ${property.id}`,
    ].filter(Boolean).join('\n');
}
function copilotListLimit() {
    return config_1.default.features.copilotPropertyRag ? 10 : agent_tools_constants_1.DEFAULT_LIST_LIMIT;
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
                const properties = await prisma_1.default.property.findMany({ where, orderBy: { updatedAt: 'desc' }, take: limit ?? copilotListLimit() });
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
                const extended = (0, extractExtendedPropertyAttributes_util_1.formatExtendedAttributesForPrompt)(property.extendedAttributes);
                const lines = [
                    formatProperty(property),
                    property.builder ? `Builder: ${property.builder}` : '',
                    property.reraNumber ? `RERA: ${property.reraNumber}` : '',
                    amenities ? `Amenities: ${amenities}` : '',
                    property.description ? `Description: ${property.description}` : '',
                    property.brochureUrl ? 'Brochure PDF: on file' : '',
                    property.priceListUrl ? 'Price list PDF: on file' : '',
                    Array.isArray(property.floorPlanUrls) && property.floorPlanUrls.length
                        ? `Floor plans: ${property.floorPlanUrls.length} on file`
                        : '',
                    extended ? `Extended attributes:\n${extended}` : '',
                    `Visits: ${property._count.visits}`,
                ].filter(Boolean);
                if (config_1.default.features.copilotPropertyRag || config_1.default.features.fullImportKnowledgeIndexing) {
                    const limit = (0, propertyPromptLimits_util_1.getPropertyPromptLimits)().focusedPropertyChunks;
                    const chunks = await (0, propertyKnowledge_service_1.getPropertyKnowledgeForProperty)(context.companyId, propertyId, limit);
                    if (chunks.length) {
                        lines.push('Knowledge index excerpts:', ...chunks.map((c) => c.content));
                    }
                }
                return lines.join('\n');
            },
        }),
        new langchain_runtime_1.DynamicStructuredTool({
            name: 'createProperty',
            description: 'Create a property. Admin only.',
            schema: zod_1.z.object({
                name: zod_1.z.string().min(1),
                builder: zod_1.z.string().optional(),
                locationCity: zod_1.z.string().optional(),
                locationArea: zod_1.z.string().optional(),
                propertyType,
                priceMin: zod_1.z.number().optional(),
                priceMax: zod_1.z.number().optional(),
                bedrooms: zod_1.z.number().int().optional(),
                amenities: zod_1.z.array(zod_1.z.string()).optional(),
                description: zod_1.z.string().optional(),
                carpetAreaSqft: zod_1.z.number().optional(),
                possessionDate: zod_1.z.string().optional(),
                facing: zod_1.z.string().optional(),
                maintenanceMonthly: zod_1.z.number().optional(),
            }),
            func: async (input) => {
                if (!(0, format_helpers_1.isAdminRole)(context.userRole))
                    return 'Only admins can create properties.';
                const extendedSource = {};
                if (input.carpetAreaSqft != null)
                    extendedSource.carpet_area_sqft = input.carpetAreaSqft;
                if (input.possessionDate)
                    extendedSource.possession_date = input.possessionDate;
                if (input.facing)
                    extendedSource.facing = input.facing;
                if (input.maintenanceMonthly != null)
                    extendedSource.maintenance_monthly = input.maintenanceMonthly;
                const extendedAttributes = config_1.default.features.extendedPropertyAttrs
                    ? (0, extractExtendedPropertyAttributes_util_2.extractExtendedPropertyAttributes)(extendedSource)
                    : {};
                const property = await prisma_1.default.property.create({
                    data: {
                        companyId: context.companyId,
                        name: input.name,
                        builder: input.builder ?? null,
                        locationCity: input.locationCity ?? null,
                        locationArea: input.locationArea ?? null,
                        propertyType: input.propertyType,
                        priceMin: input.priceMin ?? null,
                        priceMax: input.priceMax ?? null,
                        bedrooms: input.bedrooms ?? null,
                        amenities: input.amenities ?? [],
                        description: input.description ?? null,
                        status: 'available',
                        ...(Object.keys(extendedAttributes).length > 0
                            ? { extendedAttributes: extendedAttributes }
                            : {}),
                    },
                });
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
            name: 'searchPropertyKnowledge',
            description: 'Semantic search over indexed property knowledge (brochures, import fields, descriptions). Use for detail questions about carpet area, possession, facing, amenities.',
            schema: zod_1.z.object({
                query: zod_1.z.string().min(1),
                propertyId: zod_1.z.string().uuid().optional(),
                limit: zod_1.z.number().int().min(1).max(15).optional(),
            }),
            func: async ({ query, propertyId, limit }) => {
                if (!config_1.default.features.copilotPropertyRag) {
                    return 'Property knowledge search is not enabled for this tenant.';
                }
                const chunks = propertyId
                    ? await (0, propertyKnowledge_service_1.getPropertyKnowledgeForProperty)(context.companyId, propertyId, limit ?? 8)
                    : await (0, propertyKnowledge_service_1.searchPropertyKnowledge)(context.companyId, query, limit ?? 8);
                if (!chunks.length) {
                    return 'No indexed knowledge found for that query.';
                }
                return chunks.map((chunk, index) => (`[${index + 1}] property=${chunk.propertyId} score=${chunk.score.toFixed(3)}\n${chunk.content}`)).join('\n\n');
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
                        `Status: ${p.status || 'unknown'}`,
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
                const where = { companyId: context.companyId, status: { in: ['available', 'upcoming'] } };
                if (lead.propertyType)
                    where.propertyType = lead.propertyType;
                if (lead.locationPreference)
                    where.OR = [{ locationArea: { contains: lead.locationPreference, mode: 'insensitive' } }, { locationCity: { contains: lead.locationPreference, mode: 'insensitive' } }];
                if (lead.budgetMax)
                    where.priceMin = { lte: lead.budgetMax };
                if (lead.budgetMin)
                    where.priceMax = { gte: lead.budgetMin };
                const properties = await prisma_1.default.property.findMany({ where, take: limit ?? copilotListLimit() });
                if (!properties.length)
                    return 'No matching properties found.';
                return [`*Matches for ${lead.customerName ?? 'lead'}*`, ...properties.map(formatProperty)].join('\n\n');
            },
        }),
    ];
}
