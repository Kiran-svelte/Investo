/**
 * Buyer WhatsApp browse — PropertyProject (site/development) first, then listings inside.
 * Dashboard "investo" = project; "Lake Vista 801" = property inside it.
 */

import prisma from '../config/prisma';
import type { WhatsAppComponent } from '../types/whatsapp-turn.types';
import { storageService } from './storage.service';
import { resolveBrochureUrlForWhatsApp, resolveFirstPropertyHeroMediaComponent } from './brochureDelivery.service';
import { propertyDetailLabels, resolveBuyerLanguage, tBuyer, buyerButtonTitle } from '../utils/buyerI18n.util';

export type ProjectBrowseFilters = {
  propertyType?: string;
  bedrooms?: number;
};

export type BrowseProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  propertyCount: number;
  propertyTypes: string[];
  locationLabel: string;
  priceLabel: string | null;
};

export type BrowseProjectProperty = {
  id: string;
  name: string;
  propertyType: string | null;
  locationArea: string | null;
  locationCity: string | null;
  priceMin: unknown;
  priceMax: unknown;
  bedrooms: number | null;
  brochureUrl: string | null;
  images: unknown;
};

function formatPriceRange(min: unknown, max: unknown): string | null {
  const toNum = (v: unknown): number | null => {
    if (v == null) return null;
    if (typeof v === 'object' && v !== null && 'toNumber' in (v as object)) {
      return Number((v as { toNumber: () => number }).toNumber());
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const lo = toNum(min);
  const hi = toNum(max);
  if (lo != null && hi != null) return `₹${(lo / 100000).toFixed(1)}L–₹${(hi / 100000).toFixed(1)}L`;
  if (lo != null) return `from ₹${(lo / 100000).toFixed(1)}L`;
  if (hi != null) return `up to ₹${(hi / 100000).toFixed(1)}L`;
  return null;
}

function aggregateLocation(areas: Array<string | null>, cities: Array<string | null>): string {
  const parts = [...new Set([...areas, ...cities].filter(Boolean) as string[])];
  if (!parts.length) return 'Location on request';
  if (parts.length <= 2) return parts.join(', ');
  return `${parts.slice(0, 2).join(', ')} +${parts.length - 2}`;
}

function aggregateTypes(types: Array<string | null>): string[] {
  return [...new Set(types.filter(Boolean).map((t) => String(t).toLowerCase()))];
}

function propertyMatchesFilters(
  p: { propertyType: string; bedrooms: number | null },
  filters?: ProjectBrowseFilters,
): boolean {
  if (filters?.propertyType && p.propertyType !== filters.propertyType) return false;
  if (filters?.bedrooms != null && p.bedrooms !== filters.bedrooms) return false;
  return true;
}

/** True when the company uses project boards with at least one published listing. */
export async function companyUsesProjectBrowse(companyId: string): Promise<boolean> {
  const count = await prisma.propertyProject.count({
    where: {
      companyId,
      properties: { some: { status: { in: ['available', 'upcoming'] } } },
    },
  });
  return count > 0;
}

/** Inventory summary scoped to project-first browse (project count vs unit count). */
export async function getProjectInventorySummary(companyId: string): Promise<{
  projectCount: number;
  propertyCount: number;
  upcoming: number;
  byType: Record<string, number>;
}> {
  const projects = await prisma.propertyProject.findMany({
    where: {
      companyId,
      properties: { some: { status: { in: ['available', 'upcoming'] } } },
    },
    select: {
      id: true,
      properties: {
        where: { status: { in: ['available', 'upcoming'] } },
        select: { propertyType: true, status: true },
      },
    },
  });

  const byType: Record<string, number> = {};
  let propertyCount = 0;
  let upcoming = 0;

  for (const project of projects) {
    for (const row of project.properties) {
      propertyCount += 1;
      const type = row.propertyType || 'other';
      byType[type] = (byType[type] ?? 0) + 1;
      if (row.status === 'upcoming') upcoming += 1;
    }
  }

  return {
    projectCount: projects.length,
    propertyCount,
    upcoming,
    byType,
  };
}

/** List projects (not individual units) for the buyer catalog. */
export async function listProjectsForBuyerBrowse(
  companyId: string,
  filters?: ProjectBrowseFilters,
): Promise<BrowseProjectSummary[]> {
  const projects = await prisma.propertyProject.findMany({
    where: {
      companyId,
      properties: {
        some: {
          status: { in: ['available', 'upcoming'] },
          ...(filters?.propertyType ? { propertyType: filters.propertyType as never } : {}),
          ...(filters?.bedrooms != null ? { bedrooms: filters.bedrooms } : {}),
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      properties: {
        where: { status: { in: ['available', 'upcoming'] } },
        select: {
          propertyType: true,
          locationArea: true,
          locationCity: true,
          priceMin: true,
          priceMax: true,
          bedrooms: true,
        },
      },
    },
  });

  const summaries: BrowseProjectSummary[] = [];

  for (const project of projects) {
    const props = project.properties.filter((p) => propertyMatchesFilters(p, filters));
    if (!props.length) continue;

    const types = aggregateTypes(props.map((p) => p.propertyType));
    const mins = props.map((p) => p.priceMin).filter(Boolean);
    const maxs = props.map((p) => p.priceMax).filter(Boolean);
    const priceLabel = formatPriceRange(
      mins.length ? mins.reduce((a, b) => (Number(a) < Number(b) ? a : b)) : null,
      maxs.length ? maxs.reduce((a, b) => (Number(a) > Number(b) ? a : b)) : null,
    );

    summaries.push({
      id: project.id,
      name: project.name,
      description: project.description,
      propertyCount: props.length,
      propertyTypes: types,
      locationLabel: aggregateLocation(
        props.map((p) => p.locationArea),
        props.map((p) => p.locationCity),
      ),
      priceLabel,
    });
  }

  return summaries;
}

export async function loadProjectProperties(
  companyId: string,
  projectId: string,
  filters?: ProjectBrowseFilters,
): Promise<{
  project: { id: string; name: string; description: string | null };
  properties: BrowseProjectProperty[];
  hiddenListingCount: number;
} | null> {
  const project = await prisma.propertyProject.findFirst({
    where: { id: projectId, companyId },
    include: {
      properties: {
        where: {
          status: { in: ['available', 'upcoming'] },
          ...(filters?.propertyType ? { propertyType: filters.propertyType as never } : {}),
          ...(filters?.bedrooms != null ? { bedrooms: filters.bedrooms } : {}),
        },
        orderBy: [{ name: 'asc' }],
        select: {
          id: true,
          name: true,
          propertyType: true,
          locationArea: true,
          locationCity: true,
          priceMin: true,
          priceMax: true,
          bedrooms: true,
          brochureUrl: true,
          images: true,
        },
      },
    },
  });

  if (!project || !project.properties.length) return null;

  const hiddenListingCount = await prisma.property.count({
    where: {
      companyId,
      projectId,
      status: { notIn: ['available', 'upcoming'] },
    },
  });

  return {
    project: { id: project.id, name: project.name, description: project.description },
    properties: project.properties,
    hiddenListingCount,
  };
}

export function formatProjectCatalogIntro(
  projects: BrowseProjectSummary[],
  lang = 'en',
): string {
  if (!projects.length) {
    return tBuyer(lang, 'project_browse_none');
  }

  const header = tBuyer(lang, 'project_browse_header', { count: projects.length });
  const items = projects.map((p, i) => {
    const types = p.propertyTypes.length ? p.propertyTypes.join(', ') : 'mixed';
    const priceSuffix = p.priceLabel ? ` · ${p.priceLabel}` : '';
    return tBuyer(lang, 'project_browse_line', {
      index: i + 1,
      name: p.name,
      count: p.propertyCount,
      types,
      location: p.locationLabel,
      price: priceSuffix,
    });
  });

  return [header, ...items, '', tBuyer(lang, 'project_browse_footer')].join('\n\n');
}

export function buildProjectSelectListComponent(
  projects: BrowseProjectSummary[],
  lang = 'en',
): WhatsAppComponent {
  return {
    kind: 'list',
    title: tBuyer(lang, 'choose_project').slice(0, 24),
    sections: [{
      title: tBuyer(lang, 'our_projects').slice(0, 24),
      rows: projects.slice(0, 10).map((p) => ({
        id: `project-select-${p.id}`,
        title: p.name.slice(0, 24),
        description: [
          tBuyer(lang, 'project_listing_count_label', { count: p.propertyCount }),
          p.propertyTypes.join('/') || 'mixed',
          p.locationLabel,
        ].filter(Boolean).join(' · ').slice(0, 72),
      })),
    }],
  };
}

export function buildProjectPropertyListComponent(
  projectId: string,
  projectName: string,
  properties: BrowseProjectProperty[],
  lang = 'en',
): WhatsAppComponent {
  return {
    kind: 'list',
    title: tBuyer(lang, 'choose_property').slice(0, 24),
    sections: [{
      title: projectName.slice(0, 24),
      rows: properties.slice(0, 10).map((p) => ({
        id: `more-info-${p.id}`,
        title: p.name.slice(0, 24),
        description: [
          formatPriceRange(p.priceMin, p.priceMax),
          p.bedrooms != null ? `${p.bedrooms} BHK` : null,
          p.propertyType,
          p.locationArea || p.locationCity,
        ].filter(Boolean).join(' · ').slice(0, 72),
      })),
    }],
  };
}

export function buildPropertyDetailButtons(
  propertyId: string,
  projectId: string | null,
  lang: string,
): WhatsAppComponent {
  const buttons = [
    { id: `book-visit-${propertyId}`, title: buyerButtonTitle(lang, 'book_visit') },
    { id: 'call-me', title: buyerButtonTitle(lang, 'call_agent') },
  ];
  if (projectId) {
    buttons.push({ id: `project-properties-${projectId}`, title: buyerButtonTitle(lang, 'view_project_listings') });
  } else {
    buttons.push({ id: `more-info-${propertyId}`, title: buyerButtonTitle(lang, 'property_details') });
  }
  return { kind: 'buttons', buttons: buttons.slice(0, 3) };
}

export async function resolveProjectBrochureMediaComponent(
  companyId: string,
  projectId: string,
  caption?: string,
): Promise<WhatsAppComponent | null> {
  const file = await prisma.propertyProjectFile.findFirst({
    where: {
      companyId,
      projectId,
      OR: [
        { mimeType: { contains: 'pdf' } },
        { fileName: { endsWith: '.pdf', mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });

  if (file?.storageKey) {
    try {
      const url = await resolveBrochureUrlForWhatsApp(storageService.getPublicUrl(file.storageKey));
      if (url) {
        return { kind: 'media', url, mime: 'application/pdf', caption: caption ?? undefined };
      }
    } catch {
      // fall through to property brochure
    }
  }

  const propWithBrochure = await prisma.property.findFirst({
    where: {
      companyId,
      projectId,
      status: { in: ['available', 'upcoming'] },
      brochureUrl: { not: null },
    },
    select: { brochureUrl: true, name: true },
  });

  if (propWithBrochure?.brochureUrl) {
    const url = await resolveBrochureUrlForWhatsApp(propWithBrochure.brochureUrl);
    if (url) {
      return {
        kind: 'media',
        url,
        mime: 'application/pdf',
        caption: caption ?? propWithBrochure.name,
      };
    }
  }

  return null;
}

export async function resolveProjectHeroImageComponent(
  companyId: string,
  projectId: string,
): Promise<WhatsAppComponent | null> {
  const props = await prisma.property.findMany({
    where: {
      companyId,
      projectId,
      status: { in: ['available', 'upcoming'] },
    },
    select: { name: true, images: true },
    orderBy: { name: 'asc' },
  });

  for (const prop of props) {
    const media = await resolveFirstPropertyHeroMediaComponent({
      images: prop.images,
      caption: prop.name,
    });
    if (media) return media;
  }

  return null;
}

export function formatProjectSelectedIntro(
  projectName: string,
  propertyCount: number,
  lang: string,
  hiddenListingCount = 0,
): string {
  let text = tBuyer(lang, 'project_selected_intro', { name: projectName, count: propertyCount });
  if (hiddenListingCount > 0) {
    text += `\n\n${tBuyer(lang, 'project_listings_hidden_note', { hidden: hiddenListingCount })}`;
  }
  return text;
}

export function resolveBrowseLanguage(
  leadLanguage?: string | null,
  message?: string | null,
): string {
  return resolveBuyerLanguage({ message, leadLanguage });
}
