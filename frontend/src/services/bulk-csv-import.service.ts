/**
 * Typed API client for the bulk CSV/Excel property import endpoints.
 *
 * Mirrors the pattern established in propertyImport.ts — all HTTP calls live here,
 * no fetch/axios calls in components or hooks.
 */

import api from './api';

/** A single raw row returned from the parse endpoint. */
export type BulkImportRawRow = Record<string, string>;

/** Admin-set column mapping: header name → target field key or 'skip'. */
export type BulkImportColumnMapping = Record<string, string>;

/** Result of the parse endpoint. */
export interface BulkImportParseResult {
  headers: string[];
  /** First 5 rows for the mapping preview table. */
  previewRows: BulkImportRawRow[];
  rowCount: number;
  /** Backend auto-detected mapping suggestion. */
  suggestedMapping: BulkImportColumnMapping;
}

/** Result of the confirm endpoint. */
export interface BulkImportConfirmResult {
  draft_id: string;
  row_count: number;
  valid_count: number;
  invalid_count: number;
}

/** Result of the publish endpoint. */
export interface BulkImportPublishResult {
  published_count: number;
  skipped_invalid_count: number;
  knowledge_indexed_count: number;
}

/** Input for the confirm endpoint. */
export interface BulkImportConfirmInput {
  project_name: string;
  property_type: 'villa' | 'apartment' | 'plot' | 'commercial' | 'other';
  column_mapping: BulkImportColumnMapping;
  raw_rows: BulkImportRawRow[];
  auto_detected_headers?: string[];
}

/**
 * Uploads a CSV or XLSX file to the backend parse endpoint.
 * Returns headers, 5-row preview, row count, and a suggested column mapping.
 *
 * @param file - The File object from the file input or drop zone
 * @returns Parsed preview data and auto-detected column mapping
 * @throws AxiosError on HTTP failure
 */
export async function parseBulkImportFile(file: File): Promise<BulkImportParseResult> {
  const formData = new FormData();
  formData.append('file', file, file.name);

  const response = await api.post<{ data: BulkImportParseResult }>(
    '/property-imports/bulk/parse',
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      // Larger timeout for file uploads and parse
      timeout: 60_000,
    },
  );

  return response.data.data;
}

/**
 * Confirms the column mapping and sends all rows to the backend to create a bulk import draft.
 * The backend validates and maps all rows but does NOT publish yet.
 *
 * @param input - Project name, property type, column mapping, and all raw rows
 * @returns Draft ID and row validity counts
 * @throws AxiosError on HTTP failure
 */
export async function confirmBulkImport(input: BulkImportConfirmInput): Promise<BulkImportConfirmResult> {
  const response = await api.post<{ data: BulkImportConfirmResult }>(
    '/property-imports/bulk/confirm',
    input,
    { timeout: 60_000 },
  );

  return response.data.data;
}

/**
 * Publishes all valid rows from a confirmed bulk import draft as Property catalog entries.
 * Atomically — either all succeed or none are created.
 *
 * @param draftId - The draft ID returned by confirmBulkImport
 * @param forceRepublish - Set to true to re-publish an already-published draft
 * @returns Count of published and skipped rows
 * @throws AxiosError on HTTP failure
 */
export async function publishBulkImport(
  draftId: string,
  forceRepublish = false,
): Promise<BulkImportPublishResult> {
  const response = await api.post<{ data: BulkImportPublishResult }>(
    `/property-imports/bulk/publish/${draftId}`,
    { force_republish: forceRepublish },
    { timeout: 120_000 },
  );

  return response.data.data;
}
