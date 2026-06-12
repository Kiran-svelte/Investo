/**
 * Constants for the CSV/Excel property bulk import pipeline.
 *
 * All column alias mappings, accepted MIME types, and size limits live here.
 * No magic strings anywhere else in the csv-import service.
 */

import {
  buildPropertyImportColumnAliases,
  PRICE_SINGLE_FIELD,
  PROPERTY_TARGET_FIELDS,
  type PropertyTargetField,
} from './property-import-fields.constants';

export {
  PRICE_SINGLE_FIELD,
  PROPERTY_TARGET_FIELDS,
  type PropertyTargetField,
} from './property-import-fields.constants';

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
export const COLUMN_ALIASES: Record<string, string> = buildPropertyImportColumnAliases();

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

/** Virtual + canonical targets accepted in column mapping dropdowns. */
export type ColumnMappingTarget = PropertyTargetField | typeof PRICE_SINGLE_FIELD | 'skip';
