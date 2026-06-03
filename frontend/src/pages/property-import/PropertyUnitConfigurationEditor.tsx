import { Plus, Trash2 } from 'lucide-react';
import {
  emptyUnitFormRow,
  PROPERTY_TYPES_WITH_UNIT_CONFIG,
  UNIT_BHK_OPTIONS,
  type UnitConfigurationFormRow,
} from './propertyImportUnitConfig';

interface PropertyUnitConfigurationEditorProps {
  propertyType: string;
  rows: UnitConfigurationFormRow[];
  singleUnitMode: boolean;
  bedrooms: string;
  disabled?: boolean;
  onRowsChange: (rows: UnitConfigurationFormRow[]) => void;
  onSingleUnitModeChange: (enabled: boolean) => void;
  onBedroomsChange: (value: string) => void;
}

function unitSectionTitle(propertyType: string): string {
  const type = propertyType.trim().toLowerCase();
  if (type === 'villa') {
    return 'Villa inventory by type';
  }
  if (type === 'plot') {
    return 'Plot / lot inventory';
  }
  if (type === 'commercial') {
    return 'Commercial unit mix';
  }
  return 'Apartment inventory by BHK';
}

function unitSectionHint(propertyType: string): string {
  const type = propertyType.trim().toLowerCase();
  if (type === 'villa') {
    return 'Add one row per villa type (e.g. 3BHK × 4 units, 4BHK × 1 unit). WhatsApp AI uses this instead of a single bedroom count.';
  }
  if (type === 'plot') {
    return 'Add plot sizes or phases with counts. Optional price range per row.';
  }
  return 'Add rows for each BHK type in the project (count + optional price range per type).';
}

export default function PropertyUnitConfigurationEditor({
  propertyType,
  rows,
  singleUnitMode,
  bedrooms,
  disabled = false,
  onRowsChange,
  onSingleUnitModeChange,
  onBedroomsChange,
}: PropertyUnitConfigurationEditorProps) {
  const normalizedType = propertyType.trim().toLowerCase();
  if (!(PROPERTY_TYPES_WITH_UNIT_CONFIG as readonly string[]).includes(normalizedType)) {
    return null;
  }

  const updateRow = (index: number, patch: Partial<UnitConfigurationFormRow>) => {
    onRowsChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    onRowsChange([...rows, emptyUnitFormRow()]);
  };

  const removeRow = (index: number) => {
    if (rows.length <= 1) {
      onRowsChange([emptyUnitFormRow()]);
      return;
    }
    onRowsChange(rows.filter((_, i) => i !== index));
  };

  return (
    <div className="sm:col-span-2 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
      <p className="text-sm font-semibold text-indigo-950">{unitSectionTitle(propertyType)}</p>
      <p className="mt-1 text-xs text-indigo-800/90">{unitSectionHint(propertyType)}</p>

      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={singleUnitMode}
          onChange={(e) => onSingleUnitModeChange(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 rounded border-surface-border-strong text-indigo-600 focus:ring-indigo-500"
        />
        Single unit / simple listing (use one bedroom count instead)
      </label>

      {singleUnitMode ? (
        <div className="mt-3">
          <label className="block text-sm font-medium text-ink-secondary">Bedrooms (BHK)</label>
          <input
            type="text"
            inputMode="numeric"
            value={bedrooms}
            onChange={(e) => onBedroomsChange(e.target.value)}
            disabled={disabled}
            placeholder="3"
            className="mt-1 w-full max-w-xs rounded-lg border border-surface-border-strong px-3 py-2 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:bg-surface-subtle"
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row, index) => (
            <div
              key={`unit-row-${index}`}
              className="grid grid-cols-2 gap-3 rounded-lg border border-indigo-100 bg-surface-elevated p-3 sm:grid-cols-6"
            >
              <div>
                <label className="text-xs font-medium text-slate-600">BHK</label>
                <select
                  value={row.bhk}
                  onChange={(e) => updateRow(index, { bhk: e.target.value })}
                  disabled={disabled}
                  className="mt-1 w-full rounded-lg border border-surface-border-strong px-2 py-2 text-sm disabled:bg-surface-subtle"
                >
                  {UNIT_BHK_OPTIONS.map((bhk) => (
                    <option key={bhk} value={String(bhk)}>
                      {bhk} BHK
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-medium text-slate-600">Label (optional)</label>
                <input
                  type="text"
                  value={row.unit_label}
                  onChange={(e) => updateRow(index, { unit_label: e.target.value })}
                  disabled={disabled}
                  placeholder={normalizedType === 'villa' ? 'Premium villa' : 'Corner unit'}
                  className="mt-1 w-full rounded-lg border border-surface-border-strong px-2 py-2 text-sm disabled:bg-surface-subtle"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Count</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={row.count}
                  onChange={(e) => updateRow(index, { count: e.target.value })}
                  disabled={disabled}
                  placeholder="12"
                  className="mt-1 w-full rounded-lg border border-surface-border-strong px-2 py-2 text-sm disabled:bg-surface-subtle"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Price min (₹)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={row.price_min}
                  onChange={(e) => updateRow(index, { price_min: e.target.value })}
                  disabled={disabled}
                  placeholder="Optional"
                  className="mt-1 w-full rounded-lg border border-surface-border-strong px-2 py-2 text-sm disabled:bg-surface-subtle"
                />
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="text-xs font-medium text-slate-600">Price max (₹)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={row.price_max}
                    onChange={(e) => updateRow(index, { price_max: e.target.value })}
                    disabled={disabled}
                    placeholder="Optional"
                    className="mt-1 w-full rounded-lg border border-surface-border-strong px-2 py-2 text-sm disabled:bg-surface-subtle"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  disabled={disabled}
                  className="mb-0.5 rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                  aria-label="Remove unit row"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            disabled={disabled}
            className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-surface-elevated px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add unit type
          </button>
        </div>
      )}
    </div>
  );
}
