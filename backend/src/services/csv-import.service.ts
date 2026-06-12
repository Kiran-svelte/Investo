/**
 * CsvImportService
 *
 * Parses CSV and XLSX buffers into typed property row candidates, detects
 * column-to-field mappings, and synthesises an AI knowledge context string
 * for the whole batch.
 *
 * This service is pure (no I/O, no database). All async is isolated to the
 * dynamic exceljs import so the xlsx parser does not load on cold start.
 */

import Papa from 'papaparse';
import {
  ALLOWED_PROPERTY_STATUSES,
  ALLOWED_PROPERTY_TYPES,
  AUTO_MAP_CONFIDENCE,
  COLUMN_ALIASES,
  CRORE_MULTIPLIER,
  CSV_IMPORT_MAX_ROW_COUNT,
  LAKH_MULTIPLIER,
  PRICE_SINGLE_FIELD,
  XLSX_MAGIC_BYTES,
  type PropertyTargetField,
} from '../constants/csv-import.constants';
import {
  PROPERTY_IDENTITY_TARGET_FIELDS,
  PROPERTY_IMPORT_FIELDS,
  type PropertyImportFieldDef,
} from '../constants/property-import-fields.constants';

/** A single raw row returned from a parsed file. */
export type RawRow = Record<string, string>;

/** Auto-detected or manually supplied mapping of header → target field. */
export type ColumnMapping = Record<string, PropertyTargetField | typeof PRICE_SINGLE_FIELD | 'skip'>;

/** Mapped and type-coerced property row data (all Indian-market import fields). */
export type PropertyRowData = Record<string, unknown> & {
  name: string | null;
  builder: string | null;
  location_city: string | null;
  location_area: string | null;
  location_pincode: string | null;
  price_min: number | null;
  price_max: number | null;
  bedrooms: number | null;
  property_type: string;
  status: string;
  rera_number: string | null;
  description: string | null;
  amenities: string[];
};

/** A typed, validated property candidate derived from one spreadsheet row. */
export interface PropertyRowCandidate {
  /** Original 1-based row number in the source file. */
  rowNumber: number;
  /** Whether all required validation rules pass. */
  isValid: boolean;
  /** Human-readable validation error messages. */
  errors: string[];
  /** Mapped and type-coerced property data. */
  data: PropertyRowData;
}

const FIELD_DEF_BY_KEY = new Map<string, PropertyImportFieldDef>(
  PROPERTY_IMPORT_FIELDS.map((field) => [field.key, field]),
);

/** Result of a file parse operation. */
export interface CsvParseResult {
  headers: string[];
  /** First 5 rows for the admin preview table. */
  previewRows: RawRow[];
  /** All parsed rows (capped at CSV_IMPORT_MAX_ROW_COUNT) for confirm/import. */
  rows: RawRow[];
  rowCount: number;
  suggestedMapping: ColumnMapping;
}

/** Result of applying a confirmed column mapping to all rows. */
export interface CsvApplyMappingResult {
  candidates: PropertyRowCandidate[];
  validCount: number;
  invalidCount: number;
}

/** Checks whether the buffer starts with XLSX magic bytes (PK zip header). */
function isXlsxBuffer(buffer: Buffer): boolean {
  return buffer.slice(0, 4).equals(XLSX_MAGIC_BYTES);
}

/** Normalises a raw header string for alias lookup. */
function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[_\-/\\]+/g, ' ').replace(/\s+/g, ' ');
}

/** Resolves a raw header to a target field using the alias table. */
function resolveHeaderAlias(header: string): PropertyTargetField | typeof PRICE_SINGLE_FIELD | 'skip' {
  const trimmed = header.trim();
  if (!trimmed || /^__empty/i.test(trimmed)) {
    return 'skip';
  }

  // Prefer exact snake_case CRM column names (e.g. carpet_area_sqft, project_name).
  const snakeKey = trimmed.toLowerCase().replace(/[\s-]+/g, '_');
  if (FIELD_DEF_BY_KEY.has(snakeKey)) {
    return snakeKey as PropertyTargetField;
  }

  const normalised = normaliseHeader(header);
  const exact = COLUMN_ALIASES[normalised];
  if (exact) {
    return exact as PropertyTargetField | typeof PRICE_SINGLE_FIELD;
  }

  // Partial match: prefer longer alias keys to avoid "price" matching "price per sqft".
  const aliasEntries = Object.entries(COLUMN_ALIASES).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, field] of aliasEntries) {
    if (normalised.includes(alias)) {
      return field as PropertyTargetField | typeof PRICE_SINGLE_FIELD;
    }
  }

  return 'skip';
}

/** Builds a column mapping suggestion from a list of raw headers. */
function buildSuggestedMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const usedTargets = new Set<string>();

  for (const header of headers) {
    const target = resolveHeaderAlias(header);

    // Avoid mapping two columns to the same target field (first match wins).
    if (target !== 'skip' && usedTargets.has(target)) {
      mapping[header] = 'skip';
      continue;
    }

    mapping[header] = target;
    if (target !== 'skip') {
      usedTargets.add(target);
    }
  }

  return mapping;
}

/** Parses a raw Indian currency string to paise-free integer rupees. */
function parseIndianCurrencyString(value: string): number | null {
  if (!value || !value.trim()) {
    return null;
  }

  const cleaned = value.replace(/[₹,\s]/g, '');
  const croreMatch = cleaned.match(/^([0-9.]+)\s*(?:cr|crore|crs)/i);
  if (croreMatch) {
    const num = parseFloat(croreMatch[1]);
    return Number.isFinite(num) ? Math.round(num * CRORE_MULTIPLIER) : null;
  }

  const lakhMatch = cleaned.match(/^([0-9.]+)\s*(?:l|lac|lakh|lakhs)/i);
  if (lakhMatch) {
    const num = parseFloat(lakhMatch[1]);
    return Number.isFinite(num) ? Math.round(num * LAKH_MULTIPLIER) : null;
  }

  const plain = parseFloat(cleaned);
  return Number.isFinite(plain) ? Math.round(plain) : null;
}

/** Coerces a raw cell string to a non-negative integer bedroom count. */
function parseBedroomCount(value: string): number | null {
  const bhkMatch = value.match(/(\d+)\s*(?:bhk|bed|br)?/i);
  if (!bhkMatch) {
    return null;
  }
  const num = parseInt(bhkMatch[1], 10);
  return num > 0 && num <= 20 ? num : null;
}

/** Normalises a raw status string to a valid PropertyStatus enum value. */
function normaliseStatus(value: string): string {
  const lower = value.trim().toLowerCase();
  if (lower.includes('sold')) {
    return 'sold';
  }
  if (lower.includes('upcoming') || lower.includes('launch')) {
    return 'upcoming';
  }
  return 'available';
}

/** Normalises a raw property type string to a valid PropertyType enum value. */
function normalisePropertyType(value: string, fallback: string): string {
  const lower = value.trim().toLowerCase();
  for (const allowed of ALLOWED_PROPERTY_TYPES) {
    if (lower.includes(allowed)) {
      return allowed;
    }
  }
  return fallback || 'apartment';
}

/** Splits a comma- or semicolon-delimited amenities string into a clean array. */
function parseAmenitiesString(value: string): string[] {
  if (!value || !value.trim()) {
    return [];
  }

  const delimiter = value.includes(';') ? ';' : ',';
  return value
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function parsePlainNumber(value: string): number | null {
  if (!value || !value.trim()) {
    return null;
  }
  const cleaned = value.replace(/[,₹\s]/g, '').replace(/[^\d.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBooleanCell(value: string): boolean | null {
  if (!value || !value.trim()) {
    return null;
  }
  const lower = value.trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'available', 'included'].includes(lower)) {
    return true;
  }
  if (['no', 'n', 'false', '0', 'na', 'n/a', 'not included'].includes(lower)) {
    return false;
  }
  return null;
}

function coerceMappedValue(fieldKey: string, rawValue: string): unknown {
  if (!rawValue.trim()) {
    return null;
  }

  const fieldDef = FIELD_DEF_BY_KEY.get(fieldKey);
  const fieldType = fieldDef?.type ?? 'string';

  switch (fieldType) {
    case 'currency':
      return parseIndianCurrencyString(rawValue);
    case 'number':
      if (fieldKey === 'bedrooms') {
        return parseBedroomCount(rawValue) ?? parsePlainNumber(rawValue);
      }
      return parsePlainNumber(rawValue);
    case 'boolean':
      return parseBooleanCell(rawValue);
    case 'amenities':
      return parseAmenitiesString(rawValue);
    default:
      return rawValue.trim();
  }
}

function resolvePropertyName(getValue: (field: string) => string): string | null {
  const explicitName = getValue('name');
  if (explicitName) {
    return explicitName;
  }

  const unitLabel = getValue('unit_label');
  const projectName = getValue('project_name');

  if (unitLabel && projectName) {
    return `${projectName} ${unitLabel}`.trim();
  }
  if (unitLabel) {
    return unitLabel;
  }
  if (projectName) {
    return projectName;
  }

  return null;
}

/** Maps a single raw row to a `PropertyRowCandidate` using the supplied mapping. */
function mapRowToCandidate(
  rawRow: RawRow,
  mapping: ColumnMapping,
  rowNumber: number,
  defaultPropertyType: string,
): PropertyRowCandidate {
  const errors: string[] = [];

  const headerByTarget = new Map<string, string>();
  for (const [header, target] of Object.entries(mapping)) {
    if (target && target !== 'skip' && !headerByTarget.has(target)) {
      headerByTarget.set(target, header);
    }
  }

  const getValue = (targetField: string): string => {
    const header = headerByTarget.get(targetField);
    if (!header) {
      return '';
    }
    return (rawRow[header] ?? '').trim();
  };

  const data: PropertyRowData = {
    name: null,
    builder: null,
    location_city: null,
    location_area: null,
    location_pincode: null,
    price_min: null,
    price_max: null,
    bedrooms: null,
    property_type: defaultPropertyType || 'apartment',
    status: 'available',
    rera_number: null,
    description: null,
    amenities: [],
  };

  for (const [target, header] of headerByTarget.entries()) {
    const rawValue = (rawRow[header] ?? '').trim();
    if (!rawValue) {
      continue;
    }

    if (target === PRICE_SINGLE_FIELD) {
      const parsed = parseIndianCurrencyString(rawValue);
      if (parsed !== null) {
        if (data.price_min === null) {
          data.price_min = parsed;
        }
        if (data.price_max === null) {
          data.price_max = parsed;
        }
      }
      continue;
    }

    const coerced = coerceMappedValue(target, rawValue);
    if (coerced === null || coerced === undefined) {
      continue;
    }

    (data as Record<string, unknown>)[target] = coerced;
  }

  data.name = resolvePropertyName(getValue);
  if (!data.name) {
    errors.push('Map at least one identity column: Property name, Unit label, or Project name');
  }

  const priceField = parseIndianCurrencyString(getValue('price'));
  if (data.price_min === null && priceField !== null) {
    data.price_min = priceField;
  }
  if (data.price_max === null && priceField !== null) {
    data.price_max = priceField;
  }

  if (data.price_min !== null && data.price_max !== null && data.price_min > data.price_max) {
    errors.push('Price min cannot be greater than price max');
  }

  if (typeof data.bedrooms !== 'number') {
    const bedroomParsed = parseBedroomCount(getValue('bedrooms')) ?? parseBedroomCount(getValue('bhk'));
    data.bedrooms = bedroomParsed;
  }

  const propertyTypeRaw = getValue('property_type');
  data.property_type = normalisePropertyType(
    propertyTypeRaw || String(data.property_type ?? ''),
    defaultPropertyType,
  );

  const statusRaw = getValue('status');
  data.status = ALLOWED_PROPERTY_STATUSES.includes(statusRaw.toLowerCase() as typeof ALLOWED_PROPERTY_STATUSES[number])
    ? statusRaw.toLowerCase()
    : normaliseStatus(statusRaw);

  if (!Array.isArray(data.amenities)) {
    data.amenities = parseAmenitiesString(getValue('amenities'));
  }

  return {
    rowNumber,
    isValid: errors.length === 0,
    errors,
    data,
  };
}

/** Plain JSON-safe copy of row data for Prisma draft storage. */
export function serializePropertyRowData(data: PropertyRowData): Record<string, unknown> {
  return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
}

/** Parses a CSV buffer using PapaParse. */
function parseCsvBuffer(buffer: Buffer): { headers: string[]; rows: RawRow[] } {
  const text = buffer.toString('utf-8');
  const result = Papa.parse<RawRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });

  const headers = result.meta.fields ?? [];
  return { headers, rows: result.data };
}

/** Parses an XLSX buffer using the dynamically imported exceljs. */
async function parseXlsxBuffer(buffer: Buffer): Promise<{ headers: string[]; rows: RawRow[] }> {
  // Dynamic import to avoid increasing cold-start time for non-xlsx paths.
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  // exceljs Buffer typings disagree with Node 22 Buffer; runtime accepts Uint8Array.
  await workbook.xlsx.load(new Uint8Array(buffer) as never);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { headers: [], rows: [] };
  }

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];

  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? '').trim();
  });

  const filteredHeaders = headers.filter(Boolean);
  const rows: RawRow[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const rawRow: RawRow = {};
    filteredHeaders.forEach((header, index) => {
      const cell = row.getCell(index + 1);
      rawRow[header] = String(cell.value ?? '').trim();
    });

    const hasContent = Object.values(rawRow).some((v) => v !== '');
    if (hasContent) {
      rows.push(rawRow);
    }
  });

  return { headers: filteredHeaders, rows };
}

export class CsvImportService {
  /**
   * Parses a CSV or XLSX buffer into headers, preview rows, and a suggested mapping.
   *
   * @param buffer - Raw file bytes
   * @param mimeType - MIME type declared by the client (used as hint; magic bytes take priority)
   * @returns CsvParseResult with headers, first-5 preview rows, total row count, and suggested mapping
   * @throws Error when the file cannot be parsed or exceeds row limits
   */
  async parseFile(buffer: Buffer, mimeType: string): Promise<CsvParseResult> {
    const isXlsx = isXlsxBuffer(buffer) || mimeType.includes('spreadsheet') || mimeType.includes('excel');

    const { headers, rows } = isXlsx
      ? await parseXlsxBuffer(buffer)
      : parseCsvBuffer(buffer);

    if (headers.length === 0) {
      throw new Error('File has no header row. Ensure the first row contains column names.');
    }

    const trimmedRows = rows.slice(0, CSV_IMPORT_MAX_ROW_COUNT);
    if (trimmedRows.length === 0) {
      throw new Error('No data rows found. Add at least one property row below the header.');
    }
    const previewRows = trimmedRows.slice(0, 5);
    const suggestedMapping = buildSuggestedMapping(headers);

    return {
      headers,
      previewRows,
      rows: trimmedRows,
      rowCount: trimmedRows.length,
      suggestedMapping,
    };
  }

  /**
   * Applies an admin-confirmed column mapping to all raw rows, returning typed candidates.
   *
   * @param rows - Raw parsed rows from `parseFile` (full set, not just preview)
   * @param mapping - Admin-confirmed header → target field mapping
   * @param defaultPropertyType - Fallback property type when the sheet has no type column
   * @returns Array of candidates with validity flags and typed data
   */
  applyMappingToRows(
    rows: RawRow[],
    mapping: ColumnMapping,
    defaultPropertyType: string,
  ): CsvApplyMappingResult {
    const candidates = rows.map((row, index) =>
      mapRowToCandidate(row, mapping, index + 2, defaultPropertyType),
    );

    return {
      candidates,
      validCount: candidates.filter((c) => c.isValid).length,
      invalidCount: candidates.filter((c) => !c.isValid).length,
    };
  }

  /**
   * Builds a compact text summary of the entire spreadsheet for AI knowledge ingestion.
   * The AI uses this to answer WhatsApp queries about the whole project range.
   *
   * @param candidates - Validated property row candidates (valid only)
   * @param projectName - Overall project / development name
   * @returns A concise text summary (max ~3000 chars)
   */
  buildAiKnowledgeContext(candidates: PropertyRowCandidate[], projectName: string): string {
    const validRows = candidates.filter((c) => c.isValid);
    if (validRows.length === 0) {
      return `Project: ${projectName}\nNo valid property rows found.`;
    }

    const firstRow = validRows[0].data;
    const lastRow = validRows[validRows.length - 1].data;

    const priceValues = validRows
      .flatMap((c) => [c.data.price_min, c.data.price_max])
      .filter((v): v is number => v !== null);

    const minPrice = priceValues.length > 0 ? Math.min(...priceValues) : null;
    const maxPrice = priceValues.length > 0 ? Math.max(...priceValues) : null;

    const types = [...new Set(validRows.map((c) => c.data.property_type))].join(', ');
    const locations = [...new Set(validRows.map((c) => c.data.location_city).filter(Boolean))].join(', ');
    const builders = [...new Set(validRows.map((c) => c.data.builder).filter(Boolean))].join(', ');

    const bedroomCounts = [...new Set(validRows.map((c) => c.data.bedrooms).filter((b) => b !== null))]
      .sort((a, b) => (a ?? 0) - (b ?? 0))
      .map((b) => `${b}BHK`)
      .join(', ');

    const formatPrice = (p: number | null) => {
      if (p === null) {
        return 'N/A';
      }
      if (p >= CRORE_MULTIPLIER) {
        return `₹${(p / CRORE_MULTIPLIER).toFixed(2)}Cr`;
      }
      if (p >= LAKH_MULTIPLIER) {
        return `₹${(p / LAKH_MULTIPLIER).toFixed(0)}L`;
      }
      return `₹${p.toLocaleString('en-IN')}`;
    };

    const lines: string[] = [
      `Project: ${projectName}`,
      `Total units: ${validRows.length}`,
      `Types: ${types || 'mixed'}`,
      builders ? `Developer: ${builders}` : '',
      locations ? `Locations: ${locations}` : '',
      bedroomCounts ? `Configurations: ${bedroomCounts}` : '',
      minPrice !== null ? `Price range: ${formatPrice(minPrice)} – ${formatPrice(maxPrice)}` : '',
      '',
      'Unit breakdown:',
    ].filter((l) => l !== null);

    const rowLines = validRows.slice(0, 50).map((c) => {
      const parts: string[] = [];
      if (c.data.name) {
        parts.push(String(c.data.name));
      }
      if (c.data.bedrooms) {
        parts.push(`${c.data.bedrooms}BHK`);
      } else if (c.data.bhk) {
        parts.push(String(c.data.bhk));
      }
      if (c.data.price_min) {
        parts.push(formatPrice(c.data.price_min as number));
      }
      if (c.data.carpet_area_sqft) {
        parts.push(`${c.data.carpet_area_sqft} sqft carpet`);
      }
      if (c.data.plot_area_sqft) {
        parts.push(`${c.data.plot_area_sqft} sqft plot`);
      }
      if (c.data.facing) {
        parts.push(`${c.data.facing} facing`);
      }
      if (c.data.location_area) {
        parts.push(String(c.data.location_area));
      }
      if (c.data.possession_date) {
        parts.push(String(c.data.possession_date));
      }
      return `  - ${parts.join(', ')}`;
    });

    return [...lines, ...rowLines].join('\n').slice(0, 3500);
  }

  /**
   * Validates a mapping has at least a name column mapped.
   *
   * @param mapping - The column mapping to validate
   * @param headers - All headers present in the file
   * @throws Error if no name column is mapped
   */
  validateMapping(mapping: ColumnMapping, headers: string[]): void {
    const hasIdentityMapping = Object.entries(mapping).some(
      ([header, field]) =>
        PROPERTY_IDENTITY_TARGET_FIELDS.includes(field as typeof PROPERTY_IDENTITY_TARGET_FIELDS[number])
        && headers.includes(header),
    );

    if (!hasIdentityMapping) {
      throw new Error(
        'Column mapping must include at least one identity column (Property name, Unit label, or Project name). Update the mapping and try again.',
      );
    }
  }

  /**
   * Returns the confidence score for a given mapping entry.
   * Auto-detected mappings get AUTO_MAP_CONFIDENCE; manually set mappings get 0.95.
   */
  getMappingConfidence(isAutoDetected: boolean): number {
    return isAutoDetected ? AUTO_MAP_CONFIDENCE : 0.95;
  }
}

export const csvImportService = new CsvImportService();
