const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
  company: {
    findFirst: jest.fn(),
  },
  refreshToken: {
    findMany: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
} as any;

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    jwt: {
      secret: 'access-secret',
      expiresIn: '24h',
      refreshSecret: 'refresh-secret',
      refreshExpiresIn: '7d',
    },
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('bcrypt', () => ({
  __esModule: true,
  default: {
    hash: jest.fn(),
    compare: jest.fn(),
  },
}));

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: jest.fn(),
    verify: jest.fn(),
  },
}));

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { authService } from '../../services/auth.service';

const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;
const mockJwt = jwt as jest.Mocked<typeof jwt>;

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma.user.update.mockResolvedValue({} as never);
    mockPrisma.user.create.mockResolvedValue({} as never);
    mockPrisma.company.findFirst.mockResolvedValue({ id: 'company-1', status: 'active' });
    mockPrisma.refreshToken.update.mockResolvedValue({} as never);
    mockPrisma.refreshToken.create.mockResolvedValue({} as never);
    mockBcrypt.hash.mockResolvedValue('hashed-refresh-token' as never);
    mockBcrypt.compare.mockResolvedValue(true as never);
    mockJwt.sign.mockReturnValueOnce('access-token' as never).mockReturnValueOnce('refresh-token' as never);
    mockJwt.verify.mockReturnValue({ userId: 'user-1', type: 'refresh' } as never);
  });

  test('normalizes email casing before login lookup', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      companyId: 'company-1',
      email: 'test@example.com',
      role: 'super_admin',
      name: 'Test User',
      passwordHash: 'password-hash',
      status: 'active',
    });

    const tokens = await authService.login('  TEST@Example.com  ', 'password123');

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: 'test@example.com', status: 'active' },
    });
    expect(tokens).toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresIn: '24h',
    });
  });

  test('rejects refresh tokens that do not match an active stored hash exactly', async () => {
    mockPrisma.refreshToken.findMany.mockResolvedValue([
      {
        id: 'token-1',
        tokenHash: 'different-token-hash',
      },
    ]);

    mockBcrypt.compare.mockResolvedValue(false as never);

    await expect(authService.refreshToken('presented-refresh-token')).rejects.toThrow(
      'Refresh token not found or revoked',
    );

    expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
  });

  test('rotates the exact matching refresh token when multiple active tokens exist', async () => {
    mockPrisma.refreshToken.findMany.mockResolvedValue([
      {
        id: 'token-1',
        tokenHash: 'stale-hash',
      },
      {
        id: 'token-2',
        tokenHash: 'matching-hash',
      },
    ]);

    mockBcrypt.compare.mockImplementation(async (_presentedToken, candidateHash) => candidateHash === 'matching-hash');
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      companyId: 'company-1',
      email: 'test@example.com',
      role: 'super_admin',
      name: 'Test User',
      passwordHash: 'password-hash',
      status: 'active',
    });
    mockJwt.sign.mockReset();
    mockJwt.sign
      .mockReturnValueOnce('new-access-token' as never)
      .mockReturnValueOnce('new-refresh-token' as never);

    const tokens = await authService.refreshToken('presented-refresh-token');

    expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'token-2' },
      data: { revoked: true },
    });
    expect(tokens).toEqual({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresIn: '24h',
    });
  });
});