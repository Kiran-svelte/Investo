/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

type MockPrisma = {
  user: {
    findUnique: jest.Mock;
  };
  passwordResetToken: {
    updateMany: jest.Mock;
    create: jest.Mock;
  };
};

type MockLogger = {
  info: jest.Mock;
  error: jest.Mock;
  warn: jest.Mock;
  debug: jest.Mock;
};

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function createAuthTestApp(frontendBaseUrl?: string): {
  app: Express;
  mockPrisma: MockPrisma;
  mockLogger: MockLogger;
} {
  jest.resetModules();
  restoreEnv();

  process.env.NODE_ENV = 'development';
  if (frontendBaseUrl === undefined) {
    delete process.env.FRONTEND_BASE_URL;
  } else {
    process.env.FRONTEND_BASE_URL = frontendBaseUrl;
  }

  const mockPrisma: MockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
    passwordResetToken: {
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockLogger: MockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: mockPrisma,
  }));

  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: mockLogger,
  }));

  jest.doMock('../../services/auth.service', () => ({
    __esModule: true,
    normalizeAuthEmail: (email: string): string => email.trim().toLowerCase(),
    authService: {
      login: jest.fn(),
      refreshToken: jest.fn(),
      logout: jest.fn(),
    },
  }));

  jest.doMock('bcrypt', () => ({
    __esModule: true,
    default: {
      hash: jest.fn().mockResolvedValue('hashed-reset-token'),
      compare: jest.fn(),
    },
  }));

  let router: any;
  jest.isolateModules(() => {
    router = require('../../routes/auth.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', router);

  return { app, mockPrisma, mockLogger };
}

describe('Auth forgot-password reset URL generation', () => {
  afterEach(() => {
    restoreEnv();
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('uses FRONTEND_BASE_URL and ignores request Origin header', async () => {
    const { app, mockPrisma } = createAuthTestApp('https://app.investo.ai/');

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      status: 'active',
    });
    mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.passwordResetToken.create.mockResolvedValue({ id: 'prt-1' });

    const response = await request(app)
      .post('/api/auth/forgot-password')
      .set('Origin', 'https://evil.example')
      .send({ email: '  USER@EXAMPLE.COM  ' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(typeof response.body.data?.resetUrl).toBe('string');

    const resetUrl = response.body.data.resetUrl as string;
    const parsed = new URL(resetUrl);

    expect(parsed.origin).toBe('https://app.investo.ai');
    expect(parsed.pathname).toBe('/reset-password');
    expect(parsed.searchParams.get('email')).toBe('user@example.com');
    expect(resetUrl).not.toContain('evil.example');

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
      select: { id: true, email: true, name: true, status: true },
    });
  });

  test('falls back to localhost frontend URL when FRONTEND_BASE_URL is absent', async () => {
    const { app, mockPrisma } = createAuthTestApp(undefined);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'fallback@example.com',
      name: 'Fallback User',
      status: 'active',
    });
    mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.passwordResetToken.create.mockResolvedValue({ id: 'prt-2' });

    const response = await request(app)
      .post('/api/auth/forgot-password')
      .set('Origin', 'https://attacker.example')
      .send({ email: 'fallback@example.com' });

    expect(response.status).toBe(200);

    const resetUrl = response.body.data.resetUrl as string;
    const parsed = new URL(resetUrl);

    expect(parsed.origin).toBe('http://localhost:3000');
    expect(parsed.pathname).toBe('/reset-password');
    expect(parsed.searchParams.get('email')).toBe('fallback@example.com');
    expect(resetUrl).not.toContain('attacker.example');
  });
});
