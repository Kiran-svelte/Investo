/**
 * Normalizes spreadsheet rows for bulk property import.
 * PapaParse adds `__parsed_extra` (array) when a row has more fields than headers —
 * common with trailing commas in CRM exports.
 */

/** Meta fields injected by PapaParse — never sent to mapping or validation. */
const PAPA_META_KEYS = new Set(['__parsed_extra', '__parsed_fields']);

function coerceCellToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean).join(', ');
  }
  return String(value).trim();
}

/** Strips parser meta keys and coerces every cell to a trimmed string. */
export function sanitizeImportRow(row: Record<string, unknown>): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, value] of Object.entries(row)) {
    if (PAPA_META_KEYS.has(key) || key.startsWith('__')) {
      continue;
    }
    sanitized[key] = coerceCellToString(value);
  }

  return sanitized;
}

/** Sanitizes an array of parsed spreadsheet rows. */
export function sanitizeImportRows(rows: Record<string, unknown>[]): Record<string, string>[] {
  return rows.map(sanitizeImportRow);
}
