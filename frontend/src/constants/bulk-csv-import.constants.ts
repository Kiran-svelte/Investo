/**
 * Constants for the bulk CSV/Excel property import UI.
 */

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

/** Labels displayed in the column mapping dropdowns. */
export const BULK_IMPORT_TARGET_FIELD_LABELS: Record<string, string> = {
  name: 'Property Name',
  builder: 'Builder / Developer',
  location_city: 'City',
  location_area: 'Locality / Area',
  location_pincode: 'Pincode',
  price_min: 'Price (Min)',
  price_max: 'Price (Max)',
  price_single: 'Price (Single)',
  bedrooms: 'Bedrooms / BHK',
  property_type: 'Property Type',
  status: 'Availability Status',
  rera_number: 'RERA Number',
  description: 'Description / Remarks',
  amenities: 'Amenities / Features',
  skip: '— Skip this column —',
};

/** All target field options shown in the column mapping dropdown. */
export const BULK_IMPORT_COLUMN_TARGET_OPTIONS = [
  'name',
  'builder',
  'location_city',
  'location_area',
  'location_pincode',
  'price_min',
  'price_max',
  'price_single',
  'bedrooms',
  'property_type',
  'status',
  'rera_number',
  'description',
  'amenities',
  'skip',
] as const;

/** Number of preview rows shown in the column mapping step. */
export const BULK_IMPORT_PREVIEW_ROW_COUNT = 5;

/** Steps in the bulk import wizard. */
export const BULK_IMPORT_STEPS = ['Upload', 'Map columns', 'Review & publish'] as const;
export type BulkImportStep = typeof BULK_IMPORT_STEPS[number];
