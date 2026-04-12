/**
 * Unit tests for the Meta (WhatsApp Cloud API) outbound provider.
 * These tests lock request semantics (URL/headers/body) to avoid regressions.
 */

import { MetaWhatsAppProvider } from '../../services/whatsapp/providers/meta-whatsapp.provider';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('MetaWhatsAppProvider (outbound)', () => {
  const apiUrl = 'https://graph.facebook.com/v18.0';
  const provider = new MetaWhatsAppProvider({ apiUrl });

  const companyConfig = {
    phoneNumberId: '123456789',
    accessToken: 'test-access-token',
    verifyToken: 'verify-token',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendTextMessage', () => {
    test('posts to /{phoneNumberId}/messages with text payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.123' }] }),
      });

      const result = await provider.sendTextMessage('+919876543210', 'Hello', companyConfig);

      expect(result).toEqual({ success: true, messageId: 'wamid.123' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(`${apiUrl}/${companyConfig.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${companyConfig.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: expect.any(String),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({
        messaging_product: 'whatsapp',
        to: '919876543210',
        type: 'text',
        text: { body: 'Hello' },
      });
    });

    test('returns structured API error details when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Invalid request',
      });

      const result = await provider.sendTextMessage('+919876543210', 'Hello', companyConfig);

      expect(result).toEqual({ success: false, status: 400, errorText: 'Invalid request' });
    });

    test('propagates unexpected failures (network, parsing)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network down'));

      await expect(provider.sendTextMessage('+919876543210', 'Hello', companyConfig)).rejects.toThrow('network down');
    });
  });

  describe('testConnection', () => {
    test('returns missing config error without calling fetch', async () => {
      const result = await provider.testConnection({ phoneNumberId: '', accessToken: '', verifyToken: '' });

      expect(result).toEqual({ success: false, error: 'Missing phoneNumberId or accessToken' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('calls GET /{phoneNumberId} with Authorization header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: '123456789' }),
      });

      const result = await provider.testConnection(companyConfig);

      expect(result).toEqual({ success: true, error: undefined });
      expect(mockFetch).toHaveBeenCalledWith(`${apiUrl}/${companyConfig.phoneNumberId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${companyConfig.accessToken}`,
        },
      });
    });

    test('returns API error text on non-2xx response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      const result = await provider.testConnection(companyConfig);

      expect(result).toEqual({ success: false, error: 'API Error: 403 - Forbidden' });
    });

    test('returns caught exception messages', async () => {
      mockFetch.mockRejectedValueOnce(new Error('timeout'));

      const result = await provider.testConnection(companyConfig);

      expect(result).toEqual({ success: false, error: 'timeout' });
    });
  });
});
