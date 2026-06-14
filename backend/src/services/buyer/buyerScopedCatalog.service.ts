import type { Property } from '@prisma/client';
import prisma from '../../config/prisma';
import config from '../../config';
import logger from '../../config/logger';
import type { BuyerConversationFocus } from './buyerConversationFocus.service';
import { searchPropertyKnowledge } from '../propertyKnowledge.service';

export type BuyerAiCatalogMode =
  | 'focused'
  | 'project'
  | 'recommended'
  | 'rag'
  | 'legacy_fallback'
  | 'single_project';

export const CATALOG_SCOPE_PROMPT_APPENDIX = `## PROPERTY CATALOG SCOPE
You may ONLY discuss properties listed in the catalog below for this turn.
If the customer asks about a property not listed, say you don't have that in the current
shortlist and offer to browse projects or narrow search — do NOT invent details.`;

const PROJECT_CATALOG_MAX = 15;
const SINGLE_PROJECT_MAX = 25;
const RAG_SEED_MAX = 10;
const DISCOVERY_PROJECT_MAX = 3;

async function isSingleProjectCompany(companyId: string): Promise<boolean> {
  const count = await prisma.propertyProject.count({ where: { companyId } });
  return count <= 1;
}

async function loadPropertiesByIds(companyId: string, ids: readonly string[]): Promise<Property[]> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return [];
  return prisma.property.findMany({
    where: { companyId, id: { in: uniqueIds }, status: { in: ['available', 'upcoming'] } },
  });
}

async function loadProjectCatalog(companyId: string, projectId: string, max: number): Promise<Property[]> {
  const rows = await prisma.property.findMany({
    where: { companyId, projectId, status: { in: ['available', 'upcoming'] } },
    take: max,
    orderBy: { createdAt: 'desc' },
  });
  if (rows.length >= max) {
    logger.warn('Buyer AI catalog truncated for project scope', {
      companyId,
      projectId,
      max,
    });
  }
  return rows;
}

async function loadDiscoveryProjectCatalog(companyId: string): Promise<Property[]> {
  const projects = await prisma.propertyProject.findMany({
    where: { companyId },
    select: { id: true },
    take: DISCOVERY_PROJECT_MAX,
    orderBy: { sortOrder: 'asc' },
  });
  if (!projects.length) return [];
  return prisma.property.findMany({
    where: {
      companyId,
      projectId: { in: projects.map((p) => p.id) },
      status: { in: ['available', 'upcoming'] },
    },
    take: PROJECT_CATALOG_MAX,
  });
}

async function loadRagSeededCatalog(
  companyId: string,
  customerMessage: string,
  projectId?: string | null,
): Promise<Property[]> {
  if (!config.features.fullImportKnowledgeIndexing) {
    return loadDiscoveryProjectCatalog(companyId);
  }

  const hits = await searchPropertyKnowledge(companyId, customerMessage, RAG_SEED_MAX);
  const propertyIds = [...new Set(hits.map((h) => h.propertyId))].slice(0, RAG_SEED_MAX) as string[];
  if (!propertyIds.length) {
    return loadDiscoveryProjectCatalog(companyId);
  }

  const properties = await loadPropertiesByIds(companyId, propertyIds);
  if (projectId) {
    return properties.filter((p) => p.projectId === projectId);
  }
  return properties;
}

export async function resolveBuyerAiPropertyCatalog(input: {
  companyId: string;
  focus: BuyerConversationFocus;
  resolvedPropertyId: string | null;
  neverSayNoPropertyIds: string[];
  conversionAlternativeIds: string[];
  customerMessage?: string;
}): Promise<{ properties: Property[]; catalogMode: BuyerAiCatalogMode }> {
  const propertyIdSet = [
    ...new Set([
      ...input.neverSayNoPropertyIds,
      ...input.conversionAlternativeIds,
      ...(input.resolvedPropertyId ? [input.resolvedPropertyId] : []),
    ]),
  ];

  if (!config.features.scopedAiCatalog) {
    const properties =
      propertyIdSet.length > 0
        ? await loadPropertiesByIds(input.companyId, propertyIdSet)
        : await prisma.property.findMany({
          where: { companyId: input.companyId, status: { in: ['available', 'upcoming'] } },
          take: 20,
        });
    return { properties, catalogMode: 'legacy_fallback' };
  }

  if (propertyIdSet.length > 0) {
    return {
      properties: await loadPropertiesByIds(input.companyId, propertyIdSet),
      catalogMode: 'focused',
    };
  }

  if (input.focus.focusedProjectId) {
    return {
      properties: await loadProjectCatalog(input.companyId, input.focus.focusedProjectId, PROJECT_CATALOG_MAX),
      catalogMode: 'project',
    };
  }

  if (input.focus.allowedPropertyIds.length > 0) {
    return {
      properties: await loadPropertiesByIds(
        input.companyId,
        input.focus.allowedPropertyIds.slice(0, PROJECT_CATALOG_MAX),
      ),
      catalogMode: 'recommended',
    };
  }

  if (await isSingleProjectCompany(input.companyId)) {
    const onlyProject = await prisma.propertyProject.findFirst({
      where: { companyId: input.companyId },
      select: { id: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (onlyProject) {
      return {
        properties: await loadProjectCatalog(input.companyId, onlyProject.id, SINGLE_PROJECT_MAX),
        catalogMode: 'single_project',
      };
    }
  }

  const ragProperties = await loadRagSeededCatalog(
    input.companyId,
    input.customerMessage ?? '',
    input.focus.focusedProjectId,
  );
  if (ragProperties.length) {
    return {
      properties: ragProperties.slice(0, PROJECT_CATALOG_MAX),
      catalogMode: config.features.fullImportKnowledgeIndexing ? 'rag' : 'recommended',
    };
  }

  return { properties: [], catalogMode: 'legacy_fallback' };
}
