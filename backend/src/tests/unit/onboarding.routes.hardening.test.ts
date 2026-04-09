/// <reference types="jest" />

import express, { Express, RequestHandler } from 'express';
import request from 'supertest';

jest.setTimeout(30000);

type OnboardingState = {
  companyProfile?: boolean;
  rolesConfigured?: boolean;
  featuresSelected?: boolean;
  aiConfigured?: boolean;
  teamInvited?: boolean;
};

type MockPrisma = {
  companyOnboarding: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  companyRole: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
};

function noopMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

function createOnboardingApp(role: string, onboardingState: OnboardingState): { app: Express; mockPrisma: MockPrisma } {
  jest.resetModules();

  const mockPrisma: MockPrisma = {
    companyOnboarding: {
      findUnique: jest.fn().mockResolvedValue({ companyId: 'company-1', ...onboardingState }),
      upsert: jest.fn().mockResolvedValue({ companyId: 'company-1', stepCompleted: 6 }),
    },
    companyRole: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: `role-${data.roleName}`, ...data })),
    },
  };

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: mockPrisma,
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

  jest.doMock('../../middleware/auth', () => ({
    __esModule: true,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'user-1',
        company_id: 'company-1',
        companyId: 'company-1',
        role,
        email: 'user@investo.in',
        name: 'User',
      };
      next();
    },
  }));

  jest.doMock('../../middleware/tenant', () => ({
    __esModule: true,
    tenantIsolation: noopMiddleware(),
    getCompanyId: () => 'company-1',
  }));

  jest.doMock('../../models/validation', () => ({
    __esModule: true,
    ROLES: ['super_admin', 'company_admin', 'sales_agent', 'operations', 'viewer'],
    normalizeIndianPhoneNumber: jest.fn((value: string) => value),
    isIndianE164Phone: jest.fn(() => true),
  }));

  jest.doMock('../../services/auth.service', () => ({
    __esModule: true,
    authService: {
      register: jest.fn(),
    },
    normalizeAuthEmail: (email: string) => email.toLowerCase(),
  }));

  let onboardingRouter: any;
  jest.isolateModules(() => {
    onboardingRouter = require('../../routes/onboarding.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/onboarding', onboardingRouter);

  return { app, mockPrisma };
}

describe('onboarding route hardening', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('rejects onboarding mutation for non-admin roles', async () => {
    const { app } = createOnboardingApp('sales_agent', {
      companyProfile: true,
      rolesConfigured: true,
      featuresSelected: true,
      aiConfigured: true,
      teamInvited: true,
    });

    const response = await request(app).post('/api/onboarding/features').send({
      features: [{ key: 'property_management', enabled: true }],
    });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Insufficient role');
  });

  test('rejects custom role payload that attempts to override system roles', async () => {
    const { app } = createOnboardingApp('company_admin', {
      companyProfile: true,
    });

    const response = await request(app).post('/api/onboarding/roles').send({
      roles: [
        {
          role_name: 'sales_agent',
          display_name: 'Sales Agent+',
          permissions: { leads: ['create', 'delete'] },
        },
      ],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('cannot override system role');
  });

  test('enforces onboarding step prerequisites before completion', async () => {
    const { app } = createOnboardingApp('company_admin', {
      companyProfile: true,
      rolesConfigured: true,
      featuresSelected: false,
      aiConfigured: false,
      teamInvited: false,
    });

    const response = await request(app).post('/api/onboarding/complete').send({});

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('Step 3 (features) must be completed first');
  });

  test('allows completion when all prerequisites are satisfied', async () => {
    const { app, mockPrisma } = createOnboardingApp('company_admin', {
      companyProfile: true,
      rolesConfigured: true,
      featuresSelected: true,
      aiConfigured: true,
      teamInvited: true,
    });

    const response = await request(app).post('/api/onboarding/complete').send({});

    expect(response.status).toBe(200);
    expect(response.body.step).toBe(6);
    expect(mockPrisma.companyOnboarding.upsert).toHaveBeenCalledTimes(1);
  });

  test('normalizes aliased onboarding permission resources and preserves allowed permissions', async () => {
    const { app, mockPrisma } = createOnboardingApp('company_admin', {
      companyProfile: true,
    });

    const response = await request(app).post('/api/onboarding/roles').send({
      roles: [
        {
          role_name: 'marketing_head',
          display_name: 'Marketing Head',
          permissions: {
            settings: ['read', 'update'],
            leads: ['read'],
          },
        },
      ],
    });

    expect(response.status).toBe(200);
    expect(mockPrisma.companyRole.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roleName: 'marketing_head',
          permissions: {
            platform_settings: ['read', 'update'],
            leads: ['read'],
          },
        }),
      }),
    );
  });

  test('rejects onboarding custom role payload with unsupported permission resources', async () => {
    const { app, mockPrisma } = createOnboardingApp('company_admin', {
      companyProfile: true,
    });

    const response = await request(app).post('/api/onboarding/roles').send({
      roles: [
        {
          role_name: 'marketing_head',
          display_name: 'Marketing Head',
          permissions: {
            billing: ['read'],
          },
        },
      ],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Unsupported permission resources');
    expect(mockPrisma.companyRole.create).not.toHaveBeenCalled();
  });
});
