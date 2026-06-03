import { describe, expect, it } from 'vitest';
import {
  hasValidUnitInventory,
  parseUnitConfigurations,
  parseUnitMixAnswer,
  serializeUnitConfigurations,
} from './propertyImportUnitConfig';

describe('propertyImportUnitConfig', () => {
  it('parses and serializes unit rows', () => {
    const parsed = parseUnitConfigurations({
      unit_configurations: [
        { bhk: 3, count: 12, unit_label: 'Corner', price_min: 9000000, price_max: 11000000 },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].bhk).toBe(3);

    const serialized = serializeUnitConfigurations([
      { bhk: '3', count: '12', unit_label: 'Corner', price_min: '9000000', price_max: '11000000' },
    ]);
    expect(serialized[0].count).toBe(12);
  });

  it('validates inventory for multi-unit projects', () => {
    expect(hasValidUnitInventory({
      propertyType: 'apartment',
      bedrooms: '',
      unitConfigurations: [{ bhk: 2, count: 5, unit_label: null, price_min: null, price_max: null }],
      singleUnitMode: false,
    })).toBe(true);

    expect(hasValidUnitInventory({
      propertyType: 'apartment',
      bedrooms: '3',
      unitConfigurations: [],
      singleUnitMode: true,
    })).toBe(true);
  });

  it('parses unit mix wizard answers', () => {
    const rows = parseUnitMixAnswer('2 & 3 BHK');
    expect(rows.map((r) => r.bhk).sort()).toEqual([2, 3]);
  });
});
