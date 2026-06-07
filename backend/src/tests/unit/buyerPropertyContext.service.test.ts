const mockPrisma = {
  property: { findMany: jest.fn() },
  conversation: { update: jest.fn() },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

import {
  inferBuyerPropertyContextFromOutbound,
  resolveBuyerPropertyReference,
} from '../../services/buyerPropertyContext.service';

describe('buyerPropertyContext.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
});
