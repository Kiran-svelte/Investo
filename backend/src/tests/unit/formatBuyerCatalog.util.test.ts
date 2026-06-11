import {
  dedupeCatalogMatches,
  formatBuyerCatalogEmpty,
  formatBuyerCatalogMatches,
  formatInventoryCountReply,
  isInventoryCountQuery,
  isPropertyTypeBrowseQuery,
} from '../../utils/formatBuyerCatalog.util';
import {
  matchCatalogPropertiesForQuery,
  parseBedroomsFromQuery,
} from '../../services/propertyKnowledge.service';

describe('formatBuyerCatalog.util', () => {
  test('isInventoryCountQuery detects ongoing projects question', () => {
    expect(isInventoryCountQuery('How many projects are there ongoing')).toBe(true);
  });

  test('isPropertyTypeBrowseQuery detects villa question', () => {
    expect(isPropertyTypeBrowseQuery('Do you guys have villa ?')).toBe(true);
  });

  test('formatBuyerCatalogEmpty for 4bhk mentions BHK', () => {
    expect(formatBuyerCatalogEmpty('Any 4bhk properties ?')).toMatch(/4 BHK/i);
  });

  test('formatInventoryCountReply summarizes by type', () => {
    const text = formatInventoryCountReply({
      total: 3,
      upcoming: 1,
      byType: { apartment: 2, villa: 1 },
    });
    expect(text).toMatch(/3.*active project/i);
    expect(text).toMatch(/2.*apartment/i);
    expect(text).toMatch(/1.*villa/i);
  });

  test('formatBuyerCatalogMatches single property is conversational', () => {
    const text = formatBuyerCatalogMatches([{
      id: 'p1',
      name: 'Lake Vista',
      propertyType: 'villa',
      locationCity: null,
      locationArea: null,
      brochureUrl: 'aws://x.pdf',
      status: 'available',
      bedrooms: 4,
      priceMin: 8500000,
      priceMax: 12000000,
    }]);
    expect(text).toMatch(/Lake Vista/i);
    expect(text).toMatch(/villa/i);
    expect(text).not.toMatch(/ID:/i);
    expect(text).not.toMatch(/Match score/i);
  });

  test('dedupeCatalogMatches removes duplicate ids and names', () => {
    const rows = [
      { id: 'a', name: 'Lake Vista' },
      { id: 'b', name: 'Lake Vista' },
      { id: 'a', name: 'Lake Vista' },
    ];
    expect(dedupeCatalogMatches(rows)).toHaveLength(1);
  });
});

describe('matchCatalogPropertiesForQuery bedrooms', () => {
  test('parseBedroomsFromQuery extracts 4 from 4bhk', () => {
    expect(parseBedroomsFromQuery('Any 4bhk properties ?')).toBe(4);
  });
});

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    property: {
      findMany: jest.fn(),
    },
  },
}));

import prisma from '../../config/prisma';

describe('matchCatalogPropertiesForQuery integration', () => {
  beforeEach(() => jest.clearAllMocks());

  test('filters by villa type for do you have villa', async () => {
    (prisma.property.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'v1',
        name: 'Lake Vista',
        propertyType: 'villa',
        locationCity: 'Pune',
        locationArea: 'Baner',
        brochureUrl: null,
        status: 'available',
        bedrooms: 4,
        priceMin: 9000000,
        priceMax: 11000000,
        description: 'Lake facing',
      },
      {
        id: 'a1',
        name: 'Sunset Heights',
        propertyType: 'apartment',
        locationCity: 'Pune',
        locationArea: 'Kharadi',
        brochureUrl: null,
        status: 'available',
        bedrooms: 3,
        priceMin: 6000000,
        priceMax: 8000000,
        description: '',
      },
    ]);

    const matches = await matchCatalogPropertiesForQuery({
      companyId: 'co-1',
      query: 'Do you guys have villa ?',
      limit: 5,
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].name).toBe('Lake Vista');
  });
});
