/// <reference types="jest" />

import express, { Express, RequestHandler } from 'express';
import request from 'supertest';

type MockAuthService = {
  register: jest.Mock;
};

function noopMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

function createUserApp(userRole: string = 'company_admin'): { app: Express; mockAuthService: MockAuthService } {
  jest.resetModules();

  const mockAuthService: MockAuthService = {
    register: jest.fn().mockResolvedValue({ id: 'new-user-1', email: 'new@example.com', role: 'sales_agent' }),
  };

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: {
      company: {
        findFirst: jest.fn().mockResolvedValue({
          plan: { maxAgents: 10 },
        }),
        findUnique: jest.fn().mockResolvedValue({ name: 'Test Co' }),
      },
      user: {
        count: jest.fn().mockResolvedValue(1),
      },
    },
  }));

  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  }));

  jest.doMock('../../config', () => ({
    __esModule: true,
    default: {
      frontend: { baseUrl: 'http://localhost:4173' },
    },
  }));

  jest.doMock('../../services/auth.service', () => ({
    __esModule: true,
    authService: mockAuthService,
  }));

  jest.doMock('../../services/email.service', () => ({
    __esModule: true,
    emailService: {
      sendWelcomeInviteEmail: jest.fn().mockResolvedValue({ sent: true }),
    },
  }));

  jest.doMock('../../middleware/auth', () => ({
    __esModule: true,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'user-1',
        company_id: 'company-1',
        companyId: 'company-1',
        role: userRole,
        email: 'admin@investo.in',
        name: 'Admin',
      };
      next();
    },
  }));

  jest.doMock('../../middleware/tenant', () => ({
    __esModule: true,
    tenantIsolation: (req: any, _res: any, next: any) => {
      req.companyId = req.user.company_id;
      next();
    },
    strictTenantIsolation: (req: any, _res: any, next: any) => {
      req.companyId = req.user.company_id;
      next();
    },
    getCompanyId: (req: any) => req.companyId,
  }));

  jest.doMock('../../middleware/rbac', () => ({
    __esModule: true,
    authorize: () => noopMiddleware(),
    hasRole: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/audit', () => ({
    __esModule: true,
    auditLog: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/featureGate', () => ({
    __esModule: true,
    requireFeature: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/subscriptionEnforcement', () => ({
    __esModule: true,
    requireActivePaidSubscription: noopMiddleware(),
  }));

  jest.doMock('../../identity/org/branchScope.service', () => ({
    __esModule: true,
    isOrgBranchesEnabled: () => false,
    assertBranchBelongsToCompany: jest.fn(),
  }));

  let userRoutes: any;
  jest.isolateModules(() => {
    userRoutes = require('../../routes/user.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/users', userRoutes);
  return { app, mockAuthService };
}

describe('POST /api/users invite edge cases', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('returns 409 when email is already registered', async () => {
    const { app, mockAuthService } = createUserApp('company_admin');
    mockAuthService.register.mockRejectedValueOnce(new Error('Email already registered'));

    const response = await request(app)
      .post('/api/users')
      .send({
        name: 'Duplicate User',
        email: 'dup@example.com',
        password: 'Password123',
        role: 'viewer',
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/email already registered/i);
  }, 20_000);

  test('rejects invalid email format before hitting auth service', async () => {
    const { app, mockAuthService } = createUserApp('company_admin');

    const response = await request(app)
      .post('/api/users')
      .send({
        name: 'Bad Email',
        email: 'not-an-email',
        password: 'Password123',
        phone: '+919876543210',
        role: 'sales_agent',
      });

    expect(response.status).toBe(400);
    expect(mockAuthService.register).not.toHaveBeenCalled();
  });

  test('register is only invoked once per accepted request', async () => {
    const { app, mockAuthService } = createUserApp('company_admin');

    const payload = {
      name: 'Once User',
      email: 'once@example.com',
      password: 'Password123',
      phone: '+919876543210',
      role: 'sales_agent',
    };

    const response = await request(app).post('/api/users').send(payload);

    expect(response.status).toBe(201);
    expect(mockAuthService.register).toHaveBeenCalledTimes(1);
  });
});
