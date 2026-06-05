/// <reference types="jest" />

import express, { Express, RequestHandler } from 'express';
import request from 'supertest';

jest.setTimeout(30000);

type MockPrisma = {
  lead: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
  };
  auditLog: {
    findMany: jest.Mock;
  };
};

function noopMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

function createLeadGdprApp(role: string): {
  app: Express;
  mockGdpr: {
    exportLeadPersonalData: jest.Mock;
    eraseLeadPersonalData: jest.Mock;
  };
} {
  jest.resetModules();

  const mockPrisma: MockPrisma = {
    lead: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn(),
    },
  };

  const mockGdpr = {
    exportLeadPersonalData: jest.fn(),
    eraseLeadPersonalData: jest.fn(),
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
    tenantIsolation: (req: any, _res: any, next: any) => {
      req.companyId = 'company-1';
      next();
    },
    getCompanyId: () => 'company-1',
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
    SOCKET_EVENTS: { LEAD_UPDATED: 'lead.updated' },
  }));

  jest.doMock('../../services/leadGdpr.service', () => ({
    __esModule: true,
    exportLeadPersonalData: mockGdpr.exportLeadPersonalData,
    eraseLeadPersonalData: mockGdpr.eraseLeadPersonalData,
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

  return { app, mockGdpr };
}

describe('lead GDPR routes RBAC', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('company_admin can export lead data', async () => {
    const { app, mockGdpr } = createLeadGdprApp('company_admin');
    mockGdpr.exportLeadPersonalData.mockResolvedValue({
      exported_at: '2026-06-05T00:00:00.000Z',
      lead: { id: 'lead-1', phone: '+911111111111' },
      conversations: [],
      visits: [],
      audit_trail: [],
    });

    const response = await request(app).get('/api/leads/lead-1/data-export');

    expect(response.status).toBe(200);
    expect(response.body.lead.id).toBe('lead-1');
    expect(mockGdpr.exportLeadPersonalData).toHaveBeenCalledWith('company-1', 'lead-1');
  });

  test('sales_agent is forbidden from GDPR export', async () => {
    const { app, mockGdpr } = createLeadGdprApp('sales_agent');
    const response = await request(app).get('/api/leads/lead-1/data-export');

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/insufficient role/i);
    expect(mockGdpr.exportLeadPersonalData).not.toHaveBeenCalled();
  });

  test('company_admin can erase lead personal data', async () => {
    const { app, mockGdpr } = createLeadGdprApp('company_admin');
    mockGdpr.eraseLeadPersonalData.mockResolvedValue(undefined);

    const response = await request(app).delete('/api/leads/lead-1/gdpr-erase');

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/erased permanently/i);
    expect(mockGdpr.eraseLeadPersonalData).toHaveBeenCalledWith('company-1', 'lead-1');
  });

  test('viewer is forbidden from GDPR erase', async () => {
    const { app, mockGdpr } = createLeadGdprApp('viewer');
    const response = await request(app).delete('/api/leads/lead-1/gdpr-erase');

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/insufficient role/i);
    expect(mockGdpr.eraseLeadPersonalData).not.toHaveBeenCalled();
  });
});
