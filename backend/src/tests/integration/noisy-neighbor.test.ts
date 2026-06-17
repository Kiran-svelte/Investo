/// <reference types="jest" />

const mockPrisma = {
  company: {
    findUnique: jest.fn(),
  },
  propertyImportJob: {
    count: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

const usageByCompany = new Map<string, number>();

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config/redis', () => ({
  cacheIncr: jest.fn(async (key: string) => {
    const next = (usageByCompany.get(key) || 0) + 1;
    usageByCompany.set(key, next);
    return next;
  }),
  cacheGet: jest.fn(async (key: string) => usageByCompany.get(key) ?? null),
  cacheSet: jest.fn(),
  cacheDel: jest.fn(),
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    features: {
      tenantQuotas: true,
      quotaHardEnforce: true,
    },
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { TenantQuotaService } from '../../services/tenantQuota.service';

describe('noisy neighbor isolation', () => {
  beforeEach(() => {
    usageByCompany.clear();
    jest.clearAllMocks();
    mockPrisma.propertyImportJob.count.mockResolvedValue(0);
    mockPrisma.auditLog.create.mockResolvedValue({});
  });

  it('tenant A exhaustion does not block tenant B on the same quota dimension', async () => {
    mockPrisma.company.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'tenant-a') {
        return {
          settings: { quota_tier: 'starter' },
          quotaOverride: { quotas: { ai_call_hour: 2 }, expiresAt: null },
        };
      }
      if (where.id === 'tenant-b') {
        return {
          settings: { quota_tier: 'starter' },
          quotaOverride: { quotas: { ai_call_hour: 2 }, expiresAt: null },
        };
      }
      return null;
    });

    const service = new TenantQuotaService();

    const a1 = await service.consume('tenant-a', 'ai_call_hour', 1);
    const a2 = await service.consume('tenant-a', 'ai_call_hour', 1);
    const a3 = await service.consume('tenant-a', 'ai_call_hour', 1);

    const b1 = await service.consume('tenant-b', 'ai_call_hour', 1);

    expect(a1.allowed).toBe(true);
    expect(a2.allowed).toBe(true);
    expect(a3.allowed).toBe(false);
    expect(b1.allowed).toBe(true);
  });

  it('tenant A API burst returns 429 only for tenant A counters', async () => {
    mockPrisma.company.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      settings: { quota_tier: 'starter' },
      quotaOverride: { quotas: { api_requests_min: 3 }, expiresAt: null },
    }));

    const service = new TenantQuotaService();

    expect((await service.consume('tenant-a', 'api_requests_min', 1)).allowed).toBe(true);
    expect((await service.consume('tenant-a', 'api_requests_min', 1)).allowed).toBe(true);
    expect((await service.consume('tenant-a', 'api_requests_min', 1)).allowed).toBe(true);
    expect((await service.consume('tenant-a', 'api_requests_min', 1)).allowed).toBe(false);
    expect((await service.consume('tenant-b', 'api_requests_min', 1)).allowed).toBe(true);
  });
});
