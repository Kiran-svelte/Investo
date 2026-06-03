export const PROPERTY_TYPES_WITH_UNIT_CONFIG = ['apartment', 'villa', 'commercial', 'plot'] as const;

export type PropertyTypeWithUnitConfig = (typeof PROPERTY_TYPES_WITH_UNIT_CONFIG)[number];

export interface UnitConfigurationRow {
  bhk: number;
  unit_label: string | null;
  count: number;
  price_min: number | null;
  price_max: number | null;
}

export interface UnitConfigurationFormRow {
  bhk: string;
  unit_label: string;
  count: string;
  price_min: string;
  price_max: string;
}

export const UNIT_BHK_OPTIONS = [2, 3, 4, 5] as const;

export function emptyUnitFormRow(): UnitConfigurationFormRow {
  return { bhk: '2', unit_label: '', count: '', price_min: '', price_max: '' };
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseUnitConfigurations(draftData?: Record<string, unknown> | null): UnitConfigurationRow[] {
  if (!draftData || typeof draftData !== 'object') {
    return [];
  }

  const raw = draftData.unit_configurations ?? draftData.unitConfigurations ?? draftData.inventory_units;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item): UnitConfigurationRow | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }
      const record = item as Record<string, unknown>;
      const bhk = asNumber(record.bhk);
      const count = asNumber(record.count);
      if (bhk == null || count == null || count < 1) {
        return null;
      }
      const label = typeof record.unit_label === 'string'
        ? record.unit_label.trim()
        : typeof record.unitLabel === 'string'
          ? record.unitLabel.trim()
          : '';
      return {
        bhk: Math.round(bhk),
        unit_label: label || null,
        count: Math.round(count),
        price_min: asNumber(record.price_min ?? record.priceMin),
        price_max: asNumber(record.price_max ?? record.priceMax),
      };
    })
    .filter((row): row is UnitConfigurationRow => Boolean(row));
}

export function unitConfigurationsToFormRows(rows: UnitConfigurationRow[]): UnitConfigurationFormRow[] {
  if (rows.length === 0) {
    return [emptyUnitFormRow()];
  }
  return rows.map((row) => ({
    bhk: String(row.bhk),
    unit_label: row.unit_label || '',
    count: String(row.count),
    price_min: row.price_min != null ? String(row.price_min) : '',
    price_max: row.price_max != null ? String(row.price_max) : '',
  }));
}

export function serializeUnitConfigurations(rows: UnitConfigurationFormRow[]): UnitConfigurationRow[] {
  return rows
    .map((row) => {
      const bhk = Number(row.bhk);
      const count = Number(row.count);
      if (!Number.isFinite(bhk) || !Number.isFinite(count) || count < 1) {
        return null;
      }
      const priceMin = row.price_min.trim() ? Number(row.price_min) : null;
      const priceMax = row.price_max.trim() ? Number(row.price_max) : null;
      return {
        bhk: Math.round(bhk),
        unit_label: row.unit_label.trim() || null,
        count: Math.round(count),
        price_min: priceMin != null && Number.isFinite(priceMin) ? priceMin : null,
        price_max: priceMax != null && Number.isFinite(priceMax) ? priceMax : null,
      } satisfies UnitConfigurationRow;
    })
    .filter((row): row is UnitConfigurationRow => Boolean(row));
}

export function readSingleUnitMode(draftData?: Record<string, unknown> | null): boolean {
  if (!draftData || typeof draftData !== 'object') {
    return false;
  }
  return draftData.single_unit_mode === true || draftData.singleUnitMode === true;
}

export function propertyTypeUsesUnitConfig(propertyType: string): propertyType is PropertyTypeWithUnitConfig {
  const normalized = propertyType.trim().toLowerCase();
  return (PROPERTY_TYPES_WITH_UNIT_CONFIG as readonly string[]).includes(normalized);
}

export function hasValidUnitInventory(input: {
  propertyType: string;
  bedrooms: string;
  unitConfigurations: UnitConfigurationRow[];
  singleUnitMode: boolean;
}): boolean {
  if (input.singleUnitMode && input.bedrooms.trim()) {
    return true;
  }
  if (input.unitConfigurations.length > 0) {
    return input.unitConfigurations.some((row) => row.count >= 1);
  }
  if (!propertyTypeUsesUnitConfig(input.propertyType)) {
    return Boolean(input.bedrooms.trim());
  }
  return false;
}

export function deriveMaxBhkFromUnits(rows: UnitConfigurationRow[]): number | null {
  if (rows.length === 0) {
    return null;
  }
  return Math.max(...rows.map((row) => row.bhk));
}

export function formatUnitConfigurationsForKnowledge(rows: UnitConfigurationRow[], propertyType: string): string {
  if (rows.length === 0) {
    return '';
  }
  const lines = rows.map((row) => {
    const label = row.unit_label || `${row.bhk} BHK`;
    const price =
      row.price_min != null && row.price_max != null
        ? ` (₹${row.price_min.toLocaleString('en-IN')}–₹${row.price_max.toLocaleString('en-IN')})`
        : '';
    return `${row.count}× ${label}${price}`;
  });
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const typeLabel = propertyType.trim() || 'project';
  return `Unit mix (${typeLabel}, ${total} units total): ${lines.join('; ')}`;
}

export function parseUnitMixAnswer(answer: string): UnitConfigurationRow[] {
  const normalized = answer.toLowerCase();
  const presets: Record<string, Array<{ bhk: number; count: number }>> = {
    '2 bhk only': [{ bhk: 2, count: 1 }],
    '2 & 3 bhk': [
      { bhk: 2, count: 1 },
      { bhk: 3, count: 1 },
    ],
    '2, 3 & 4 bhk': [
      { bhk: 2, count: 1 },
      { bhk: 3, count: 1 },
      { bhk: 4, count: 1 },
    ],
  };

  for (const [key, rows] of Object.entries(presets)) {
    if (normalized.includes(key)) {
      return rows.map((row) => ({
        bhk: row.bhk,
        unit_label: null,
        count: row.count,
        price_min: null,
        price_max: null,
      }));
    }
  }

  const bhkMatches = [...answer.matchAll(/(\d)\s*bhk/gi)];
  if (bhkMatches.length > 0) {
    return bhkMatches.map((match) => ({
      bhk: Number(match[1]),
      unit_label: null,
      count: 1,
      price_min: null,
      price_max: null,
    }));
  }

  return [];
}
