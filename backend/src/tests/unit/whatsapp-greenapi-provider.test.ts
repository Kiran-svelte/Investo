/**
 * Unit tests for the Green-API outbound provider.
 * These tests lock request semantics (URL/headers/body) to avoid regressions.
 */

import { GreenApiWhatsAppProvider } from '../../services/whatsapp/providers/greenapi-whatsapp.provider';

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('GreenApiWhatsAppProvider (outbound)', () => {
  const apiUrl = 'https://api.green-api.com';
  const idInstance = '1100000001';
  const apiTokenInstance = 'token-abc';

  const provider = new GreenApiWhatsAppProvider({ apiUrl });

  const companyConfig = {
    phoneNumberId: '',
    accessToken: '',
    verifyToken: '',
    idInstance,
    apiTokenInstance,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendTextMessage', () => {
    test('posts to Green-API sendMessage endpoint with normalized chatId', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ idMessage: 'green.123' }),
      });

      const result = await provider.sendTextMessage('+919876543210', 'Hello', companyConfig);

      expect(result).toEqual({ success: true, messageId: 'green.123' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(`${apiUrl}/waInstance${idInstance}/sendMessage/${apiTokenInstance}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: expect.any(String),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toEqual({
        chatId: '919876543210@c.us',
        message: 'Hello',
      });
    });

    test('passes through an already-normalized chatId', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ idMessage: 'green.456' }),
      });

      const result = await provider.sendTextMessage('919876543210@c.us', 'Hello', companyConfig);

      expect(result).toEqual({ success: true, messageId: 'green.456' });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.chatId).toBe('919876543210@c.us');
    });

    test('returns structured API error details when response is not ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const result = await provider.sendTextMessage('+919876543210', 'Hello', companyConfig);

      expect(result).toEqual({ success: false, status: 401, errorText: 'Unauthorized' });
    });

    test('propagates unexpected failures (network, parsing)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network down'));

      await expect(provider.sendTextMessage('+919876543210', 'Hello', companyConfig)).rejects.toThrow('network down');
    });
  });

  describe('testConnection', () => {
    test('returns missing config error without calling fetch', async () => {
      const result = await provider.testConnection({
        ...companyConfig,
        idInstance: '',
        apiTokenInstance: '',
      });

      expect(result).toEqual({ success: false, error: 'Missing idInstance or apiTokenInstance' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('calls GET getSettings endpoint and treats 200 as ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}) ,
      });

      const result = await provider.testConnection(companyConfig);

      expect(result).toEqual({ success: true, error: undefined });
      expect(mockFetch).toHaveBeenCalledWith(`${apiUrl}/waInstance${idInstance}/getSettings/${apiTokenInstance}`, {
        method: 'GET',
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
