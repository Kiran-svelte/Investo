/// <reference types="jest" />

import express, { Express, RequestHandler } from 'express';
import request from 'supertest';

const RESOLUTION_ID = 'INVESTO-20260701-PENDING-VISIT-CALENDAR';

type CalendarAppOptions = {
  role?: 'company_admin' | 'sales_agent';
  userId?: string;
  pendingRows?: Array<Record<string, unknown>>;
  approval?: Record<string, unknown> | null;
};

function noopMiddleware(): RequestHandler {
  return (_req, _res, next) => next();
}

function createCalendarApp(opts: CalendarAppOptions = {}): {
  app: Express;
  mockPrisma: { visit: { findMany: jest.Mock }; $queryRawUnsafe: jest.Mock };
  mockGetBookingApprovalById: jest.Mock;
  mockResolveVisitApproval: jest.Mock;
} {
  jest.resetModules();

  const role = opts.role ?? 'company_admin';
  const userId = opts.userId ?? 'admin-1';
  const pendingRows = opts.pendingRows ?? [];
  const mockPrisma = {
    visit: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $queryRawUnsafe: jest.fn((sql: string) => {
      if (sql.includes('booking_approval_requests')) return Promise.resolve(pendingRows);
      if (sql.includes('call_requests')) return Promise.resolve([]);
      return Promise.resolve([]);
    }),
  };
  const mockGetBookingApprovalById = jest.fn().mockResolvedValue(
    opts.approval === undefined
      ? {
          id: 'approval-1',
          companyId: 'company-1',
          kind: 'visit',
          status: 'pending',
          agentId: 'agent-1',
        }
      : opts.approval,
  );
  const mockResolveVisitApproval = jest.fn().mockResolvedValue({ ok: true, message: 'Visit confirmed.' });

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: mockPrisma,
  }));

  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  }));

  jest.doMock('../../middleware/tenant', () => ({
    __esModule: true,
    strictTenantIsolation: (req: any, _res: any, next: any) => {
      req.companyId = 'company-1';
      next();
    },
    getCompanyId: (req: any) => req.companyId || 'company-1',
  }));

  jest.doMock('../../middleware/rbac', () => ({
    __esModule: true,
    authorize: () => noopMiddleware(),
  }));

  jest.doMock('../../services/callRequest.service', () => ({
    __esModule: true,
    ensureCallRequestsSchema: jest.fn().mockResolvedValue(undefined),
  }));

  jest.doMock('../../services/bookingApproval.service', () => ({
    __esModule: true,
    getBookingApprovalById: mockGetBookingApprovalById,
  }));

  jest.doMock('../../services/visitPendingApproval.service', () => ({
    __esModule: true,
    resolveVisitApproval: mockResolveVisitApproval,
  }));

  let routes: any;
  jest.isolateModules(() => {
    routes = require('../../routes/calendar.routes').default;
  });

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = {
      id: userId,
      company_id: 'company-1',
      companyId: 'company-1',
      role,
      email: 'user@investo.in',
    };
    next();
  });
  app.use('/api/calendar', routes);

  return { app, mockPrisma, mockGetBookingApprovalById, mockResolveVisitApproval };
}

describe('calendar routes - pending visit approvals', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test(`${RESOLUTION_ID} exposes buyer-requested pending visit approvals in calendar events`, async () => {
    const { app } = createCalendarApp({
      pendingRows: [
        {
          approval_id: 'approval-1',
          lead_id: 'lead-1',
          property_id: 'property-1',
          agent_id: 'agent-1',
          scheduled_at: new Date('2026-07-01T12:30:00.000Z'),
          customer_name: 'Ravi Buyer',
          customer_phone: '+919999999999',
          property_name: 'Sunset Heights 1102',
          property_area: 'Whitefield',
          agent_name: 'Agent One',
        },
      ],
    });

    const response = await request(app)
      .get('/api/calendar/events')
      .query({
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-01T23:59:59.999Z',
      });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: 'visit-approval-approval-1',
      approval_id: 'approval-1',
      is_pending_approval: true,
      resolution_id: RESOLUTION_ID,
      type: 'visit',
      status: 'pending_approval',
      lead_id: 'lead-1',
      property_id: 'property-1',
      property_name: 'Sunset Heights 1102',
      customer_name: 'Ravi Buyer',
      agent_id: 'agent-1',
      agent_name: 'Agent One',
    });
  });

  test(`${RESOLUTION_ID} confirms pending calendar approvals through the assigned agent`, async () => {
    const { app, mockResolveVisitApproval } = createCalendarApp({
      approval: {
        id: 'approval-1',
        companyId: 'company-1',
        kind: 'visit',
        status: 'pending',
        agentId: 'agent-9',
      },
    });

    const response = await request(app)
      .patch('/api/calendar/visit-approvals/approval-1/status')
      .send({ status: 'scheduled' });

    expect(response.status).toBe(200);
    expect(response.body.resolution_id).toBe(RESOLUTION_ID);
    expect(mockResolveVisitApproval).toHaveBeenCalledWith('approval-1', true, 'company-1', 'agent-9');
  });

  test(`${RESOLUTION_ID} keeps sales agents scoped to their own pending visit approvals`, async () => {
    const { app, mockResolveVisitApproval } = createCalendarApp({
      role: 'sales_agent',
      userId: 'agent-1',
      approval: {
        id: 'approval-2',
        companyId: 'company-1',
        kind: 'visit',
        status: 'pending',
        agentId: 'agent-2',
      },
    });

    const response = await request(app)
      .patch('/api/calendar/visit-approvals/approval-2/status')
      .send({ status: 'cancelled' });

    expect(response.status).toBe(403);
    expect(response.body.resolution_id).toBe(RESOLUTION_ID);
    expect(mockResolveVisitApproval).not.toHaveBeenCalled();
  });
});
