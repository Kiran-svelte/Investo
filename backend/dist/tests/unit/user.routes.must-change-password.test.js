"use strict";
/// <reference types="jest" />
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supertest_1 = __importDefault(require("supertest"));
function noopMiddleware() {
    return (_req, _res, next) => next();
}
function createUserApp(userRole = 'company_admin') {
    jest.resetModules();
    const mockAuthService = {
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
        authenticate: (req, _res, next) => {
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
        tenantIsolation: (req, _res, next) => {
            req.companyId = req.user.company_id;
            next();
        },
        getCompanyId: (req) => req.companyId,
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
    let userRoutes;
    jest.isolateModules(() => {
        userRoutes = require('../../routes/user.routes').default;
    });
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
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
        const response = await (0, supertest_1.default)(app)
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
//# sourceMappingURL=user.routes.must-change-password.test.js.map