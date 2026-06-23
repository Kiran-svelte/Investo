import type { Property } from '@prisma/client';
import { extractPropertyImageUrls } from './brochureDelivery.service';
import config from '../config';
import { getPropertyPromptLimits } from '../utils/propertyPromptLimits.util';
import {
  formatExtendedAttributesForPrompt,
} from '../utils/extractExtendedPropertyAttributes.util';
import { propertyDetailLabels } from '../utils/buyerI18n.util';

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
  extendedAttributes?: Record<string, unknown>;
  floorPlanUrls?: string[];
  priceListUrl?: string | null;
}

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

function parseExtendedAttributes(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function propertyToAiPromptInput(property: Property): PropertyAiPromptInput {
  const images = extractPropertyImageUrls(property.images);
  const floorPlans = Array.isArray(property.floorPlanUrls) ? (property.floorPlanUrls as string[]) : [];
  const extendedAttributes = parseExtendedAttributes(
    (property as Property & { extendedAttributes?: unknown }).extendedAttributes,
  );
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
    hasImages: images.length > 0,
    extendedAttributes,
    floorPlanUrls: floorPlans.filter((url) => typeof url === 'string' && url.trim()),
    priceListUrl: property.priceListUrl,
  };
}

/** One-line catalog entry for AVAILABLE PROPERTIES block. */
export function formatPropertyCatalogLine(property: PropertyAiPromptInput): string {
  const limits = getPropertyPromptLimits();
  const location = [property.locationArea, property.locationCity, property.locationPincode]
    .filter(Boolean)
    .join(', ');
  const bhk = property.bedrooms ? `${property.bedrooms}BHK` : '';
  const type = property.propertyType ?? '';
  const amenities = property.amenities.slice(0, limits.catalogAmenitiesMax).join(', ');
  const desc = property.description?.trim()
    ? ` | About: ${truncateText(property.description, limits.descriptionPromptMax)}`
    : '';
  const builder = property.builder ? ` | Builder: ${property.builder}` : '';
  const rera = property.reraNumber ? ` | RERA: ${property.reraNumber}` : '';
  const brochure = property.brochureUrl ? ' | Brochure PDF: on file' : '';
  const photos = property.hasImages ? ' | Photos: on file' : '';
  const floorPlans = property.floorPlanUrls?.length ? ' | Floor plans: on file' : '';
  const priceList = property.priceListUrl ? ' | Price list PDF: on file' : '';

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
    floorPlans,
    priceList,
    desc,
  ].filter(Boolean).join(' ');
}

/** Expanded block when buyer is discussing one specific listing. */
export function buildFocusedPropertyPromptBlock(property: PropertyAiPromptInput): string {
  const limits = getPropertyPromptLimits();
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
    property.floorPlanUrls?.length ? 'Floor plans: on file' : null,
    property.priceListUrl ? 'Price list PDF: on file' : null,
  ].filter(Boolean) as string[];

  if (property.description?.trim()) {
    lines.push(`Description:\n${truncateText(property.description, limits.focusedDescriptionMax)}`);
  }

  const extendedBlock = formatExtendedAttributesForPrompt(property.extendedAttributes);
  if (extendedBlock) {
    lines.push(`Extended property attributes:\n${extendedBlock}`);
  }

  lines.push(
    'When answering about this property: lead with 2–3 concrete highlights (location, price band, BHK/type, standout amenities), then one clear next step (visit / brochure / call).',
  );

  return lines.join('\n');
}

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

  const importIdx = knowledgeContent.indexOf('Imported property attributes:');
  let extendedFromKnowledge: Record<string, unknown> | undefined;
  if (importIdx >= 0) {
    const block = knowledgeContent.slice(importIdx).split('\n\n')[0] ?? '';
    const attrLines = block.split('\n').slice(1).filter((l) => l.includes(':'));
    if (attrLines.length) {
      extendedFromKnowledge = Object.fromEntries(
        attrLines.map((line) => {
          const colon = line.indexOf(':');
          return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
        }),
      );
    }
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
    extendedAttributes: property.extendedAttributes ?? extendedFromKnowledge,
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
  const enrichLimit = getPropertyPromptLimits().enrichKnowledgeChunks;
  return Promise.all(
    properties.map(async (property) => {
      const needsEnrichment =
        config.features.enrichedKnowledgeAlways
        || !property.description?.trim()
        || property.amenities.length === 0
        || (property.priceMin == null && property.priceMax == null)
        || (!property.locationArea && !property.locationCity)
        || !property.extendedAttributes
        || Object.keys(property.extendedAttributes ?? {}).length === 0;
      if (!needsEnrichment) return property;

      const chunks = await getChunks(companyId, property.id, enrichLimit);
      if (!chunks.length) return property;

      return supplementPropertyFromKnowledgeContent(
        property,
        chunks.map((c) => c.content).join('\n\n'),
      );
    }),
  );
}

export function buildWhatsAppPropertyDetailText(property: Property, lang = 'en'): string {
  return buildWhatsAppPropertyDetailFromAiInput(propertyToAiPromptInput(property), lang);
}

export function buildWhatsAppPropertyDetailFromAiInput(
  input: PropertyAiPromptInput,
  lang = 'en',
): string {
  const limits = getPropertyPromptLimits();
  const labels = propertyDetailLabels(lang);
  const location = [input.locationArea, input.locationCity].filter(Boolean).join(', ');

  const lines = [
    `🏠 *${input.name}*`,
    '',
    input.description?.trim() ? truncateText(input.description, limits.whatsappDescriptionMax) : null,
    input.description?.trim() ? '' : null,
    `💰 ${labels.price}: ${formatPriceRange(input.priceMin, input.priceMax)}`,
    input.propertyType ? `🏢 ${labels.type}: ${input.propertyType}` : null,
    input.bedrooms ? `🛏️ ${labels.bedrooms}: ${input.bedrooms} BHK` : null,
    location ? `📍 ${labels.location}: ${location}` : null,
    input.builder ? `🏗️ ${labels.builder}: ${input.builder}` : null,
    input.reraNumber ? `📋 ${labels.rera}: ${input.reraNumber}` : null,
    input.brochureUrl ? `📄 ${labels.brochure}: ${labels.onFile}` : null,
    input.floorPlanUrls?.length ? `📐 ${labels.floorPlans}: ${labels.onFile}` : null,
    input.priceListUrl ? `💵 ${labels.priceList}: ${labels.onFile}` : null,
    input.amenities.length
      ? `✨ ${labels.amenities}: ${input.amenities.slice(0, limits.whatsappAmenitiesMax).join(', ')}`
      : null,
  ].filter((line) => line !== null && line !== '') as string[];

  const extendedBlock = formatExtendedAttributesForPrompt(input.extendedAttributes);
  if (extendedBlock) {
    lines.push('', `📋 *${labels.details}:*`, extendedBlock);
  }

  return lines.join('\n');
}
