/// <reference types="jest" />
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
const mockPrisma = {
    company: {
        findMany: jest.fn(),
    },
};
jest.mock('../../config/prisma', () => ({
    __esModule: true,
    default: mockPrisma,
}));
jest.mock('../../config/logger', () => ({
    __esModule: true,
    default: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));
describe('WhatsAppService Meta company resolution (deterministic + fail closed)', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });
    it('fails closed in production when no company is mapped for the incoming phoneNumberId', async () => {
        jest.doMock('../../config', () => ({
            __esModule: true,
            default: {
                env: 'production',
                whatsapp: {
                    provider: 'meta',
                    phoneNumberId: '',
                    accessToken: 'global-token',
                    verifyToken: 'verify-token',
                    apiUrl: 'https://graph.facebook.com/v18.0',
                    dedupTtlSeconds: 300,
                },
            },
        }));
        const companyA = {
            id: 'a-company',
            name: 'A Co',
            whatsappPhone: null,
            settings: { whatsapp: { phoneNumberId: 'mapped-1', accessToken: '', verifyToken: '' } },
        };
        const companyB = {
            id: 'b-company',
            name: 'B Co',
            whatsappPhone: null,
            settings: { whatsapp: { phoneNumberId: 'mapped-2', accessToken: '', verifyToken: '' } },
        };
        mockPrisma.company.findMany.mockResolvedValue([companyA, companyB]);
        const { WhatsAppService } = await Promise.resolve().then(() => __importStar(require('../../services/whatsapp.service')));
        const service = new WhatsAppService();
        const result = await service.getCompanyByPhoneNumberId('unmapped');
        expect(result).toBeNull();
    });
    it('allows a single-company fallback in non-production only when exactly one active company exists', async () => {
        jest.doMock('../../config', () => ({
            __esModule: true,
            default: {
                env: 'development',
                whatsapp: {
                    provider: 'meta',
                    phoneNumberId: '',
                    accessToken: 'global-token',
                    verifyToken: 'verify-token',
                    apiUrl: 'https://graph.facebook.com/v18.0',
                    dedupTtlSeconds: 300,
                },
            },
        }));
        const onlyCompany = {
            id: 'only-company',
            name: 'Only Co',
            whatsappPhone: null,
            settings: { whatsapp: { phoneNumberId: 'mapped-1', accessToken: '', verifyToken: '' } },
        };
        mockPrisma.company.findMany.mockResolvedValue([onlyCompany]);
        const { WhatsAppService } = await Promise.resolve().then(() => __importStar(require('../../services/whatsapp.service')));
        const service = new WhatsAppService();
        const result = await service.getCompanyByPhoneNumberId('unmapped');
        expect(result).not.toBeNull();
        expect(result?.company?.id).toBe('only-company');
    });
    it('fails closed in non-production when more than one active company exists and phoneNumberId is unmapped', async () => {
        jest.doMock('../../config', () => ({
            __esModule: true,
            default: {
                env: 'development',
                whatsapp: {
                    provider: 'meta',
                    phoneNumberId: '',
                    accessToken: 'global-token',
                    verifyToken: 'verify-token',
                    apiUrl: 'https://graph.facebook.com/v18.0',
                    dedupTtlSeconds: 300,
                },
            },
        }));
        const companyA = {
            id: 'a-company',
            name: 'A Co',
            whatsappPhone: null,
            settings: { whatsapp: { phoneNumberId: 'mapped-1', accessToken: '', verifyToken: '' } },
        };
        const companyB = {
            id: 'b-company',
            name: 'B Co',
            whatsappPhone: null,
            settings: { whatsapp: { phoneNumberId: 'mapped-2', accessToken: '', verifyToken: '' } },
        };
        mockPrisma.company.findMany.mockResolvedValue([companyA, companyB]);
        const { WhatsAppService } = await Promise.resolve().then(() => __importStar(require('../../services/whatsapp.service')));
        const service = new WhatsAppService();
        const result = await service.getCompanyByPhoneNumberId('unmapped');
        expect(result).toBeNull();
    });
    it('fails closed when more than one active company is mapped to the same incoming phoneNumberId (duplicate mapping)', async () => {
        jest.doMock('../../config', () => ({
            __esModule: true,
            default: {
                env: 'development',
                whatsapp: {
                    provider: 'meta',
                    phoneNumberId: '',
                    accessToken: 'global-token',
                    verifyToken: 'verify-token',
                    apiUrl: 'https://graph.facebook.com/v18.0',
                    dedupTtlSeconds: 300,
                },
            },
        }));
        const companyA = {
            id: 'a-company',
            name: 'A Co',
            whatsappPhone: null,
            settings: { whatsapp: { phoneNumberId: 'dup', accessToken: '', verifyToken: '' } },
        };
        const companyB = {
            id: 'b-company',
            name: 'B Co',
            whatsappPhone: null,
            settings: { whatsapp: { phoneNumberId: 'dup', accessToken: '', verifyToken: '' } },
        };
        mockPrisma.company.findMany.mockResolvedValue([companyA, companyB]);
        const { WhatsAppService } = await Promise.resolve().then(() => __importStar(require('../../services/whatsapp.service')));
        const service = new WhatsAppService();
        const result = await service.getCompanyByPhoneNumberId('dup');
        expect(result).toBeNull();
    });
});
//# sourceMappingURL=whatsapp.meta-company-resolution.test.js.map