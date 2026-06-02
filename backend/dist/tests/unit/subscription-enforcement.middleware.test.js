"use strict";
/// <reference types="jest" />
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
jest.setTimeout(30000);
function createApp(userRole, options) {
    jest.resetModules();
    const companyId = options?.companyId || 'company-1';
    const mockPrisma = {
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
    let middleware;
    jest.isolateModules(() => {
        middleware = require('../../middleware/subscriptionEnforcement');
    });
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use((req, _res, next) => {
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
    app.post('/write', middleware.requireActivePaidSubscription, (_req, res) => {
        res.status(201).json({ ok: true });
    });
    app.post('/write-lead', middleware.requireActivePaidSubscription, middleware.enforcePlanLimit('leads'), (_req, res) => {
        res.status(201).json({ ok: true });
    });
    return { app, mockPrisma };
}
describe('subscription enforcement middleware', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });
    test('bypasses enforcement for super_admin', async () => {
        const { app, mockPrisma } = createApp('super_admin');
        const response = await (0, supertest_1.default)(app).post('/write').send({});
        expect(response.status).toBe(201);
        expect(response.body.ok).toBe(true);
        expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
    });
    test('blocks write operations when overdue invoice exists', async () => {
        const { app, mockPrisma } = createApp('company_admin');
        mockPrisma.company.findFirst.mockResolvedValue({ id: 'company-1', status: 'active', planId: 'plan-1' });
        mockPrisma.invoice.findFirst.mockResolvedValue({
            id: 'inv-1',
            status: 'overdue',
            dueDate: new Date('2026-04-01T00:00:00.000Z'),
        });
        const response = await (0, supertest_1.default)(app).post('/write').send({});
        expect(response.status).toBe(402);
        expect(response.body.code).toBe('subscription_payment_required');
    });
    test('blocks lead creation when plan lead limit is reached', async () => {
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
        const response = await (0, supertest_1.default)(app).post('/write-lead').send({});
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('plan_limit_leads');
    });
    test('allows lead creation when lead cap is unlimited', async () => {
        const { app, mockPrisma } = createApp('company_admin');
        mockPrisma.company.findFirst
            .mockResolvedValueOnce({ id: 'company-1', status: 'active', planId: 'plan-1' })
            .mockResolvedValueOnce({
            id: 'company-1',
            status: 'active',
            plan: { maxAgents: 3, maxLeads: null, maxProperties: 50 },
        });
        mockPrisma.invoice.findFirst.mockResolvedValue(null);
        const response = await (0, supertest_1.default)(app).post('/write-lead').send({});
        expect(response.status).toBe(201);
        expect(response.body.ok).toBe(true);
        expect(mockPrisma.lead.count).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=subscription-enforcement.middleware.test.js.map