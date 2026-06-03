/**
 * Server-side mirror of frontend type-knowledge gap detection for publish gates.
 */

const APARTMENT_KEYS = [
  'carpet_area_sqft', 'bhk', 'price', 'floor_number', 'tower_name', 'possession_date',
  'maintenance_fee', 'facing', 'parking', 'amenities',
] as const;

const PLOT_KEYS = [
  'plot_area_sqft', 'price_per_cent', 'is_corner_plot', 'road_width_ft', 'is_gated',
  'approvals', 'construction_allowed', 'plot_dimensions', 'facing', 'legal_status',
] as const;

const VILLA_KEYS = [
  'plot_area_sqft', 'built_up_area_sqft', 'bhk', 'has_garden', 'has_pool', 'has_servant_room',
  'price', 'maintenance_fee', 'possession_date', 'modification_allowed',
] as const;

const COMMERCIAL_KEYS = [
  'commercial_area_sqft', 'price', 'floor_number', 'road_frontage_ft', 'expected_rent',
  'roi_percentage', 'gst_applicable', 'shutters_included', 'has_3phase_power', 'footfall_description',
] as const;

const ANYTHING_ELSE_KEY = 'anything_else';

export function getKnowledgeFieldKeys(propertyType: string): string[] {
  const normalized = propertyType.trim().toLowerCase();
  switch (normalized) {
    case 'apartment':
      return [...APARTMENT_KEYS, ANYTHING_ELSE_KEY];
    case 'plot':
      return [...PLOT_KEYS, ANYTHING_ELSE_KEY];
    case 'villa':
      return [...VILLA_KEYS, ANYTHING_ELSE_KEY];
    case 'commercial':
      return [...COMMERCIAL_KEYS, ANYTHING_ELSE_KEY];
    default:
      return [];
  }
}

function readTypeKnowledge(draftData: Record<string, unknown>): Record<string, string> {
  const raw = draftData.type_knowledge ?? draftData.typeKnowledge;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function descriptionText(draftData: Record<string, unknown>): string {
  return asString(draftData.description).toLowerCase();
}

function isAnythingElseFilled(typeKnowledge: Record<string, string>): boolean {
  if (typeKnowledge.anything_else_skipped === 'true') {
    return true;
  }
  if (typeKnowledge.anything_else === 'Nothing else') {
    return true;
  }
  return Boolean(typeKnowledge.anything_else?.trim());
}

function isFieldFilled(key: string, draftData: Record<string, unknown>, typeKnowledge: Record<string, string>): boolean {
  if (key === ANYTHING_ELSE_KEY) {
    return isAnythingElseFilled(typeKnowledge);
  }

  if (typeKnowledge[key]) {
    return true;
  }

  const direct = draftData[key] ?? draftData[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
  if (direct !== null && direct !== undefined && String(direct).trim()) {
    return true;
  }

  if (key === 'bhk') {
    const bedrooms = draftData.bedrooms ?? draftData.bedrooms;
    if (bedrooms !== null && bedrooms !== undefined && String(bedrooms).trim()) {
      return true;
    }
  }

  if (key === 'price') {
    const min = draftData.price_min ?? draftData.priceMin;
    const max = draftData.price_max ?? draftData.priceMax;
    if (min != null && max != null && String(min).trim() && String(max).trim()) {
      return true;
    }
  }

  if (key === 'amenities') {
    const amenities = draftData.amenities;
    if (Array.isArray(amenities) && amenities.length > 0) {
      return true;
    }
    if (typeof amenities === 'string' && amenities.trim()) {
      return true;
    }
  }

  const desc = descriptionText(draftData);
  if (desc.length >= 40) {
    const patterns: Record<string, RegExp> = {
      possession_date: /possession|handover|ready to move|dec 20|jan 20|q[1-4]/i,
      bhk: /\b[1-5]\s*bhk\b/i,
      facing: /\b(east|west|north|south)\s*facing\b/i,
      amenities: /\b(pool|gym|clubhouse|parking|security)\b/i,
      is_gated: /\bgated\b/i,
      is_corner_plot: /\bcorner\s*plot\b/i,
      has_pool: /\bpool\b/i,
      has_garden: /\bgarden\b/i,
      gst_applicable: /\bgst\b/i,
      has_3phase_power: /\b3\s*phase\b/i,
    };
    if (patterns[key]?.test(desc)) {
      return true;
    }
  }

  const mapping = draftData.import_mapping ?? draftData.importMapping;
  if (mapping && typeof mapping === 'object') {
    const source = (mapping as Record<string, unknown>).source_record
      ?? (mapping as Record<string, unknown>).sourceRecord;
    if (source && typeof source === 'object') {
      const record = source as Record<string, unknown>;
      const candidates = [key, key.toLowerCase()];
      for (const candidate of candidates) {
        if (record[candidate] != null && String(record[candidate]).trim()) {
          return true;
        }
      }
    }
  }

  return false;
}

export function countMissingKnowledgeFields(draftData: Record<string, unknown> | null | undefined): {
  propertyType: string;
  gapCount: number;
  missingKeys: string[];
} {
  if (!draftData || typeof draftData !== 'object') {
    return { propertyType: '', gapCount: 0, missingKeys: [] };
  }

  const propertyType = asString(draftData.property_type ?? draftData.propertyType);
  if (!propertyType) {
    return { propertyType: '', gapCount: 0, missingKeys: [] };
  }

  const typeKnowledge = readTypeKnowledge(draftData);
  const keys = getKnowledgeFieldKeys(propertyType);
  const missingKeys = keys.filter((key) => !isFieldFilled(key, draftData, typeKnowledge));

  return {
    propertyType,
    gapCount: missingKeys.length,
    missingKeys,
  };
}

export function isPropertyKnowledgeComplete(draftData: Record<string, unknown> | null | undefined): boolean {
  const { gapCount, propertyType } = countMissingKnowledgeFields(draftData);
  if (!propertyType) {
    return false;
  }
  return gapCount === 0;
}
