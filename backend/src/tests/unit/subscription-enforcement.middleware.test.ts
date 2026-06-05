/// <reference types="jest" />

/**
 * Subscription enforcement middleware tests.
 *
 * BILLING DISABLED: Both middleware functions are no-ops.
 * Tests verify the bypass behavior — all requests pass through unconditionally.
 *
 * When billing is re-enabled, restore the original tests from git history
 * (tagged at the commit before billing was disabled).
 */

import express, { Express } from 'express';
import request from 'supertest';

jest.setTimeout(30000);

type MockPrisma = {
  company: { findFirst: jest.Mock };
  invoice: { findFirst: jest.Mock };
  lead: { count: jest.Mock };
  property: { count: jest.Mock };
  user: { count: jest.Mock };
};

/**
 * Builds a test Express app with the subscription enforcement middleware wired in.
 *
 * @param userRole - The role to assign the mocked user
 * @param options - Optional company ID override
 * @returns Express app and Prisma mock
 */
function createApp(userRole: string, options?: { companyId?: string }): { app: Express; mockPrisma: MockPrisma } {
  jest.resetModules();

  const companyId = options?.companyId || 'company-1';

  const mockPrisma: MockPrisma = {
    company: { findFirst: jest.fn() },
    invoice: { findFirst: jest.fn() },
    lead: { count: jest.fn() },
    property: { count: jest.fn() },
    user: { count: jest.fn() },
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

  let middleware: { requireActivePaidSubscription: unknown; enforcePlanLimit: (resource: string) => unknown };
  jest.isolateModules(() => {
    middleware = require('../../middleware/subscriptionEnforcement');
  });

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = {
      id: 'user-1',
      company_id: companyId,
      companyId,
      role: userRole,
      email: 'u@investo.in',
      name: 'User',
    };
    next();
  });

  app.post('/write', middleware!.requireActivePaidSubscription as any, (_req, res) => {
    res.status(201).json({ ok: true });
  });

  app.post('/write-lead', middleware!.requireActivePaidSubscription as any, middleware!.enforcePlanLimit('leads') as any, (_req, res) => {
    res.status(201).json({ ok: true });
  });

  return { app, mockPrisma };
}

describe('subscription enforcement middleware (billing disabled)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('super_admin passes through without any DB calls', async () => {
    const { app, mockPrisma } = createApp('super_admin');

    const response = await request(app).post('/write').send({});

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
    // No billing DB queries should occur
    expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.invoice.findFirst).not.toHaveBeenCalled();
  });

  test('company_admin passes through even with simulated overdue invoice (billing disabled)', async () => {
    /**
     * BILLING DISABLED: Previously this test expected 402 status.
     * With billing bypassed, the request must always proceed.
     * Restore the 402 expectation when billing is re-enabled.
     */
    const { app, mockPrisma } = createApp('company_admin');

    // Mock overdue state — should be ignored when billing is off
    mockPrisma.company.findFirst.mockResolvedValue({ id: 'company-1', status: 'active', planId: 'plan-1' });
    mockPrisma.invoice.findFirst.mockResolvedValue({
      id: 'inv-1',
      status: 'overdue',
      dueDate: new Date('2026-04-01T00:00:00.000Z'),
    });

    const response = await request(app).post('/write').send({});

    // Billing is disabled — 201 is expected regardless of invoice state
    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
  });

  test('company_admin passes through even when plan lead limit would be reached (billing disabled)', async () => {
    /**
     * BILLING DISABLED: Previously expected 403 (plan_limit_leads).
     * With limits bypassed, request must proceed.
     * Restore the 403 expectation when billing is re-enabled.
     */
    const { app, mockPrisma } = createApp('company_admin');

    mockPrisma.company.findFirst
      .mockResolvedValueOnce({ id: 'company-1', status: 'active', planId: 'plan-1' })
      .mockResolvedValueOnce({
        id: 'company-1',
        status: 'active',
        plan: { maxAgents: 3, maxLeads: 100, maxProperties: 50 },
      });
    mockPrisma.invoice.findFirst.mockResolvedValue(null);
    mockPrisma.lead.count.mockResolvedValue(100);

    const response = await request(app).post('/write-lead').send({});

    // Billing is disabled — lead limit not enforced
    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
  });

  test('allows lead creation when lead cap is unlimited (still works when billing re-enabled)', async () => {
    const { app, mockPrisma } = createApp('company_admin');

    mockPrisma.company.findFirst
      .mockResolvedValueOnce({ id: 'company-1', status: 'active', planId: 'plan-1' })
      .mockResolvedValueOnce({
        id: 'company-1',
        status: 'active',
        plan: { maxAgents: 3, maxLeads: null, maxProperties: 50 },
      });
    mockPrisma.invoice.findFirst.mockResolvedValue(null);

    const response = await request(app).post('/write-lead').send({});

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
  });
});
