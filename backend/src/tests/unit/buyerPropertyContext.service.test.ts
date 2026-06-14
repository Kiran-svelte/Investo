const mockPrisma = {
  property: { findMany: jest.fn(), findFirst: jest.fn() },
  conversation: { update: jest.fn() },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import config from '../../config';
import {
  buildPropertyAmbiguityClarifyReply,
  inferBuyerPropertyContextFromOutbound,
  resolveBuyerPropertyReference,
  resolveBuyerPropertyReferenceEnterprise,
} from '../../services/buyerPropertyContext.service';

describe('buyerPropertyContext.service', () => {
  const originalFlag = config.features.scopedPropertyResolve;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.property.findMany.mockReset();
    mockPrisma.property.findMany.mockResolvedValue([]);
    mockPrisma.property.findFirst.mockReset();
    config.features.scopedPropertyResolve = false;
  });

  afterAll(() => {
    config.features.scopedPropertyResolve = originalFlag;
  });

  test('infers shortlist order from property names in outbound text', () => {
    const patch = inferBuyerPropertyContextFromOutbound({
      outboundText: [
        '1. Green Acres has plots.',
        '2. Sunset Heights has apartments.',
        '3. Lake Vista has lake-facing units.',
        '4. Commercial Hub has office space.',
      ].join('\n'),
      properties: [
        { id: 'green', name: 'Green Acres' },
        { id: 'sunset', name: 'Sunset Heights' },
        { id: 'lake', name: 'Lake Vista' },
        { id: 'commercial', name: 'Commercial Hub' },
      ],
    });

    expect(patch).toEqual({
      recommendedPropertyIds: ['green', 'sunset', 'lake', 'commercial'],
      selectedPropertyId: null,
    });
  });

  test('resolves numbered follow-up against recommended property ids', async () => {
    mockPrisma.property.findMany.mockResolvedValue([]);

    const propertyId = await resolveBuyerPropertyReference({
      companyId: 'company-1',
      messageText: 'Need more details on 4',
      selectedPropertyId: 'stale-selected',
      recommendedPropertyIds: ['green', 'sunset', 'lake', 'commercial'],
    });

    expect(propertyId).toBe('commercial');
  });

  test('does not treat visit times as property ordinals', async () => {
    mockPrisma.property.findMany.mockResolvedValue([]);

    const propertyId = await resolveBuyerPropertyReference({
      companyId: 'company-1',
      messageText: 'Tomorrow at 5pm',
      selectedPropertyId: 'current-project',
      recommendedPropertyIds: ['green', 'sunset', 'lake', 'commercial'],
    });

    expect(propertyId).toBe('current-project');
  });

  test('explicit project name overrides stale selected property', async () => {
    mockPrisma.property.findMany.mockResolvedValue([
      { id: 'sunset', name: 'Sunset Heights' },
      { id: 'commercial', name: 'Commercial Hub' },
    ]);

    const propertyId = await resolveBuyerPropertyReference({
      companyId: 'company-1',
      messageText: 'I want to book visit for Commercial Hub',
      selectedPropertyId: 'sunset',
      recommendedPropertyIds: ['sunset'],
    });

    expect(propertyId).toBe('commercial');
  });

  describe('scoped property resolve (flag ON)', () => {
    beforeEach(() => {
      config.features.scopedPropertyResolve = true;
    });

    test('scoped project returns unique unit match in project', async () => {
      mockPrisma.property.findMany.mockImplementation(({ where }: { where: { projectId?: string } }) => {
        if (where.projectId === 'project-sunset') {
          return Promise.resolve([{ id: 'sunset-1102', name: 'Sunset Heights 1102', projectId: 'project-sunset' }]);
        }
        return Promise.resolve([]);
      });

      const propertyId = await resolveBuyerPropertyReference({
        companyId: 'company-1',
        messageText: 'Tell me about 1102',
        scopedProjectId: 'project-sunset',
        selectedPropertyId: 'stale',
      });

      expect(propertyId).toBe('sunset-1102');
    });

    test('shared unit number across projects returns ambiguity', async () => {
      mockPrisma.property.findMany.mockImplementation(({ where }: {
        where: { status?: { in?: string[] } | string };
      }) => {
        const status = where.status;
        const isSoldQuery = status === 'sold'
          || (typeof status === 'object' && status?.in?.includes('sold'));
        if (isSoldQuery) return Promise.resolve([]);
        return Promise.resolve([
          { id: 'sunset-1102', name: 'Sunset Heights 1102', projectId: 'project-sunset' },
          { id: 'lake-1102', name: 'Lake Heights 1102', projectId: 'project-lake' },
        ]);
      });

      const result = await resolveBuyerPropertyReferenceEnterprise({
        companyId: 'company-1',
        messageText: '1102',
        strictMultiMatch: true,
      });

      expect(result.availablePropertyId).toBeNull();
      expect(result.ambiguousMatches).toHaveLength(2);
    });

    test('explicit full name resolves even with stale selectedPropertyId', async () => {
      mockPrisma.property.findMany.mockResolvedValue([
        { id: 'lake-304', name: 'Lake Vista 304', projectId: 'project-lake' },
        { id: 'sunset-304', name: 'Sunset Vista 304', projectId: 'project-sunset' },
      ]);
      mockPrisma.property.findFirst.mockResolvedValue({ projectId: 'project-lake' });

      const propertyId = await resolveBuyerPropertyReference({
        companyId: 'company-1',
        messageText: 'Book visit for Lake Vista 304',
        selectedPropertyId: 'sunset-304',
        scopedProjectId: 'project-sunset',
        strictMultiMatch: true,
      });

      expect(propertyId).toBe('lake-304');
    });

    test('buildPropertyAmbiguityClarifyReply formats numbered list', () => {
      const reply = buildPropertyAmbiguityClarifyReply([
        { name: 'Sunset Heights 1102' },
        { name: 'Lake Heights 1102' },
      ]);
      expect(reply).toContain('1. Sunset Heights 1102');
      expect(reply).toContain('2. Lake Heights 1102');
      expect(reply).toContain('Which one do you mean?');
    });
  });
});
