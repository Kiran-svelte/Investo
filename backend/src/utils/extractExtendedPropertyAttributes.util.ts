import {
  PROPERTY_IMPORT_FIELDS,
  PROPERTY_IMPORT_FIELD_LABELS,
} from '../constants/property-import-fields.constants';

/** Fields stored as dedicated Property columns — excluded from extended_attributes JSON. */
const DEDICATED_PROPERTY_COLUMN_KEYS = new Set([
  'name',
  'builder',
  'location_city',
  'location_area',
  'location_pincode',
  'price_min',
  'price_max',
  'price',
  'bedrooms',
  'property_type',
  'amenities',
  'description',
  'rera_number',
  'status',
  'brochure_url',
  'hero_image_url',
  'latitude',
  'longitude',
  'project_name',
  'unit_label',
  'society_name',
]);

function isFilledValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

/**
 * Non-catalog import fields for JSON storage on Property.extended_attributes.
 */
export function extractExtendedPropertyAttributes(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const field of PROPERTY_IMPORT_FIELDS) {
    if (DEDICATED_PROPERTY_COLUMN_KEYS.has(field.key)) continue;
    const value = source[field.key];
    if (!isFilledValue(value)) continue;
    out[field.key] = value;
  }

  return out;
}

export function formatExtendedAttributesForPrompt(
  attrs: Record<string, unknown> | null | undefined,
): string {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return '';

  const lines = Object.entries(attrs)
    .filter(([, value]) => isFilledValue(value))
    .map(([key, value]) => {
      const label = PROPERTY_IMPORT_FIELD_LABELS[key] ?? key.replace(/_/g, ' ');
      return `${label}: ${String(value)}`;
    });

  return lines.length > 0 ? lines.join('\n') : '';
}
