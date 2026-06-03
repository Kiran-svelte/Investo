import { useMemo, useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import api, { type ApiResponse } from '../../services/api';
import {
  PROPERTY_IMPORT_SPREADSHEET_MIME_TYPES,
  type PropertyImportDraft,
} from '../../services/propertyImport';

export interface SpreadsheetColumnMapping {
  source_column: string;
  target_field: string;
}

const TARGET_FIELDS = [
  { value: '', label: 'Skip column' },
  { value: 'name', label: 'Name' },
  { value: 'builder', label: 'Builder' },
  { value: 'location_city', label: 'City' },
  { value: 'location_area', label: 'Area' },
  { value: 'location_pincode', label: 'Pincode' },
  { value: 'price_min', label: 'Price min' },
  { value: 'price_max', label: 'Price max' },
  { value: 'bedrooms', label: 'Bedrooms / BHK' },
  { value: 'property_type', label: 'Property type' },
  { value: 'description', label: 'Description' },
  { value: 'rera_number', label: 'RERA' },
  { value: 'status', label: 'Status' },
];

interface PropertyImportSpreadsheetPanelProps {
  draftId: string;
  projectName: string;
  propertyType: string;
  disabled?: boolean;
  onImported: (draft: PropertyImportDraft) => void;
  onError: (message: string) => void;
}

interface ParsePreview {
  headers: string[];
  previewRows: Record<string, string>[];
  rows?: Record<string, string>[];
  rowCount: number;
  suggestedMapping: Record<string, string>;
}

export default function PropertyImportSpreadsheetPanel({
  draftId,
  projectName,
  propertyType,
  disabled = false,
  onImported,
  onError,
}: PropertyImportSpreadsheetPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [allRows, setAllRows] = useState<Record<string, string>[]>([]);
  const [mappings, setMappings] = useState<SpreadsheetColumnMapping[]>([]);
  const [loading, setLoading] = useState(false);

  const rowPreview = useMemo(() => preview?.previewRows ?? [], [preview]);

  const handleFile = async (selected: File | null) => {
    setFile(selected);
    setPreview(null);
    setAllRows([]);
    if (!selected) {
      return;
    }

    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', selected);
      const { data } = await api.post<ApiResponse<ParsePreview>>(
        '/property-imports/bulk/parse',
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      const payload = data.data;
      setPreview(payload);
      const suggested = Object.entries(payload.suggestedMapping || {}).map(([source_column, target_field]) => ({
        source_column,
        target_field: target_field === 'skip' ? '' : target_field,
      }));
      setMappings(suggested.length > 0 ? suggested : payload.headers.map((header) => ({ source_column: header, target_field: '' })));

      if (Array.isArray(payload.rows) && payload.rows.length > 0) {
        setAllRows(payload.rows);
      } else if (selected.type.includes('csv') || selected.name.endsWith('.csv')) {
        const text = await selected.text();
        const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
        const headers = lines[0]?.split(',').map((cell) => cell.trim()) ?? [];
        const rows = lines.slice(1).map((line) => {
          const values = line.split(',');
          return headers.reduce<Record<string, string>>((acc, header, index) => {
            acc[header] = (values[index] ?? '').trim();
            return acc;
          }, {});
        });
        setAllRows(rows);
      } else {
        setAllRows(payload.previewRows);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Failed to read spreadsheet');
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!file || !preview) {
      return;
    }
    setLoading(true);
    try {
      const columnMapping = mappings.reduce<Record<string, string>>((acc, item) => {
        acc[item.source_column] = item.target_field || 'skip';
        return acc;
      }, {});

      const { data } = await api.post<ApiResponse<{ draft: PropertyImportDraft; units_count: number }>>(
        `/property-imports/drafts/${draftId}/spreadsheet/import`,
        {
          project_name: projectName || 'Imported project',
          property_type: propertyType || 'villa',
          column_mapping: columnMapping,
          raw_rows: allRows,
        },
      );
      onImported(data.data.draft);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Spreadsheet import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <FileSpreadsheet className="h-4 w-4" />
        Bulk CSV / Excel (CRM export)
      </div>
      <p className="mt-1 text-xs text-slate-600">
        Upload a builder or CRM export to create multiple property units at once.
      </p>
      <input
        type="file"
        accept={PROPERTY_IMPORT_SPREADSHEET_MIME_TYPES.join(',')}
        disabled={disabled || loading}
        className="mt-3 block w-full text-sm"
        onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
      />

      {preview && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-medium text-slate-700">
            Column mapping ({preview.rowCount} rows detected)
          </p>
          {mappings.map((mapping, index) => (
            <div key={mapping.source_column} className="grid grid-cols-2 gap-2 text-sm">
              <span className="truncate rounded bg-white px-2 py-1 text-slate-700">{mapping.source_column}</span>
              <select
                value={mapping.target_field}
                disabled={disabled || loading}
                onChange={(e) => {
                  const next = [...mappings];
                  next[index] = { ...mapping, target_field: e.target.value };
                  setMappings(next);
                }}
                className="rounded border border-slate-200 px-2 py-1"
              >
                {TARGET_FIELDS.map((field) => (
                  <option key={field.value} value={field.value}>{field.label}</option>
                ))}
              </select>
            </div>
          ))}

          {rowPreview.length > 0 && (
            <div className="overflow-x-auto rounded border border-slate-200 bg-white text-xs">
              <table className="min-w-full">
                <thead>
                  <tr>
                    {preview.headers.map((header) => (
                      <th key={header} className="px-2 py-1 text-left font-medium text-slate-600">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowPreview.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`} className="border-t border-slate-100">
                      {preview.headers.map((header) => (
                        <td key={`${rowIndex}-${header}`} className="px-2 py-1 text-slate-700">{row[header]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            type="button"
            disabled={disabled || loading || mappings.every((item) => !item.target_field)}
            onClick={() => void handleImport()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Import {preview.rowCount} row(s)
          </button>
        </div>
      )}
    </div>
  );
}
