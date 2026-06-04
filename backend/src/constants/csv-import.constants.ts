/**
 * Constants for the CSV/Excel property bulk import pipeline.
 *
 * All column alias mappings, accepted MIME types, and size limits live here.
 * No magic strings anywhere else in the csv-import service.
 */

/** Maximum file size in bytes accepted for a bulk CSV/XLSX upload (10 MB). */
export const CSV_IMPORT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Maximum number of property rows we will process in a single bulk import. */
export const CSV_IMPORT_MAX_ROW_COUNT = 500;

/** MIME types accepted as CSV uploads. */
export const CSV_MIME_TYPES = [
  'text/csv',
  'text/plain',
  'application/csv',
  'application/x-csv',
] as const;

/** MIME types accepted as Excel uploads. */
export const XLSX_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
] as const;

/** All accepted bulk import MIME types. */
export const BULK_IMPORT_ACCEPTED_MIME_TYPES = [...CSV_MIME_TYPES, ...XLSX_MIME_TYPES] as const;

/** Excel magic bytes (PK zip header used by xlsx). */
export const XLSX_MAGIC_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Alias mapping: header name fragments → target property schema field.
 * All keys are lowercase. Matching is done via `includes()` on normalised header.
 */
export const COLUMN_ALIASES: Record<string, string> = {
  // Property name / project
  'project': 'name',
  'property name': 'name',
  'project name': 'name',
  'name': 'name',
  'title': 'name',
  'unit number': 'name',
  'unit no': 'name',
  'unit': 'name',
  'villa number': 'name',
  'villa no': 'name',
  'flat no': 'name',
  'flat number': 'name',

  // Builder / developer
  'builder': 'builder',
  'developer': 'builder',
  'developer name': 'builder',

  // Location: city
  'city': 'location_city',
  'location city': 'location_city',
  'project city': 'location_city',
  'town': 'location_city',

  // Location: area / locality
  'area': 'location_area',
  'locality': 'location_area',
  'location area': 'location_area',
  'neighbourhood': 'location_area',
  'neighborhood': 'location_area',
  'sector': 'location_area',
  'zone': 'location_area',

  // Pincode
  'pincode': 'location_pincode',
  'pin code': 'location_pincode',
  'zip': 'location_pincode',
  'zip code': 'location_pincode',
  'postal': 'location_pincode',

  // Price min
  'price min': 'price_min',
  'price from': 'price_min',
  'min price': 'price_min',
  'starting price': 'price_min',
  'price starts': 'price_min',
  'base price': 'price_min',

  // Price max
  'price max': 'price_max',
  'price to': 'price_max',
  'max price': 'price_max',
  'price upto': 'price_max',
  'price up to': 'price_max',

  // Single price (maps to both min and max)
  'price': 'price_single',
  'rate': 'price_single',

  // Bedrooms / BHK
  'bhk': 'bedrooms',
  'bedrooms': 'bedrooms',
  'bedroom': 'bedrooms',
  'bed': 'bedrooms',
  'beds': 'bedrooms',
  'configuration': 'bedrooms',
  'config': 'bedrooms',

  // Property type
  'type': 'property_type',
  'property type': 'property_type',
  'unit type': 'property_type',

  // Status
  'status': 'status',
  'availability': 'status',
  'available': 'status',

  // RERA
  'rera': 'rera_number',
  'rera number': 'rera_number',
  'rera no': 'rera_number',
  'rera id': 'rera_number',

  // Description
  'description': 'description',
  'remarks': 'description',
  'notes': 'description',
  'details': 'description',

  // Amenities
  'amenities': 'amenities',
  'features': 'amenities',
  'facilities': 'amenities',
};

/** Canonical target fields for a property row candidate. */
export const PROPERTY_TARGET_FIELDS = [
  'name',
  'builder',
  'location_city',
  'location_area',
  'location_pincode',
  'price_min',
  'price_max',
  'bedrooms',
  'property_type',
  'status',
  'rera_number',
  'description',
  'amenities',
] as const;

export type PropertyTargetField = typeof PROPERTY_TARGET_FIELDS[number];

/** Allowed property type values (lowercase). */
export const ALLOWED_PROPERTY_TYPES = ['villa', 'apartment', 'plot', 'commercial', 'other'] as const;

/** Allowed property status values (lowercase). */
export const ALLOWED_PROPERTY_STATUSES = ['available', 'sold', 'upcoming'] as const;

/** Default confidence score assigned to auto-mapped columns. */
export const AUTO_MAP_CONFIDENCE = 0.82;

/** Multiplier applied to price values in crore (₹ Cr). */
export const CRORE_MULTIPLIER = 10_000_000;

/** Multiplier applied to price values in lakh. */
export const LAKH_MULTIPLIER = 100_000;
