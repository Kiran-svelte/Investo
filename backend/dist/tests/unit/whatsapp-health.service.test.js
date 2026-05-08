"use strict";
/// <reference types="jest" />
Object.defineProperty(exports, "__esModule", { value: true });
describe('WhatsAppHealthService (security: token handling)', () => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch;
    const apiUrl = 'https://graph.facebook.com/v18.0';
    const accessToken = 'test-access-token';
    const greenApiUrl = 'https://api.green-api.com';
    function createService() {
        jest.resetModules();
        jest.doMock('../../config', () => ({
            __esModule: true,
            default: {
                whatsapp: {
                    provider: 'meta',
                    apiUrl,
                    accessToken,
                    dedupTtlSeconds: 300,
                },
                greenapi: {
                    apiUrl: greenApiUrl,
                    idInstance: '110001',
                    apiTokenInstance: 'green-token',
                },
            },
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
        jest.doMock('../../config/redis', () => ({
            __esModule: true,
            getRedis: () => null,
        }));
        let WhatsAppHealthService;
        jest.isolateModules(() => {
            WhatsAppHealthService = require('../../services/whatsappHealth.service').WhatsAppHealthService;
        });
        return new WhatsAppHealthService();
    }
    beforeEach(() => {
        jest.clearAllMocks();
    });
    test('checkConnection sends token via Authorization header (no access_token in URL)', async () => {
        const service = createService();
        mockFetch.mockResolvedValueOnce({
            ok: true,
            text: async () => '',
        });
        const result = await service.checkConnection();
        expect(result.connected).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, options] = mockFetch.mock.calls[0];
        expect(String(url)).not.toContain('access_token=');
        expect(url).toBe(`${apiUrl}/me`);
        expect(options).toEqual(expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            }),
        }));
    });
    test('verifyPhoneNumber sends token via Authorization header (no access_token in URL)', async () => {
        const service = createService();
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ verified_name: 'Investo' }),
        });
        const ok = await service.verifyPhoneNumber('123456789');
        expect(ok).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, options] = mockFetch.mock.calls[0];
        expect(String(url)).not.toContain('access_token=');
        expect(url).toBe(`${apiUrl}/123456789`);
        expect(options?.headers?.Authorization).toBe(`Bearer ${accessToken}`);
    });
    test('verifyPhoneNumber uses explicit accessToken argument when provided', async () => {
        const service = createService();
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ display_phone_number: '+1 555 555' }),
        });
        const ok = await service.verifyPhoneNumber('123', 'override-token');
        expect(ok).toBe(true);
        const [, options] = mockFetch.mock.calls[0];
        expect(options?.headers?.Authorization).toBe('Bearer override-token');
    });
    test('checkConnection uses Green-API settings endpoint in greenapi mode', async () => {
        jest.resetModules();
        jest.doMock('../../config', () => ({
            __esModule: true,
            default: {
                whatsapp: {
                    provider: 'greenapi',
                    apiUrl,
                    accessToken: '',
                    dedupTtlSeconds: 300,
                },
                greenapi: {
                    apiUrl: greenApiUrl,
                    idInstance: '220002',
                    apiTokenInstance: 'green-token-2',
                },
            },
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
        jest.doMock('../../config/redis', () => ({
            __esModule: true,
            getRedis: () => null,
        }));
        let WhatsAppHealthService;
        jest.isolateModules(() => {
            WhatsAppHealthService = require('../../services/whatsappHealth.service').WhatsAppHealthService;
        });
        const service = new WhatsAppHealthService();
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true }),
            text: async () => '',
        });
        const result = await service.checkConnection();
        expect(result.connected).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url] = mockFetch.mock.calls[0];
        expect(url).toBe(`${greenApiUrl}/waInstance220002/getSettings/green-token-2`);
    });
});
//# sourceMappingURL=whatsapp-health.service.test.js.map