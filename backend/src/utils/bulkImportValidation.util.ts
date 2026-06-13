import { z } from 'zod';
import { CSV_IMPORT_MAX_ROW_COUNT } from '../constants/csv-import.constants';
import { sanitizeImportRow } from './sanitizeImportRow.util';

/** Coerces any spreadsheet cell value to a string (arrays joined with comma). */
export const bulkImportCellSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) {
      return '';
    }
    if (Array.isArray(value)) {
      return value.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ');
    }
    return String(value).trim();
  },
  z.string(),
);

/** One raw import row — strips PapaParse meta keys and stringifies all cells. */
export const bulkImportRawRowSchema = z
  .record(bulkImportCellSchema)
  .transform((row) => sanitizeImportRow(row as Record<string, unknown>));

/** All rows for confirm / spreadsheet import endpoints. */
export function bulkImportRawRowsSchema(maxRows = CSV_IMPORT_MAX_ROW_COUNT, minRows = 1) {
  return z.array(bulkImportRawRowSchema).min(minRows).max(maxRows);
}

/** Human-readable message for bulk-import Zod failures. */
export function formatBulkImportZodError(err: z.ZodError): string {
  const first = err.errors[0];
  if (!first) {
    return 'Request body is invalid';
  }

  const path = first.path.map(String).join('.');
  if (path.includes('__parsed_extra') || path.includes('raw_rows')) {
    return 'Some rows have extra columns or malformed cells (often a trailing comma after the last value). Fix the spreadsheet and re-upload.';
  }

  if (path) {
    return `${path}: ${first.message}`;
  }

  return first.message;
}
