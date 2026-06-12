/**
 * Constants for the bulk CSV/Excel property import UI.
 */

export {
  BULK_IMPORT_COLUMN_TARGET_OPTIONS,
  BULK_IMPORT_FIELDS,
  BULK_IMPORT_FIELDS_BY_GROUP,
  BULK_IMPORT_FIELD_GROUPS,
  BULK_IMPORT_PRICE_SINGLE_FIELD,
  BULK_IMPORT_TARGET_FIELD_LABELS,
  PROPERTY_IMPORT_FIELD_LABELS,
} from './property-import-fields.constants';

/** Max file size for a bulk upload file (10 MB). */
export const BULK_IMPORT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Human-readable max size label. */
export const BULK_IMPORT_MAX_FILE_SIZE_LABEL = '10 MB';

/** Accepted MIME types for the file picker. */
export const BULK_IMPORT_ACCEPTED_MIME_TYPES = [
  'text/csv',
  'application/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
] as const;

/** File extensions shown in the file input accept attribute. */
export const BULK_IMPORT_ACCEPTED_EXTENSIONS = '.csv,.xlsx';

/** Number of preview rows shown in the column mapping step. */
export const BULK_IMPORT_PREVIEW_ROW_COUNT = 5;

/** Steps in the bulk import wizard. */
export const BULK_IMPORT_STEPS = ['Upload', 'Map columns', 'Review & publish'] as const;
export type BulkImportStep = typeof BULK_IMPORT_STEPS[number];
