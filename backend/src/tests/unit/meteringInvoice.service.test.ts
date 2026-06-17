/// <reference types="jest" />

const mockPrisma = {
  tenantUsageDaily: {
    findMany: jest.fn(),
  },
  usageInvoice: {
    upsert: jest.fn(),
    findMany: jest.fn(),
  },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: { features: { billingOps: true } },
}));

import { meteringInvoiceService } from '../../billingOps/meteringInvoice.service';

describe('MeteringInvoiceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.tenantUsageDaily.findMany.mockResolvedValue([
      {
        metrics: { ai_call_hour: 10, whatsapp_outbound_min: 4 },
      },
      {
        metrics: { ai_call_hour: 5 },
      },
    ]);
    mockPrisma.usageInvoice.upsert.mockResolvedValue({ id: 'inv-1', totalInr: '40.00' });
  });

  it('aggregates tenant usage into line items', async () => {
    const items = await meteringInvoiceService.aggregateUsage(
      'co-1',
      new Date('2026-06-01'),
      new Date('2026-06-30'),
    );
    expect(items.find((i) => i.dimension === 'ai_call_hour')?.quantity).toBe(15);
  });

  it('generates a draft invoice', async () => {
    const invoice = await meteringInvoiceService.generateInvoice(
      'co-1',
      new Date('2026-06-01'),
      new Date('2026-06-30'),
    );
    expect(invoice.id).toBe('inv-1');
    expect(mockPrisma.usageInvoice.upsert).toHaveBeenCalled();
  });
});
