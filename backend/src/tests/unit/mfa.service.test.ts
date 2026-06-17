/// <reference types="jest" />

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'JBSWY3DPEHPK3PXP'),
  generateURI: jest.fn(({ label, issuer, secret }: { label: string; issuer: string; secret: string }) =>
    `otpauth://totp/${issuer}:${label}?secret=${secret}`),
  generateSync: jest.fn(({ secret }: { secret: string }) => (secret === 'JBSWY3DPEHPK3PXP' ? '123456' : '000000')),
  verifySync: jest.fn(({ secret, token }: { secret: string; token: string }) => ({
    valid: secret === 'JBSWY3DPEHPK3PXP' && token === '123456',
  })),
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    features: { mfa: true },
    jwt: { secret: 'test-secret', expiresIn: '1h', refreshSecret: 'refresh', refreshExpiresIn: '7d' },
  },
}));

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
    userMfaDevice: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
  },
}));

jest.mock('../../utils/mfaCrypto.util', () => ({
  encryptMfaSecret: (value: string) => `enc:${value}`,
  decryptMfaSecret: (value: string) => value.replace(/^enc:/, ''),
}));

jest.mock('../../identity/identityConfig.service', () => ({
  getCompanyIdentityConfig: jest.fn().mockResolvedValue({ mfa_required: true }),
}));

jest.mock('../../services/auth.service', () => ({
  authService: {
    issueTokensForUser: jest.fn().mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: '1h',
    }),
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import prisma from '../../config/prisma';
import { MfaService } from '../../identity/mfa/mfa.service';

describe('mfa.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enrolls and verifies TOTP', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    (prisma as any).user.findUnique.mockResolvedValue({ id: 'u1', email: 'admin@acme.test' });
    (prisma as any).userMfaDevice.create.mockResolvedValue({ id: 'd1' });
    (prisma as any).userMfaDevice.findFirst.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      method: 'totp',
      secretEnc: `enc:${secret}`,
      verified: false,
    });
    (prisma as any).user.findUnique.mockResolvedValueOnce({ id: 'u1', email: 'admin@acme.test', companyId: 'c1' });

    const service = new MfaService();
    const enroll = await service.enrollTotp('u1');
    expect(enroll.device_id).toBe('d1');

    const code = '123456';
    const ok = await service.verifyTotpEnrollment('u1', 'd1', code);
    expect(ok).toBe(true);
  });

  it('rejects invalid TOTP codes', async () => {
    (prisma as any).userMfaDevice.findFirst.mockResolvedValue({
      id: 'd1',
      userId: 'u1',
      method: 'totp',
      secretEnc: 'enc:JBSWY3DPEHPK3PXP',
      verified: true,
    });

    const service = new MfaService();
    const ok = await service.verifyTotpLogin('u1', '000000');
    expect(ok).toBe(false);
  });
});
