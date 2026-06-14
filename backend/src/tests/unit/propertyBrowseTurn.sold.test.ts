import { resolvePropertyBrowseTurn } from '../../utils/propertyBrowseTurn.util';

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    property: { findMany: jest.fn(), findFirst: jest.fn() },
  },
}));

jest.mock('../../services/propertyKnowledge.service', () => ({
  matchCatalogPropertiesForQuery: jest.fn(async () => []),
  getInventorySummary: jest.fn(async () => ({ total: 0, upcoming: 0, byType: {} })),
}));

jest.mock('../../services/projectBrowse.service', () => ({
  companyUsesProjectBrowse: jest.fn(async () => false),
  listProjectsForBuyerBrowse: jest.fn(async () => []),
  formatProjectCatalogIntro: jest.fn(() => ''),
  buildProjectSelectListComponent: jest.fn(),
  getProjectInventorySummary: jest.fn(async () => ({ projectCount: 0, propertyCount: 0 })),
}));

jest.mock('../../services/companyInventoryBrowse.service', () => ({
  getCompanyBrowseSnapshot: jest.fn(async () => ({
    companyId: 'co-1',
    totalListings: 1,
    propertyTypes: ['apartment'],
    bedroomOptions: [2],
    filters: [],
    typeSummary: 'apartments',
  })),
  buildCatalogFilterButtonSet: jest.fn(() => []),
}));

jest.mock('../../services/buyerPropertyContext.service', () => ({
  findSoldPropertyMentionedByName: jest.fn(async () => ({
    id: 'prop-1101',
    name: 'Sunset Heights 1101',
    projectId: 'proj-sunset',
    status: 'sold',
  })),
}));

describe('resolvePropertyBrowseTurn sold unit', () => {
  test('property inquiry for sold unit returns explanation and view listings', async () => {
    const result = await resolvePropertyBrowseTurn({
      companyId: 'co-1',
      messageText: 'Tell me about 1101',
      stage: 'shortlist',
      leadLanguage: 'en',
    });
    expect(result?.reply).toMatch(/no longer available|sold/i);
    expect(result?.components[0]).toMatchObject({
      kind: 'buttons',
      buttons: expect.arrayContaining([
        expect.objectContaining({ id: 'project-properties-proj-sunset' }),
      ]),
    });
  });
});
