import type { Property } from '@prisma/client';

/** Full property row shape passed into buyer LLM prompts. */
export interface PropertyAiPromptInput {
  id: string;
  name: string;
  status: string;
  locationArea?: string | null;
  locationCity?: string | null;
  locationPincode?: string | null;
  priceMin?: number | null;
  priceMax?: number | null;
  bedrooms?: number | null;
  propertyType?: string | null;
  amenities: string[];
  description?: string | null;
  builder?: string | null;
  reraNumber?: string | null;
  brochureUrl?: string | null;
  hasImages: boolean;
}

const DESCRIPTION_PROMPT_MAX = 400;
const FOCUSED_DESCRIPTION_MAX = 900;

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (
    typeof value === 'object'
    && value !== null
    && 'toNumber' in value
    && typeof (value as { toNumber: () => number }).toNumber === 'function'
  ) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parsePropertyAmenities(amenities: unknown): string[] {
  if (Array.isArray(amenities)) {
    return amenities.map((a) => String(a).trim()).filter(Boolean);
  }
  if (typeof amenities === 'string' && amenities.trim()) {
    try {
      const parsed = JSON.parse(amenities) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((a) => String(a).trim()).filter(Boolean);
      }
    } catch {
      return amenities.split(',').map((a) => a.trim()).filter(Boolean);
    }
  }
  return [];
}

function formatLakhPrice(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${(value / 100_000).toFixed(value >= 1_000_000 ? 1 : 0)}L`;
}

function formatPriceRange(min: number | null | undefined, max: number | null | undefined): string {
  if (min != null && max != null) return `₹${formatLakhPrice(min)}–₹${formatLakhPrice(max)}`;
  if (min != null) return `from ₹${formatLakhPrice(min)}`;
  if (max != null) return `up to ₹${formatLakhPrice(max)}`;
  return 'contact for price';
}

function truncateText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function propertyToAiPromptInput(property: Property): PropertyAiPromptInput {
  const images = Array.isArray(property.images) ? (property.images as string[]) : [];
  return {
    id: property.id,
    name: property.name,
    status: property.status,
    locationArea: property.locationArea,
    locationCity: property.locationCity,
    locationPincode: property.locationPincode,
    priceMin: toNumber(property.priceMin),
    priceMax: toNumber(property.priceMax),
    bedrooms: property.bedrooms,
    propertyType: property.propertyType,
    amenities: parsePropertyAmenities(property.amenities),
    description: property.description,
    builder: property.builder,
    reraNumber: property.reraNumber,
    brochureUrl: property.brochureUrl,
    hasImages: images.some((url) => typeof url === 'string' && url.startsWith('https://')),
  };
}

/** One-line catalog entry for AVAILABLE PROPERTIES block. */
export function formatPropertyCatalogLine(property: PropertyAiPromptInput): string {
  const location = [property.locationArea, property.locationCity, property.locationPincode]
    .filter(Boolean)
    .join(', ');
  const bhk = property.bedrooms ? `${property.bedrooms}BHK` : '';
  const type = property.propertyType ?? '';
  const amenities = property.amenities.slice(0, 8).join(', ');
  const desc = property.description?.trim()
    ? ` | About: ${truncateText(property.description, DESCRIPTION_PROMPT_MAX)}`
    : '';
  const builder = property.builder ? ` | Builder: ${property.builder}` : '';
  const rera = property.reraNumber ? ` | RERA: ${property.reraNumber}` : '';
  const brochure = property.brochureUrl ? ' | Brochure PDF: on file' : '';
  const photos = property.hasImages ? ' | Photos: on file' : '';

  return [
    `- ${property.name}`,
    location ? `| ${location}` : '',
    `| ${formatPriceRange(property.priceMin, property.priceMax)}`,
    bhk || type ? `| ${[bhk, type].filter(Boolean).join(' ')}` : '',
    amenities ? `| Amenities: ${amenities}` : '',
    builder,
    rera,
    brochure,
    photos,
    desc,
  ].filter(Boolean).join(' ');
}

/** Expanded block when buyer is discussing one specific listing. */
export function buildFocusedPropertyPromptBlock(property: PropertyAiPromptInput): string {
  const lines = [
    `## FOCUSED PROPERTY (customer is asking about this listing — use these facts first)`,
    `Name: ${property.name}`,
    property.builder ? `Builder: ${property.builder}` : null,
    [property.locationArea, property.locationCity, property.locationPincode].filter(Boolean).length
      ? `Location: ${[property.locationArea, property.locationCity, property.locationPincode].filter(Boolean).join(', ')}`
      : null,
    `Price: ${formatPriceRange(property.priceMin, property.priceMax)}`,
    property.bedrooms ? `Bedrooms: ${property.bedrooms} BHK` : null,
    property.propertyType ? `Type: ${property.propertyType}` : null,
    property.reraNumber ? `RERA: ${property.reraNumber}` : 'RERA: not in records',
    property.amenities.length ? `Amenities: ${property.amenities.join(', ')}` : null,
    property.brochureUrl ? 'Brochure PDF: on file (system can attach after your reply)' : null,
    property.hasImages ? 'Photos: on file' : null,
  ].filter(Boolean) as string[];

  if (property.description?.trim()) {
    lines.push(`Description:\n${truncateText(property.description, FOCUSED_DESCRIPTION_MAX)}`);
  }

  lines.push(
    'When answering about this property: lead with 2–3 concrete highlights (location, price band, BHK/type, standout amenities), then one clear next step (visit / brochure / call).',
  );

  return lines.join('\n');
}

/** Deterministic WhatsApp copy for More Info / location-adjacent flows. */
/** Backfill sparse Property rows from indexed catalog chunks (common after partial imports). */
export function supplementPropertyFromKnowledgeContent(
  property: PropertyAiPromptInput,
  knowledgeContent: string,
): PropertyAiPromptInput {
  const lines = knowledgeContent.split('\n').map((l) => l.trim()).filter(Boolean);
  const read = (prefix: string): string | null => {
    const line = lines.find((l) => l.toLowerCase().startsWith(prefix.toLowerCase()));
    return line ? line.slice(prefix.length).trim() : null;
  };

  const priceLine = read('Price range:');
  let priceMin = property.priceMin;
  let priceMax = property.priceMax;
  if (priceLine && priceMin == null && priceMax == null) {
    const nums = priceLine.match(/₹?([\d.]+)\s*(Cr|L(?:akhs?)?)/gi) ?? [];
    const toRupees = (token: string): number | null => {
      const m = token.match(/([\d.]+)\s*(Cr|L)/i);
      if (!m) return null;
      const n = Number(m[1]);
      if (!Number.isFinite(n)) return null;
      return /cr/i.test(m[2]) ? n * 10_000_000 : n * 100_000;
    };
    const values = nums.map(toRupees).filter((v): v is number => v != null);
    if (values.length) {
      priceMin = values[0];
      priceMax = values.length > 1 ? values[values.length - 1] : values[0];
    }
  }

  const bedroomsLine = read('Bedrooms:');
  let bedrooms = property.bedrooms;
  if (bedrooms == null && bedroomsLine) {
    const m = bedroomsLine.match(/(\d+)/);
    if (m) bedrooms = Number(m[1]);
  }

  const locationLine = read('Location:');
  let locationArea = property.locationArea;
  let locationCity = property.locationCity;
  let locationPincode = property.locationPincode;
  if (!locationArea && !locationCity && locationLine) {
    const parts = locationLine.split(',').map((p) => p.trim()).filter(Boolean);
    locationArea = parts[0] ?? null;
    locationCity = parts[1] ?? null;
    locationPincode = parts[2] ?? null;
  }

  const amenitiesLine = read('Amenities:');
  let amenities = property.amenities;
  if (!amenities.length && amenitiesLine) {
    amenities = amenitiesLine.split(',').map((a) => a.trim()).filter(Boolean);
  }

  const builderLine = read('Builder:');
  const reraLine = read('RERA:');

  let description = property.description;
  const descIdx = knowledgeContent.indexOf('Description:\n');
  if (!description?.trim() && descIdx >= 0) {
    description = knowledgeContent.slice(descIdx + 'Description:\n'.length).split('\n\n')[0]?.trim() ?? null;
  }

  return {
    ...property,
    priceMin,
    priceMax,
    bedrooms,
    locationArea,
    locationCity,
    locationPincode,
    amenities,
    builder: property.builder ?? (builderLine || null),
    reraNumber: property.reraNumber ?? (reraLine && !reraLine.includes('not in records') ? reraLine : null),
    description,
  };
}

export async function enrichAiPropertiesFromKnowledge(
  companyId: string,
  properties: PropertyAiPromptInput[],
  getChunks: (
    companyId: string,
    propertyId: string,
    limit: number,
  ) => Promise<Array<{ content: string }>>,
): Promise<PropertyAiPromptInput[]> {
  return Promise.all(
    properties.map(async (property) => {
      const needsEnrichment =
        !property.description?.trim()
        || property.amenities.length === 0
        || (property.priceMin == null && property.priceMax == null)
        || (!property.locationArea && !property.locationCity);
      if (!needsEnrichment) return property;

      const chunks = await getChunks(companyId, property.id, 2);
      if (!chunks.length) return property;

      return supplementPropertyFromKnowledgeContent(
        property,
        chunks.map((c) => c.content).join('\n\n'),
      );
    }),
  );
}

export function buildWhatsAppPropertyDetailText(property: Property): string {
  const input = propertyToAiPromptInput(property);
  const location = [property.locationArea, property.locationCity].filter(Boolean).join(', ');

  const lines = [
    `🏠 *${property.name}*`,
    '',
    property.description?.trim() ? truncateText(property.description, 600) : null,
    property.description?.trim() ? '' : null,
    `💰 Price: ${formatPriceRange(input.priceMin, input.priceMax)}`,
    property.propertyType ? `🏢 Type: ${property.propertyType}` : null,
    property.bedrooms ? `🛏️ Bedrooms: ${property.bedrooms} BHK` : null,
    location ? `📍 Location: ${location}` : null,
    property.builder ? `🏗️ Builder: ${property.builder}` : null,
    property.reraNumber ? `📋 RERA: ${property.reraNumber}` : null,
    input.amenities.length ? `✨ Amenities: ${input.amenities.slice(0, 12).join(', ')}` : null,
  ].filter((line) => line !== null && line !== '') as string[];

  return lines.join('\n');
}
