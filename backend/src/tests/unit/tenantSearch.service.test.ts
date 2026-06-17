/// <reference types="jest" />

const mockPrisma = {
  lead: { findMany: jest.fn() },
  property: { findMany: jest.fn() },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: { features: { tenantSearch: true } },
}));

import { tenantSearchService } from '../../dataPlatform/tenantSearch.service';

describe('TenantSearchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.lead.findMany.mockResolvedValue([
      { id: 'lead-1', customerName: 'Asha', phone: '+911111111111' },
    ]);
    mockPrisma.property.findMany.mockResolvedValue([
      { id: 'prop-1', name: 'Skyline Residency', locationCity: 'Pune', locationArea: 'Baner' },
    ]);
  });

  it('returns empty results when disabled', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      __esModule: true,
      default: { features: { tenantSearch: false } },
    }));
    const { tenantSearchService: disabledService } = await import('../../dataPlatform/tenantSearch.service');
    const results = await disabledService.search('co-1', 'Asha');
    expect(results).toEqual([]);
  });

  it('searches leads and properties within tenant', async () => {
    const results = await tenantSearchService.search('co-1', 'Asha');
    expect(results.some((r) => r.entity_type === 'lead')).toBe(true);
    expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: 'co-1' }) }),
    );
  });
});
