/// <reference types="jest" />

import express, { Express, RequestHandler } from 'express';
import request from 'supertest';

jest.setTimeout(30000);

type MockPrisma = {
  lead: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  auditLog: {
    findMany: jest.Mock;
  };
};

function noopMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

function createLeadTenantApp(companyId: string, role = 'company_admin'): {
  app: Express;
  mockPrisma: MockPrisma;
} {
  jest.resetModules();

  const mockPrisma: MockPrisma = {
    lead: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
    },
  };

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: mockPrisma,
  }));

  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  }));

  jest.doMock('../../middleware/auth', () => ({
    __esModule: true,
    authenticate: (req: any, _res: any, next: any) => {
      req.user = {
        id: 'user-1',
        company_id: companyId,
        companyId,
        role,
        email: 'user@investo.in',
        name: 'User',
      };
      next();
    },
  }));

  jest.doMock('../../middleware/tenant', () => ({
    __esModule: true,
    tenantIsolation: (req: any, _res: any, next: any) => {
      req.companyId = companyId;
      next();
    },
    getCompanyId: (req: any) => req.companyId || req.user?.company_id,
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

  jest.doMock('../../middleware/validate', () => ({
    __esModule: true,
    validate: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/rateLimiter', () => ({
    __esModule: true,
    exportRateLimiter: noopMiddleware(),
  }));

  jest.doMock('../../middleware/featureGate', () => ({
    __esModule: true,
    requireFeature: () => noopMiddleware(),
  }));

  jest.doMock('../../middleware/propertyCompletenessGate', () => ({
    __esModule: true,
    propertyCompletenessGate: noopMiddleware(),
  }));

  jest.doMock('../../middleware/subscriptionEnforcement', () => ({
    __esModule: true,
    enforcePlanLimit: () => noopMiddleware(),
    requireActivePaidSubscription: noopMiddleware(),
  }));

  jest.doMock('../../services/notification.engine', () => ({
    __esModule: true,
    notificationEngine: {
      onLeadAssigned: jest.fn(),
      onLeadReassigned: jest.fn(),
      onLeadStatusChange: jest.fn(),
    },
  }));

  jest.doMock('../../services/socket.service', () => ({
    __esModule: true,
    socketService: { emitToCompany: jest.fn(), emitToUser: jest.fn() },
    SOCKET_EVENTS: { LEAD_CREATED: 'lead.created', LEAD_UPDATED: 'lead.updated', LEAD_ASSIGNED: 'lead.assigned' },
  }));

  jest.doMock('../../services/leadAssignment.service', () => ({
    __esModule: true,
    assignLeadRoundRobin: jest.fn(),
    notifyAgentOfNewLead: jest.fn(),
  }));

  jest.doMock('../../services/leadRouting.service', () => ({
    __esModule: true,
    assignLeadWithRouting: jest.fn().mockResolvedValue(null),
  }));

  jest.doMock('../../services/resourceDelete.service', () => ({
    __esModule: true,
    deleteLeadPermanently: jest.fn(),
    ResourceDeleteError: class ResourceDeleteError extends Error {
      statusCode: number;
      constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
      }
    },
  }));

  jest.doMock('../../services/leadGdpr.service', () => ({
    __esModule: true,
    exportLeadPersonalData: jest.fn(),
    eraseLeadPersonalData: jest.fn(),
    LeadGdprError: class LeadGdprError extends Error {
      statusCode: number;
      constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
      }
    },
  }));

  let leadRouter: any;
  jest.isolateModules(() => {
    leadRouter = require('../../routes/lead.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use('/api/leads', leadRouter);

  return { app, mockPrisma };
}

describe('lead tenant boundary', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('GET /api/leads/:id scopes lookup to request company', async () => {
    const { app, mockPrisma } = createLeadTenantApp('company-a');
    mockPrisma.lead.findFirst.mockResolvedValue(null);

    const response = await request(app).get('/api/leads/lead-other-company');

    expect(response.status).toBe(404);
    expect(mockPrisma.lead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'lead-other-company',
          companyId: 'company-a',
        }),
      }),
    );
  });

  test('GET /api/leads list always filters by tenant company', async () => {
    const { app, mockPrisma } = createLeadTenantApp('company-b');
    mockPrisma.lead.findMany.mockResolvedValue([]);
    mockPrisma.lead.count.mockResolvedValue(0);

    const response = await request(app).get('/api/leads');

    expect(response.status).toBe(200);
    expect(mockPrisma.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: 'company-b' }),
      }),
    );
  });

  test('PUT /api/leads/:id returns 404 when lead belongs to another tenant', async () => {
    const { app, mockPrisma } = createLeadTenantApp('company-a');
    mockPrisma.lead.findFirst.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/leads/lead-foreign')
      .send({ customer_name: 'Updated' });

    expect(response.status).toBe(404);
    expect(mockPrisma.lead.update).not.toHaveBeenCalled();
  });
});
