import {
  buildCatalogFilterButtonSet,
  buildDiscoveryButtonSet,
  browseFiltersToButtons,
  isFilterInCompanyInventory,
} from '../../services/companyInventoryBrowse.service';
import type { CompanyBrowseSnapshot } from '../../services/companyInventoryBrowse.service';

function snapshot(overrides: Partial<CompanyBrowseSnapshot> = {}): CompanyBrowseSnapshot {
  return {
    companyId: 'co-1',
    totalListings: 2,
    propertyTypes: ['apartment'],
    bedroomOptions: [2, 3],
    filters: [
      { id: 'filter-apartment', title: 'Apartments', filterKey: 'apartment' },
      { id: 'filter-2bhk', title: '2 BHK', filterKey: '2bhk' },
      { id: 'filter-3bhk', title: '3 BHK', filterKey: '3bhk' },
    ],
    typeSummary: 'apartments',
    ...overrides,
  };
}

describe('companyInventoryBrowse.service', () => {
  test('discovery buttons use only company filters plus call-me', () => {
    const buttons = buildDiscoveryButtonSet(snapshot());
    expect(buttons.map((b) => b.id)).toEqual(['filter-apartment', 'filter-2bhk', 'call-me']);
  });

  test('discovery buttons use Hindi filter titles when lang=hi', () => {
    const buttons = buildDiscoveryButtonSet(snapshot(), 'hi');
    expect(buttons[0].title).toBe('अपार्टमेंट');
    expect(buttons[1].title).toBe('2 BHK');
    expect(buttons[2].title).toBe('कॉल करें');
  });

  test('apartment-only company has no villa filter', () => {
    const buttons = buildDiscoveryButtonSet(snapshot({ propertyTypes: ['apartment'] }));
    const ids = buttons.map((b) => b.id);
    expect(ids).not.toContain('filter-villa');
    expect(ids).toContain('filter-apartment');
  });

  test('empty inventory returns call-me only', () => {
    const buttons = buildDiscoveryButtonSet(
      snapshot({ totalListings: 0, propertyTypes: [], bedroomOptions: [], filters: [], typeSummary: 'no active listings yet' }),
    );
    expect(buttons).toEqual([{ id: 'call-me', title: 'Call Me' }]);
  });

  test('catalog filter set allows up to three filters', () => {
    const buttons = buildCatalogFilterButtonSet(snapshot());
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.id)).toEqual(['filter-apartment', 'filter-2bhk', 'filter-3bhk']);
  });

  test('isFilterInCompanyInventory rejects types not listed', () => {
    const snap = snapshot();
    expect(isFilterInCompanyInventory(snap, 'apartment')).toBe(true);
    expect(isFilterInCompanyInventory(snap, 'villa')).toBe(false);
    expect(isFilterInCompanyInventory(snap, '2bhk')).toBe(true);
  });

  test('browseFiltersToButtons can add emoji for property types', () => {
    const buttons = browseFiltersToButtons(
      [{ id: 'filter-apartment', title: 'Apartments', filterKey: 'apartment' }],
      { withEmoji: true },
    );
    expect(buttons[0].title).toBe('🏢 Apartments');
  });
});
