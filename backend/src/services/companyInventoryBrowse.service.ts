import prisma from '../config/prisma';
import { cacheGet, cacheSet } from '../config/redis';
import { buyerButtonTitle, buyerFilterButtonTitle } from '../utils/buyerI18n.util';

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

const TYPE_ORDER = ['apartment', 'villa', 'plot', 'commercial', 'other'];

function formatFilterTitle(type: string, lang?: string): string {
  return buyerFilterButtonTitle(lang, type, false);
}

function formatBhkTitle(bedrooms: number, lang?: string): string {
  return buyerFilterButtonTitle(lang, `${bedrooms}bhk`, false);
}

function formatTypeSummary(types: string[]): string {
  if (!types.length) return 'no active listings yet';
  const labels = types.map((t) => formatFilterTitle(t).toLowerCase());
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function buildFiltersFromInventory(
  typeCounts: Record<string, number>,
  bhkCounts: Record<number, number>,
  lang?: string,
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
      title: formatFilterTitle(type, lang),
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
          title: formatBhkTitle(bhk, lang),
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
  options?: { withEmoji?: boolean; maxFilters?: number; lang?: string },
): Array<{ id: string; title: string }> {
  const max = options?.maxFilters ?? 2;
  const lang = options?.lang ?? 'en';
  return filters.slice(0, max).map((f) => {
    const withEmoji = Boolean(options?.withEmoji && !/^\d+bhk$/.test(f.filterKey));
    return {
      id: f.id,
      title: buyerFilterButtonTitle(lang, f.filterKey, withEmoji),
    };
  });
}

/** Greeting / inventory-summary buttons: up to 2 company filters + Call Me. */
export function buildDiscoveryButtonSet(
  snapshot: CompanyBrowseSnapshot,
  lang?: string,
): Array<{ id: string; title: string }> {
  const resolvedLang = lang ?? 'en';
  const buttons = browseFiltersToButtons(snapshot.filters, { maxFilters: 2, lang: resolvedLang });
  if (buttons.length) {
    buttons.push({ id: 'call-me', title: buyerButtonTitle(resolvedLang, 'call_me') });
    return buttons.slice(0, 3);
  }
  return [{ id: 'call-me', title: buyerButtonTitle(resolvedLang, 'call_me') }];
}

/** Empty-catalog / narrow-search: up to 3 inventory filters, no Call Me unless empty. */
export function buildCatalogFilterButtonSet(
  snapshot: CompanyBrowseSnapshot,
  lang?: string,
): Array<{ id: string; title: string }> {
  const resolvedLang = lang ?? 'en';
  const buttons = browseFiltersToButtons(snapshot.filters, { maxFilters: 3, lang: resolvedLang });
  if (buttons.length) return buttons;
  return [{ id: 'call-me', title: buyerButtonTitle(resolvedLang, 'call_agent') }];
}

export function isFilterInCompanyInventory(
  snapshot: CompanyBrowseSnapshot,
  filterKey: string,
): boolean {
  const normalized = filterKey.toLowerCase();
  return snapshot.filters.some((f) => f.filterKey === normalized);
}

export async function getCompanyBrowseButtons(
  companyId: string,
  lang?: string,
): Promise<Array<{ id: string; title: string }>> {
  const snapshot = await getCompanyBrowseSnapshot(companyId);
  return buildDiscoveryButtonSet(snapshot, lang);
}

const PROPERTY_TYPE_LABELS: Record<string, string> = {
  apartment: 'Apartments',
  villa: 'Villas',
  plot: 'Plots',
  commercial: 'Commercial',
  other: 'Projects',
};

export function formatCompanyInventoryPromptLine(snapshot: CompanyBrowseSnapshot, companyName: string): string {
  if (snapshot.totalListings === 0) {
    return `${companyName} has no active listings in the system yet. Do NOT mention apartments, villas, plots, or other property types. Say listings are being updated and offer to connect with an agent.`;
  }
  if (snapshot.propertyTypes.length) {
    const labels = snapshot.propertyTypes.map((t) => PROPERTY_TYPE_LABELS[t] ?? t);
    return `${companyName} ONLY lists: ${labels.join(', ')}. NEVER mention or suggest property types outside this list.`;
  }
  return `${companyName} has ${snapshot.totalListings} active project(s). Only discuss properties in AVAILABLE PROPERTIES — never invent types.`;
}
