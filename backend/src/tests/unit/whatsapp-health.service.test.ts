/// <reference types="jest" />

import type { HealthStatus } from '../../services/whatsappHealth.service';

describe('WhatsAppHealthService (security: token handling)', () => {
  const mockFetch = jest.fn();
  (global as any).fetch = mockFetch;

  const apiUrl = 'https://graph.facebook.com/v18.0';
  const accessToken = 'test-access-token';

  function createService(): any {
    jest.resetModules();

    jest.doMock('../../config', () => ({
      __esModule: true,
      default: {
        whatsapp: {
          apiUrl,
          accessToken,
          dedupTtlSeconds: 300,
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

    let WhatsAppHealthService: any;
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

    const result: HealthStatus = await service.checkConnection();

    expect(result.connected).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0];
    expect(String(url)).not.toContain('access_token=');
    expect(url).toBe(`${apiUrl}/me`);
    expect(options).toEqual(
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        }),
      })
    );
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
});
