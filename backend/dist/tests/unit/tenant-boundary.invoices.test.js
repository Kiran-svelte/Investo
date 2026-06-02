"use strict";
/// <reference types="jest" />
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
jest.setTimeout(30000);
function createInvoiceApp(userRole) {
    jest.resetModules();
    const mockPrisma = {
        invoice: {
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
            findFirst: jest.fn(),
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
        authenticate: (req, _res, next) => {
            req.user = {
                id: 'user-1',
                company_id: 'company-1',
                companyId: 'company-1',
                role: userRole,
                email: 'user@investo.in',
                name: 'User',
            };
            next();
        },
    }));
    jest.doMock('../../middleware/rbac', () => ({
        __esModule: true,
        hasRole: () => (_req, _res, next) => next(),
    }));
    jest.doMock('../../middleware/audit', () => ({
        __esModule: true,
        auditLog: () => (_req, _res, next) => next(),
    }));
    let invoiceRoutes;
    jest.isolateModules(() => {
        invoiceRoutes = require('../../routes/invoice.routes').default;
    });
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/subscriptions/invoices', invoiceRoutes);
    return { app, mockPrisma };
}
describe('tenant boundary - invoice routes', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });
    test('company admin cannot override company scope using query company_id', async () => {
        const { app, mockPrisma } = createInvoiceApp('company_admin');
        const response = await (0, supertest_1.default)(app).get('/api/subscriptions/invoices?company_id=company-2');
        expect(response.status).toBe(200);
        expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ companyId: 'company-1' }),
        }));
    });
    test('super admin can query invoices for a target company', async () => {
        const { app, mockPrisma } = createInvoiceApp('super_admin');
        const response = await (0, supertest_1.default)(app).get('/api/subscriptions/invoices?company_id=company-2');
        expect(response.status).toBe(200);
        expect(mockPrisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ companyId: 'company-2' }),
        }));
    });
    test('company admin cannot fetch invoice from another company by id', async () => {
        const { app, mockPrisma } = createInvoiceApp('company_admin');
        mockPrisma.invoice.findFirst.mockResolvedValue(null);
        const response = await (0, supertest_1.default)(app).get('/api/subscriptions/invoices/invoice-2');
        expect(response.status).toBe(404);
        expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                id: 'invoice-2',
                companyId: 'company-1',
            }),
        }));
    });
});
//# sourceMappingURL=tenant-boundary.invoices.test.js.map