import { normalizeExtractedUnits } from '../../services/propertyImportUnit.service';

describe('propertyImportUnit.service', () => {
  test('normalizes multi-villa extraction units', () => {
    const units = normalizeExtractedUnits(
      [
        { label: 'Villa A', name: 'Villa A', bedrooms: 3, price_min: 12000000 },
        { label: 'Villa B', name: 'Villa B', bedrooms: 4, price_min: 15000000 },
      ],
      { property_type: 'villa', location_city: 'Bengaluru' },
    );

    expect(units).toHaveLength(2);
    expect(units[0].label).toBe('Villa A');
    expect(units[0].unitData.location_city).toBe('Bengaluru');
    expect(units[1].unitData.bedrooms).toBe(4);
  });
});
