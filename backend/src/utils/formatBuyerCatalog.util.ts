/**
 * Buyer-facing property catalog formatters — no internal IDs, scores, or staff metadata.
 */

import { tBuyer } from './buyerI18n.util';
import {
  isMultilingualInventoryCountQuery,
  isMultilingualPropertyTypeBrowseQuery,
  parseMultilingualBrowseFilters,
} from './buyerBrowseIntent.util';

export type BuyerCatalogMatch = {
  id: string;
  name: string;
  propertyType: string | null;
  locationCity: string | null;
  locationArea: string | null;
  brochureUrl: string | null;
  status: string | null;
  bedrooms?: number | null;
  priceMin?: unknown;
  priceMax?: unknown;
};

function formatLocation(p: BuyerCatalogMatch, lang?: string): string {
  const parts = [p.locationArea, p.locationCity].filter(Boolean);
  return parts.length ? parts.join(', ') : tBuyer(lang, 'catalog_match_location_on_request');
}

function formatPrice(min: unknown, max: unknown): string | null {
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
  if (lo != null && hi != null) return `₹${(lo / 100000).toFixed(1)}L – ₹${(hi / 100000).toFixed(1)}L`;
  if (lo != null) return `From ₹${(lo / 100000).toFixed(1)}L`;
  if (hi != null) return `Up to ₹${(hi / 100000).toFixed(1)}L`;
  return null;
}

function extractBhkFromQuery(query: string): string | null {
  const latin = query.match(/\b(\d)\s*bhk\b/i);
  if (latin) return latin[1];
  return null;
}

function extractTypeFromQuery(query: string): string | null {
  const latin = query.match(/\b(villa|apartment|flat|plot|commercial)\b/i);
  if (latin) return latin[1].toLowerCase();
  const ml = parseMultilingualBrowseFilters(query);
  return ml.propertyType ?? null;
}

/** Detect inventory-count questions ("how many projects ongoing"). */
export function isInventoryCountQuery(query: string): boolean {
  const t = query.toLowerCase();
  return (
    /\b(how many|how much|count|number of|total)\b[\s\S]{0,50}\b(project|projects|properties|property|listing|inventory|ongoing|available|upcoming)\b/.test(t)
    || /\b(ongoing|available|upcoming)\s+(project|projects|properties)\b/.test(t)
    || /\bwhat\s+(project|projects|properties)\s+(do you|are you)\s+have\b/.test(t)
    || isMultilingualInventoryCountQuery(query)
  );
}

/** Detect type-filter browse ("do you have villa", "any 4bhk"). */
export function isPropertyTypeBrowseQuery(query: string): boolean {
  const t = query.toLowerCase();
  return (
    /\b(do you|have you|got|any)\b[\s\S]{0,40}\b(villas?|apartments?|flats?|plots?|commercial|properties|projects?)\b/.test(t)
    || /\b(\d)\s*bhk\b/.test(t)
    || /\b(villas?|apartments?|plots?)\b[\s\S]{0,20}\?(?:\s|$)/.test(t)
    || isMultilingualPropertyTypeBrowseQuery(query)
  );
}

export function formatBuyerCatalogEmpty(query: string, lang?: string): string {
  const bhk = extractBhkFromQuery(query);
  if (bhk) {
    return tBuyer(lang, 'catalog_empty_bhk', { bhk });
  }
  const type = extractTypeFromQuery(query);
  if (type) {
    return tBuyer(lang, 'catalog_empty_type', { type });
  }
  return tBuyer(lang, 'catalog_empty_default');
}

export function formatInventoryCountReply(
  input: {
    total?: number;
    projectCount?: number;
    propertyCount?: number;
    byType: Record<string, number>;
    upcoming: number;
    usesProjects?: boolean;
  },
  lang?: string,
): string {
  const usesProjects = input.usesProjects === true;
  const displayCount = usesProjects
    ? (input.projectCount ?? input.total ?? 0)
    : (input.propertyCount ?? input.total ?? 0);

  if (displayCount === 0) {
    return tBuyer(lang, 'inventory_count_none');
  }

  const typePartsFormatted = Object.entries(input.byType)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `*${n}* ${type}${n === 1 ? '' : 's'}`)
    .join(', ');

  const headerKey = usesProjects ? 'inventory_count_header_projects' : 'inventory_count_header_properties';
  let text = tBuyer(lang, headerKey, { count: displayCount });
  if (typePartsFormatted) text += ` — ${typePartsFormatted}`;
  if (input.upcoming > 0) {
    text += `\n\n${tBuyer(lang, 'inventory_count_upcoming', { count: input.upcoming })}`;
  }
  text += `\n\n${tBuyer(lang, 'inventory_count_cta')}`;
  return text;
}

export function formatBuyerCatalogMatches(matches: BuyerCatalogMatch[], lang?: string): string {
  const unique = dedupeCatalogMatches(matches);
  if (!unique.length) return formatBuyerCatalogEmpty('', lang);

  if (unique.length === 1) {
    const p = unique[0];
    const price = formatPrice(p.priceMin, p.priceMax);
    const lines = [
      tBuyer(lang, 'catalog_match_single_intro', { name: p.name }),
      p.propertyType ? tBuyer(lang, 'catalog_match_single_type', { type: p.propertyType }) : null,
      price ? tBuyer(lang, 'catalog_match_single_price', { price }) : null,
      tBuyer(lang, 'catalog_match_single_location', { location: formatLocation(p, lang) }),
      p.bedrooms != null ? tBuyer(lang, 'catalog_match_single_bedrooms', { bedrooms: p.bedrooms }) : null,
      p.brochureUrl ? tBuyer(lang, 'catalog_match_single_brochure') : null,
      tBuyer(lang, 'catalog_match_single_footer'),
    ].filter(Boolean);
    return lines.join('\n');
  }

  const header = tBuyer(lang, 'catalog_match_multi_header', { count: unique.length });
  const items = unique.map((p, i) => {
    const price = formatPrice(p.priceMin, p.priceMax);
    return [
      `*${i + 1}. ${p.name}*`,
      p.propertyType ? `${p.propertyType}` : null,
      price ? price : null,
      formatLocation(p, lang),
    ].filter(Boolean).join(' · ');
  });

  return [header, ...items, `\n${tBuyer(lang, 'catalog_match_multi_footer')}`].join('\n\n');
}

export function dedupeCatalogMatches<T extends { id: string; name: string }>(matches: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const m of matches) {
    const nameKey = `name:${m.name.toLowerCase().trim()}`;
    if (seen.has(m.id) || seen.has(nameKey)) continue;
    seen.add(m.id);
    seen.add(nameKey);
    out.push(m);
  }
  return out;
}
