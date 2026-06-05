/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

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

function createAuthRoutesApp(options?: { signupEnabled?: boolean }): {
  app: Express;
  mockAuthService: { login: jest.Mock };
  mockPrisma: { user: { findFirst: jest.Mock } };
} {
  jest.resetModules();
  restoreEnv();
  process.env.NODE_ENV = 'test';

  if (options?.signupEnabled) {
    process.env.SELF_SERVICE_SIGNUP_ENABLED = 'true';
  } else {
    delete process.env.SELF_SERVICE_SIGNUP_ENABLED;
  }

  const mockAuthService = {
    login: jest.fn(),
    refreshToken: jest.fn(),
    logout: jest.fn(),
  };

  const mockPrisma = {
    user: { findFirst: jest.fn() },
  };

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: mockPrisma,
  }));

  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  }));

  jest.doMock('../../services/auth.service', () => ({
    __esModule: true,
    normalizeAuthEmail: (email: string): string => email.trim().toLowerCase(),
    authService: mockAuthService,
  }));

  jest.doMock('../../services/email.service', () => ({
    __esModule: true,
    emailService: { sendPasswordResetEmail: jest.fn() },
  }));

  jest.doMock('../../services/selfServiceSignup.service', () => ({
    __esModule: true,
    registerSelfServiceTenant: jest.fn(),
  }));

  jest.doMock('bcrypt', () => ({
    __esModule: true,
    default: { hash: jest.fn(), compare: jest.fn() },
  }));

  let router: any;
  jest.isolateModules(() => {
    router = require('../../routes/auth.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', router);

  return { app, mockAuthService, mockPrisma };
}

describe('auth routes', () => {
  afterEach(() => {
    restoreEnv();
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('GET /api/auth/signup-enabled returns feature flag', async () => {
    const { app } = createAuthRoutesApp({ signupEnabled: true });
    const response = await request(app).get('/api/auth/signup-enabled');

    expect(response.status).toBe(200);
    expect(response.body.data.enabled).toBe(true);
  });

  test('POST /api/auth/login returns tokens on success', async () => {
    const { app, mockAuthService, mockPrisma } = createAuthRoutesApp();

    mockAuthService.login.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      companyId: 'company-1',
      email: 'admin@investo.in',
      role: 'company_admin',
      name: 'Admin',
      mustChangePassword: false,
    });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@investo.in', password: 'secret123' });

    expect(response.status).toBe(200);
    expect(response.body.data.tokens.access_token).toBe('access-token');
    expect(response.body.data.user.role).toBe('company_admin');
    expect(mockAuthService.login).toHaveBeenCalledWith('admin@investo.in', 'secret123');
  });

  test('POST /api/auth/login rejects invalid credentials', async () => {
    const { app, mockAuthService } = createAuthRoutesApp();
    mockAuthService.login.mockRejectedValue(new Error('Invalid credentials'));

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bad@example.com', password: 'wrong' });

    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/invalid credentials/i);
  });

  test('POST /api/auth/login validates required fields', async () => {
    const { app } = createAuthRoutesApp();
    const response = await request(app).post('/api/auth/login').send({ email: 'only@example.com' });

    expect(response.status).toBe(400);
  });
});
