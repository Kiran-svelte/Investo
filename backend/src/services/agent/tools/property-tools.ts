import { z } from 'zod';
import prisma from '../../../config/prisma';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../../constants/agent-tools.constants';
import { ToolContext } from '../agent-state';
import { formatCurrencyINR, getStatusEmoji, isAdminRole } from './format-helpers';
import { DynamicStructuredTool, type AgentTool } from './langchain-runtime';
import {
  assessPropertyCompleteness,
  formatCompletenessForAgentTool,
} from '../../propertyCompleteness.service';
import { matchCatalogPropertiesForQuery } from '../../propertyKnowledge.service';

const propertyType = z.enum(['villa', 'apartment', 'plot', 'commercial', 'other']);
const propertyStatus = z.enum(['available', 'sold', 'upcoming']);

function price(min: unknown, max: unknown): string {
  if (min && max) return `${formatCurrencyINR(min as any)}-${formatCurrencyINR(max as any)}`;
  if (min) return `From ${formatCurrencyINR(min as any)}`;
  if (max) return `Up to ${formatCurrencyINR(max as any)}`;
  return 'not set';
}

function formatProperty(property: any): string {
  return [
    `${getStatusEmoji(property.status)} *${property.name}*`,
    `Type: ${property.propertyType} | Status: ${property.status}`,
    `Price: ${price(property.priceMin, property.priceMax)}`,
    `Location: ${[property.locationArea, property.locationCity].filter(Boolean).join(', ') || 'not set'}`,
    property.bedrooms != null ? `Bedrooms: ${property.bedrooms}` : '',
    `ID: ${property.id}`,
  ].filter(Boolean).join('\n');
}

export function createPropertyTools(context: ToolContext): AgentTool[] {
  return [
    new DynamicStructuredTool({
      name: 'listProperties',
      description: 'List properties with filters.',
      schema: z.object({ search: z.string().optional(), propertyType: propertyType.optional(), status: propertyStatus.optional(), city: z.string().optional(), limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional() }),
      func: async ({ search, propertyType, status, city, limit }) => {
        const where: any = { companyId: context.companyId, ...(propertyType ? { propertyType } : {}), ...(status ? { status } : {}) };
        if (city) where.locationCity = { contains: city, mode: 'insensitive' };
        if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { builder: { contains: search, mode: 'insensitive' } }];
        const properties = await prisma.property.findMany({ where, orderBy: { updatedAt: 'desc' }, take: limit ?? DEFAULT_LIST_LIMIT });
        if (!properties.length) return 'No properties found.';
        return ['*Properties*', ...properties.map(formatProperty)].join('\n\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'getPropertyDetails',
      description: 'Get property details.',
      schema: z.object({ propertyId: z.string().uuid() }),
      func: async ({ propertyId }) => {
        const property = await prisma.property.findFirst({ where: { id: propertyId, companyId: context.companyId }, include: { _count: { select: { visits: true } } } });
        if (!property) return 'Property not found.';
        const amenities = Array.isArray(property.amenities) ? property.amenities.join(', ') : '';
        return [formatProperty(property), property.builder ? `Builder: ${property.builder}` : '', property.reraNumber ? `RERA: ${property.reraNumber}` : '', amenities ? `Amenities: ${amenities}` : '', property.description ? `Description: ${property.description}` : '', `Visits: ${property._count.visits}`].filter(Boolean).join('\n');
      },
    }),
    new DynamicStructuredTool({
      name: 'createProperty',
      description: 'Create a property. Admin only.',
      schema: z.object({ name: z.string().min(1), builder: z.string().optional(), locationCity: z.string().optional(), locationArea: z.string().optional(), propertyType, priceMin: z.number().optional(), priceMax: z.number().optional(), bedrooms: z.number().int().optional(), amenities: z.array(z.string()).optional(), description: z.string().optional() }),
      func: async (input) => {
        if (!isAdminRole(context.userRole)) return 'Only admins can create properties.';
        const property = await prisma.property.create({ data: { companyId: context.companyId, name: input.name, builder: input.builder ?? null, locationCity: input.locationCity ?? null, locationArea: input.locationArea ?? null, propertyType: input.propertyType, priceMin: input.priceMin ?? null, priceMax: input.priceMax ?? null, bedrooms: input.bedrooms ?? null, amenities: input.amenities ?? [], description: input.description ?? null, status: 'available' } });
        return `Property created.\n\n${formatProperty(property)}`;
      },
    }),
    new DynamicStructuredTool({
      name: 'updateProperty',
      description: 'Update a property. Admin only.',
      schema: z.object({ propertyId: z.string().uuid(), name: z.string().optional(), builder: z.string().optional(), locationCity: z.string().optional(), locationArea: z.string().optional(), propertyType: propertyType.optional(), status: propertyStatus.optional(), priceMin: z.number().optional(), priceMax: z.number().optional(), bedrooms: z.number().int().optional(), amenities: z.array(z.string()).optional(), description: z.string().optional() }),
      func: async ({ propertyId, ...fields }) => {
        if (!isAdminRole(context.userRole)) return 'Only admins can update properties.';
        const existing = await prisma.property.findFirst({ where: { id: propertyId, companyId: context.companyId }, select: { id: true } });
        if (!existing) return 'Property not found.';
        const data = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
        if (!Object.keys(data).length) return 'No fields provided.';
        await prisma.property.update({ where: { id: propertyId }, data });
        return `Property updated: ${Object.keys(data).join(', ')}`;
      },
    }),
    new DynamicStructuredTool({
      name: 'checkPropertyCompleteness',
      description: 'Check if a property has all required fields for customer-facing AI (publishable).',
      schema: z.object({ propertyId: z.string().uuid() }),
      func: async ({ propertyId }) => {
        const property = await prisma.property.findFirst({
          where: { id: propertyId, companyId: context.companyId },
        });
        if (!property) return 'Property not found.';
        return formatCompletenessForAgentTool(assessPropertyCompleteness(property));
      },
    }),
    new DynamicStructuredTool({
      name: 'searchCatalogByCustomerMessage',
      description:
        'Match published properties by customer message (type + location). Use before claiming a project exists. Returns brochure URLs when available.',
      schema: z.object({
        message: z.string().min(1),
        limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
      }),
      func: async ({ message, limit }) => {
        const matches = await matchCatalogPropertiesForQuery({
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
    new DynamicStructuredTool({
      name: 'searchPropertiesForLead',
      description: 'Find available properties matching a lead preferences.',
      schema: z.object({ leadId: z.string().uuid(), limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional() }),
      func: async ({ leadId, limit }) => {
        const lead = await prisma.lead.findFirst({ where: { id: leadId, companyId: context.companyId } });
        if (!lead) return 'Lead not found.';
        const where: any = { companyId: context.companyId, status: { in: ['available', 'upcoming'] } };
        if (lead.propertyType) where.propertyType = lead.propertyType;
        if (lead.locationPreference) where.OR = [{ locationArea: { contains: lead.locationPreference, mode: 'insensitive' } }, { locationCity: { contains: lead.locationPreference, mode: 'insensitive' } }];
        if (lead.budgetMax) where.priceMin = { lte: lead.budgetMax };
        if (lead.budgetMin) where.priceMax = { gte: lead.budgetMin };
        const properties = await prisma.property.findMany({ where, take: limit ?? DEFAULT_LIST_LIMIT });
        if (!properties.length) return 'No matching properties found.';
        return [`*Matches for ${lead.customerName ?? 'lead'}*`, ...properties.map(formatProperty)].join('\n\n');
      },
    }),
  ];
}
