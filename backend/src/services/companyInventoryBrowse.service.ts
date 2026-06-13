import prisma from '../config/prisma';
import { cacheGet, cacheSet } from '../config/redis';

const CACHE_TTL_SECONDS = 300;

export type CompanyBrowseFilter = {
  id: string;
  title: string;
  filterKey: string;
};

export type CompanyBrowseSnapshot = {
  companyId: string;
  totalListings: number;
  propertyTypes: string[];
  bedroomOptions: number[];
  filters: CompanyBrowseFilter[];
  typeSummary: string;
};

const PROPERTY_TYPE_LABELS: Record<string, { label: string; emoji?: string }> = {
  apartment: { label: 'Apartments', emoji: '🏢' },
  villa: { label: 'Villas', emoji: '🏡' },
  plot: { label: 'Plots', emoji: '📐' },
  commercial: { label: 'Commercial', emoji: '🏬' },
  other: { label: 'Projects', emoji: '🏗️' },
};

const TYPE_ORDER = ['apartment', 'villa', 'plot', 'commercial', 'other'];

function formatFilterTitle(type: string, withEmoji: boolean): string {
  const meta = PROPERTY_TYPE_LABELS[type] ?? { label: type.charAt(0).toUpperCase() + type.slice(1) };
  if (withEmoji && meta.emoji) return `${meta.emoji} ${meta.label}`;
  return meta.label;
}

function formatBhkTitle(bedrooms: number): string {
  return `${bedrooms} BHK`;
}

function formatTypeSummary(types: string[]): string {
  if (!types.length) return 'no active listings yet';
  const labels = types.map((t) => {
    const meta = PROPERTY_TYPE_LABELS[t];
    return meta?.label.toLowerCase() ?? t;
  });
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function buildFiltersFromInventory(
  typeCounts: Record<string, number>,
  bhkCounts: Record<number, number>,
): CompanyBrowseFilter[] {
  const propertyTypes = TYPE_ORDER.filter((t) => (typeCounts[t] ?? 0) > 0);
  const bedroomOptions = Object.keys(bhkCounts)
    .map(Number)
    .filter((n) => n >= 1 && n <= 5)
    .sort((a, b) => a - b);

  const filters: CompanyBrowseFilter[] = [];

  for (const type of propertyTypes) {
    if (filters.length >= 3) break;
    filters.push({
      id: `filter-${type}`,
      title: formatFilterTitle(type, false),
      filterKey: type,
    });
  }

  if (filters.length < 3) {
    for (const bhk of bedroomOptions) {
      if (filters.length >= 3) break;
      const key = `${bhk}bhk`;
      if (!filters.some((f) => f.filterKey === key)) {
        filters.push({
          id: `filter-${key}`,
          title: formatBhkTitle(bhk),
          filterKey: key,
        });
      }
    }
  }

  return filters;
}

export async function getCompanyBrowseSnapshot(companyId: string): Promise<CompanyBrowseSnapshot> {
  const cacheKey = `company-browse:${companyId}`;
  const cached = await cacheGet<string>(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as CompanyBrowseSnapshot;
    } catch {
      // fall through to refresh
    }
  }

  const rows = await prisma.property.findMany({
    where: { companyId, status: { in: ['available', 'upcoming'] } },
    select: { propertyType: true, bedrooms: true },
  });

  const typeCounts: Record<string, number> = {};
  const bhkCounts: Record<number, number> = {};
  for (const row of rows) {
    const type = (row.propertyType || 'other').toLowerCase();
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    if (row.bedrooms != null && row.bedrooms >= 1 && row.bedrooms <= 5) {
      bhkCounts[row.bedrooms] = (bhkCounts[row.bedrooms] ?? 0) + 1;
    }
  }

  const propertyTypes = TYPE_ORDER.filter((t) => (typeCounts[t] ?? 0) > 0);
  const bedroomOptions = Object.keys(bhkCounts)
    .map(Number)
    .sort((a, b) => a - b);
  const filters = buildFiltersFromInventory(typeCounts, bhkCounts);

  const snapshot: CompanyBrowseSnapshot = {
    companyId,
    totalListings: rows.length,
    propertyTypes,
    bedroomOptions,
    filters,
    typeSummary: formatTypeSummary(propertyTypes),
  };

  await cacheSet(cacheKey, JSON.stringify(snapshot), CACHE_TTL_SECONDS);
  return snapshot;
}

export function browseFiltersToButtons(
  filters: CompanyBrowseFilter[],
  options?: { withEmoji?: boolean; maxFilters?: number },
): Array<{ id: string; title: string }> {
  const max = options?.maxFilters ?? 2;
  return filters.slice(0, max).map((f) => {
    if (options?.withEmoji && !/^\d+bhk$/.test(f.filterKey)) {
      return { id: f.id, title: formatFilterTitle(f.filterKey, true) };
    }
    return { id: f.id, title: f.title };
  });
}

/** Greeting / inventory-summary buttons: up to 2 company filters + Call Me. */
export function buildDiscoveryButtonSet(
  snapshot: CompanyBrowseSnapshot,
): Array<{ id: string; title: string }> {
  const buttons = browseFiltersToButtons(snapshot.filters, { maxFilters: 2 });
  if (buttons.length) {
    buttons.push({ id: 'call-me', title: 'Call Me' });
    return buttons.slice(0, 3);
  }
  return [{ id: 'call-me', title: 'Call Me' }];
}

/** Empty-catalog / narrow-search: up to 3 inventory filters, no Call Me unless empty. */
export function buildCatalogFilterButtonSet(
  snapshot: CompanyBrowseSnapshot,
): Array<{ id: string; title: string }> {
  const buttons = browseFiltersToButtons(snapshot.filters, { maxFilters: 3 });
  if (buttons.length) return buttons;
  return [{ id: 'call-me', title: 'Call Agent' }];
}

export function isFilterInCompanyInventory(
  snapshot: CompanyBrowseSnapshot,
  filterKey: string,
): boolean {
  const normalized = filterKey.toLowerCase();
  return snapshot.filters.some((f) => f.filterKey === normalized);
}

export async function getCompanyBrowseButtons(companyId: string): Promise<Array<{ id: string; title: string }>> {
  const snapshot = await getCompanyBrowseSnapshot(companyId);
  return buildDiscoveryButtonSet(snapshot);
}

export function formatCompanyInventoryPromptLine(snapshot: CompanyBrowseSnapshot, companyName: string): string {
  if (snapshot.totalListings === 0) {
    return `${companyName} has no active listings in the system yet. Do NOT mention apartments, villas, plots, or other property types. Say listings are being updated and offer to connect with an agent.`;
  }
  if (snapshot.propertyTypes.length) {
    const labels = snapshot.propertyTypes.map((t) => PROPERTY_TYPE_LABELS[t]?.label ?? t);
    return `${companyName} ONLY lists: ${labels.join(', ')}. NEVER mention or suggest property types outside this list.`;
  }
  return `${companyName} has ${snapshot.totalListings} active project(s). Only discuss properties in AVAILABLE PROPERTIES — never invent types.`;
}
