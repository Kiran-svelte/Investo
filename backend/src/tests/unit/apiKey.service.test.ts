/// <reference types="jest" />

const mockPrisma = {
  apiKey: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: { features: { publicApi: true } },
}));

import { apiKeyService } from '../../publicApi/apiKey.service';

describe('ApiKeyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.apiKey.create.mockImplementation(async (args: any) => ({
      id: 'key-1',
      ...args.data,
    }));
    mockPrisma.apiKey.findMany.mockResolvedValue([]);
    mockPrisma.apiKey.update.mockResolvedValue({});
  });

  it('creates an API key and returns raw key once', async () => {
    const created = await apiKeyService.createKey({
      companyId: 'co-1',
      name: 'Zoho',
      scopes: ['leads:read'],
      createdBy: 'admin-1',
    });
    expect(created.rawKey).toMatch(/^inv_live_/);
    expect(created.apiKey.keyPrefix).toBeTruthy();
  });

  it('validates a freshly created key', async () => {
    const created = await apiKeyService.createKey({
      companyId: 'co-1',
      name: 'Test',
      scopes: ['*'],
      createdBy: 'admin-1',
    });

    mockPrisma.apiKey.findMany.mockResolvedValue([
      {
        id: 'key-1',
        companyId: 'co-1',
        keyHash: created.apiKey.keyHash,
        scopes: ['*'],
        revokedAt: null,
        expiresAt: null,
      },
    ]);

    const validated = await apiKeyService.validateKey(created.rawKey);
    expect(validated?.companyId).toBe('co-1');
  });
});
