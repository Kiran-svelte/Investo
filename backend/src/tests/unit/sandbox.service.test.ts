/// <reference types="jest" />

const mockPrisma = {
  sandboxTenant: {
    create: jest.fn(),
    findUnique: jest.fn(),
  },
  lead: {
    updateMany: jest.fn(),
  },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: { features: { sandboxTenants: true, sandboxNoRealPii: true } },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { sandboxService } from '../../enterpriseConfig/sandbox.service';

describe('SandboxService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.sandboxTenant.create.mockResolvedValue({
      id: 'sb-1',
      companyId: 'co-prod',
      sandboxCompanyId: 'co-sandbox',
      piiScrubbed: true,
    });
    mockPrisma.lead.updateMany.mockResolvedValue({ count: 3 });
  });

  it('creates sandbox mapping and scrubs PII when flag enabled', async () => {
    const sandbox = await sandboxService.createSandbox('co-prod', 'co-sandbox');
    expect(sandbox.sandboxCompanyId).toBe('co-sandbox');
    expect(mockPrisma.lead.updateMany).toHaveBeenCalled();
  });

  it('throws when feature disabled', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      __esModule: true,
      default: { features: { sandboxTenants: false, sandboxNoRealPii: false } },
    }));
    const { sandboxService: disabledService } = await import('../../enterpriseConfig/sandbox.service');
    await expect(disabledService.createSandbox('co-prod', 'co-sandbox')).rejects.toThrow(/disabled/);
  });
});
