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
    register: jest.fn().mockResolvedValue({ id: 'new-user-1', email: 'new@example.com', role: 'operations' }),
  };

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: {},
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

  jest.doMock('../../services/auth.service', () => ({
    __esModule: true,
    authService: mockAuthService,
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

  let userRoutes: any;
  jest.isolateModules(() => {
    userRoutes = require('../../routes/user.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/users', userRoutes);
  return { app, mockAuthService };
}

describe('POST /api/users must_change_password', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('passes must_change_password through to authService.register', async () => {
    const { app, mockAuthService } = createUserApp('company_admin');

    const response = await request(app)
      .post('/api/users')
      .send({
        name: 'Ops User',
        email: 'ops@example.com',
        password: 'Password123',
        phone: null,
        role: 'operations',
        must_change_password: true,
      });

    expect(response.status).toBe(201);
    expect(mockAuthService.register).toHaveBeenCalledTimes(1);

    expect(mockAuthService.register).toHaveBeenCalledWith({
      name: 'Ops User',
      email: 'ops@example.com',
      password: 'Password123',
      phone: null,
      role: 'operations',
      company_id: 'company-1',
      must_change_password: true,
    });
  });
});
