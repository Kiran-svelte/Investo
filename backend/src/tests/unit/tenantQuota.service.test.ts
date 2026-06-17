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

const mockCache = {
  incr: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config/redis', () => ({
  cacheIncr: (...args: unknown[]) => mockCache.incr(...args),
  cacheGet: (...args: unknown[]) => mockCache.get(...args),
  cacheSet: (...args: unknown[]) => mockCache.set(...args),
  cacheDel: (...args: unknown[]) => mockCache.del(...args),
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

describe('TenantQuotaService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.company.findUnique.mockResolvedValue({
      settings: { quota_tier: 'starter' },
      quotaOverride: null,
    });
    mockPrisma.propertyImportJob.count.mockResolvedValue(0);
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockCache.get.mockResolvedValue(null);
    mockCache.incr.mockImplementation(async () => 1);
  });

  it('allows usage below the starter plan limit', async () => {
    const service = new TenantQuotaService();
    const result = await service.check('company-a', 'ai_call_hour', 1);

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(100);
    expect(result.remaining).toBe(100);
  });

  it('denies at the boundary when hard enforcement is enabled', async () => {
    mockCache.get.mockResolvedValue(100);
    const service = new TenantQuotaService();

    const result = await service.check('company-a', 'ai_call_hour', 1);

    expect(result.allowed).toBe(false);
    expect(result.used).toBe(100);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('writes quota_exceeded audit rows on hard deny consume', async () => {
    mockCache.get.mockResolvedValue(100);
    const service = new TenantQuotaService();

    const result = await service.consume('company-a', 'api_requests_min', 1);

    expect(result.allowed).toBe(false);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 'company-a',
        action: 'quota_exceeded',
        resourceType: 'tenant_quota',
      }),
    });
  });

  it('merges super-admin quota overrides onto plan defaults', async () => {
    mockPrisma.company.findUnique.mockResolvedValueOnce({
      settings: { quota_tier: 'starter' },
      quotaOverride: {
        quotas: { ai_call_hour: 5 },
        expiresAt: null,
      },
    });

    const service = new TenantQuotaService();
    const limits = await service.getEffectiveLimits('company-a');

    expect(limits.ai_call_hour).toBe(5);
    expect(limits.whatsapp_outbound_min).toBe(20);
  });
});
