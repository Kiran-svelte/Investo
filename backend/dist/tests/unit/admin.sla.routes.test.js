"use strict";
/// <reference types="jest" />
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
jest.setTimeout(30000);
function noopMiddleware() {
    return (_req, _res, next) => next();
}
function createAdminApp() {
    jest.resetModules();
    const mockPrisma = {
        $queryRaw: jest.fn(),
        message: { count: jest.fn() },
        invoice: { count: jest.fn() },
        company: { count: jest.fn() },
        propertyImportJob: { count: jest.fn() },
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
                id: 'admin-1',
                company_id: 'company-admin',
                companyId: 'company-admin',
                role: 'super_admin',
                email: 'superadmin@investo.in',
                name: 'Super Admin',
            };
            next();
        },
    }));
    jest.doMock('../../middleware/rbac', () => ({
        __esModule: true,
        hasRole: () => noopMiddleware(),
    }));
    let adminRoutes;
    jest.isolateModules(() => {
        adminRoutes = require('../../routes/admin.routes').default;
    });
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use('/api/admin', adminRoutes);
    return { app, mockPrisma };
}
describe('admin SLA route', () => {
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });
    test('returns SLA summary payload with breach flags', async () => {
        const { app, mockPrisma } = createAdminApp();
        mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
        mockPrisma.message.count
            .mockResolvedValueOnce(1000)
            .mockResolvedValueOnce(3);
        mockPrisma.invoice.count.mockResolvedValue(5);
        mockPrisma.company.count.mockResolvedValue(400);
        mockPrisma.propertyImportJob.count.mockResolvedValue(0);
        const response = await (0, supertest_1.default)(app).get('/api/admin/sla');
        expect(response.status).toBe(200);
        expect(response.body.data).toBeDefined();
        expect(response.body.data.sli).toBeDefined();
        expect(response.body.data.targets).toBeDefined();
        expect(response.body.data.breaches).toEqual(expect.objectContaining({
            db_latency: expect.any(Boolean),
            message_delivery: expect.any(Boolean),
            billing_overdue_ratio: expect.any(Boolean),
            import_stalls: expect.any(Boolean),
        }));
        expect(response.body.data.sli.message_delivery_success_rate).toBeCloseTo(0.997, 3);
    });
});
//# sourceMappingURL=admin.sla.routes.test.js.map