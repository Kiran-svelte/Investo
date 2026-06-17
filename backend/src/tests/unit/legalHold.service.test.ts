/// <reference types="jest" />

const mockPrisma = {
  legalHold: {
    create: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: { features: { complianceLegalHold: true } },
}));

import { legalHoldService } from '../../compliance/legalHold.service';

describe('LegalHoldService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.legalHold.create.mockResolvedValue({ id: 'hold-1' });
    mockPrisma.legalHold.count.mockResolvedValue(1);
    mockPrisma.legalHold.findMany.mockResolvedValue([{ id: 'hold-1' }]);
  });

  it('places a legal hold', async () => {
    const hold = await legalHoldService.placeHold({
      companyId: 'co-1',
      entityType: 'lead',
      entityId: 'lead-1',
      reason: 'Litigation',
      placedBy: 'admin-1',
    });
    expect(hold.id).toBe('hold-1');
  });

  it('detects active hold on entity', async () => {
    const onHold = await legalHoldService.isEntityOnHold('co-1', 'lead', 'lead-1');
    expect(onHold).toBe(true);
  });

  it('returns false when feature disabled', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      __esModule: true,
      default: { features: { complianceLegalHold: false } },
    }));
    const { legalHoldService: disabledService } = await import('../../compliance/legalHold.service');
    const onHold = await disabledService.isEntityOnHold('co-1', 'lead', 'lead-1');
    expect(onHold).toBe(false);
  });
});
