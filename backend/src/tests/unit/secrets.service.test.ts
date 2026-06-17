/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    env: 'test',
    features: { secretsVault: false },
  },
}));

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    secretRotationLog: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

import { secretsService } from '../../services/secrets.service';

describe('secrets.service', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, JWT_SECRET: 'from-env' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('falls back to environment secrets in dev/test', () => {
    expect(secretsService.getSecret('JWT_SECRET')).toBe('from-env');
  });

  it('reports self-check status', () => {
    const checks = secretsService.selfCheck();
    expect(checks.some((item) => item.name === 'JWT_SECRET' && item.present)).toBe(true);
  });
});
