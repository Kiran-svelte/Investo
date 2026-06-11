/**
 * Buyer-facing property catalog formatters — no internal IDs, scores, or staff metadata.
 */

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

function formatLocation(p: BuyerCatalogMatch): string {
  const parts = [p.locationArea, p.locationCity].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Location on request';
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

/** Detect inventory-count questions ("how many projects ongoing"). */
export function isInventoryCountQuery(query: string): boolean {
  const t = query.toLowerCase();
  return (
    /\b(how many|how much|count|number of|total)\b[\s\S]{0,50}\b(project|projects|properties|property|listing|inventory|ongoing|available|upcoming)\b/.test(t)
    || /\b(ongoing|available|upcoming)\s+(project|projects|properties)\b/.test(t)
    || /\bwhat\s+(project|projects|properties)\s+(do you|are you)\s+have\b/.test(t)
  );
}

/** Detect type-filter browse ("do you have villa", "any 4bhk"). */
export function isPropertyTypeBrowseQuery(query: string): boolean {
  const t = query.toLowerCase();
  return (
    /\b(do you|have you|got|any)\b[\s\S]{0,40}\b(villas?|apartments?|flats?|plots?|commercial|properties|projects?)\b/.test(t)
    || /\b(\d)\s*bhk\b/.test(t)
    || /\b(villas?|apartments?|plots?)\b[\s\S]{0,20}\?(?:\s|$)/.test(t)
  );
}

export function formatBuyerCatalogEmpty(query: string): string {
  if (/\b(\d)\s*bhk\b/i.test(query)) {
    const bhk = query.match(/\b(\d)\s*bhk\b/i)?.[1];
    return (
      `I couldn't find a *${bhk} BHK* in our current catalog.\n\n` +
      `Tell me your preferred area or budget, or tap a filter below — I'll show the closest matches.`
    );
  }
  if (/\b(villa|apartment|plot|commercial)\b/i.test(query)) {
    const type = query.match(/\b(villa|apartment|flat|plot|commercial)\b/i)?.[1] ?? 'matching';
    return (
      `I couldn't find *${type}* listings that match right now.\n\n` +
      `Share your budget or area, or ask to see all available projects.`
    );
  }
  return (
    "I couldn't find an exact match in our catalog.\n\n" +
    'Tell me your budget, area, or property type (e.g. "3 BHK in Whitefield") and I\'ll shortlist options.'
  );
}

export function formatInventoryCountReply(input: {
  total: number;
  byType: Record<string, number>;
  upcoming: number;
}): string {
  if (input.total === 0) {
    return 'We don\'t have any published projects available for visits right now. Our team can notify you when new inventory is added.';
  }

  const typeParts = Object.entries(input.byType)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `*${n}* ${type}${n === 1 ? '' : 's'}`)
    .join(', ');

  let text = `We have *${input.total}* active project${input.total === 1 ? '' : 's'} in our catalog`;
  if (typeParts) text += ` — ${typeParts}`;
  if (input.upcoming > 0) {
    text += `\n\n*${input.upcoming}* upcoming launch${input.upcoming === 1 ? '' : 'es'} (pre-booking open).`;
  }
  text += '\n\nWould you like to see apartments, villas, or a specific BHK? Tap below or tell me your preference.';
  return text;
}

export function formatBuyerCatalogMatches(matches: BuyerCatalogMatch[]): string {
  const unique = dedupeCatalogMatches(matches);
  if (!unique.length) return formatBuyerCatalogEmpty('');

  if (unique.length === 1) {
    const p = unique[0];
    const price = formatPrice(p.priceMin, p.priceMax);
    const lines = [
      `Yes — we have *${p.name}*`,
      p.propertyType ? `Type: ${p.propertyType}` : null,
      price ? `Price: ${price}` : null,
      `Location: ${formatLocation(p)}`,
      p.bedrooms != null ? `Bedrooms: ${p.bedrooms} BHK` : null,
      p.brochureUrl ? `Brochure: available 📎` : null,
      `\nI'll share photos and details below. Tap *Property Details* or *Book Visit* when you're ready.`,
    ].filter(Boolean);
    return lines.join('\n');
  }

  const header = `Here are *${unique.length}* matching options:`;
  const items = unique.map((p, i) => {
    const price = formatPrice(p.priceMin, p.priceMax);
    return [
      `*${i + 1}. ${p.name}*`,
      p.propertyType ? `${p.propertyType}` : null,
      price ? price : null,
      formatLocation(p),
    ].filter(Boolean).join(' · ');
  });

  return [header, ...items, '\nTap a project from the list below to see photos, brochure, and visit slots.'].join('\n\n');
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
