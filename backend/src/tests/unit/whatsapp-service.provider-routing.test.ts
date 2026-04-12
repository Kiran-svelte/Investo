/// <reference types="jest" />

const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

function createServiceWithConfig(configOverride: any): any {
  jest.resetModules();

  jest.doMock('../../config', () => ({
    __esModule: true,
    default: configOverride,
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

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: {
      company: { findMany: jest.fn() },
      lead: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), groupBy: jest.fn() },
      conversation: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
      message: { create: jest.fn(), findMany: jest.fn() },
      notification: { create: jest.fn() },
      aiSetting: { findUnique: jest.fn() },
      property: { findMany: jest.fn(), findUnique: jest.fn() },
      user: { findMany: jest.fn() },
    },
  }));

  jest.doMock('../../services/ai.service', () => ({
    __esModule: true,
    aiService: {
      generateResponse: jest.fn(),
    },
  }));

  jest.doMock('../../services/socket.service', () => ({
    __esModule: true,
    socketService: {
      emitToCompany: jest.fn(),
    },
    SOCKET_EVENTS: {
      CONVERSATION_UPDATED: 'conversation.updated',
      MESSAGE_NEW: 'message.new',
    },
  }));

  let WhatsAppService: any;
  jest.isolateModules(() => {
    WhatsAppService = require('../../services/whatsapp.service').WhatsAppService;
  });

  return new WhatsAppService();
}

describe('WhatsAppService outbound provider routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  test('sendMessage routes to Meta provider when provider=meta', async () => {
    const service = createServiceWithConfig({
      env: 'test',
      whatsapp: {
        provider: 'meta',
        apiUrl: 'https://graph.facebook.com/v18.0',
      },
      greenapi: {
        apiUrl: 'https://api.green-api.com',
        idInstance: '1100000001',
        apiTokenInstance: 'token-abc',
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.123' }] }),
    });

    const ok = await service.sendMessage('+919876543210', 'Hello', {
      phoneNumberId: '123456789',
      accessToken: 'test-token',
      verifyToken: 'verify-token',
    });

    expect(ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v18.0/123456789/messages');
  });

  test('sendMessage routes to GreenApi provider when provider=greenapi (non-prod)', async () => {
    const service = createServiceWithConfig({
      env: 'test',
      whatsapp: {
        provider: 'greenapi',
        apiUrl: 'https://graph.facebook.com/v18.0',
      },
      greenapi: {
        apiUrl: 'https://api.green-api.com',
        idInstance: '1100000001',
        apiTokenInstance: 'token-abc',
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ idMessage: 'green.123' }),
    });

    const ok = await service.sendMessage('+919876543210', 'Hello', {
      phoneNumberId: '',
      accessToken: '',
      verifyToken: '',
    });

    expect(ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0] as any[];
    expect(url).toBe('https://api.green-api.com/waInstance1100000001/sendMessage/token-abc');

    const body = JSON.parse(options.body);
    expect(body).toEqual({
      chatId: '919876543210@c.us',
      message: 'Hello',
    });
  });

  test('testConnection routes to selected provider', async () => {
    const metaService = createServiceWithConfig({
      env: 'test',
      whatsapp: {
        provider: 'meta',
        apiUrl: 'https://graph.facebook.com/v18.0',
      },
      greenapi: {
        apiUrl: 'https://api.green-api.com',
        idInstance: '1100000001',
        apiTokenInstance: 'token-abc',
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: '123456789' }),
    });

    const metaResult = await metaService.testConnection({
      phoneNumberId: '123456789',
      accessToken: 'token',
      verifyToken: '',
    });

    expect(metaResult).toEqual({ success: true, error: undefined });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://graph.facebook.com/v18.0/123456789');

    mockFetch.mockReset();

    const greenService = createServiceWithConfig({
      env: 'test',
      whatsapp: {
        provider: 'greenapi',
        apiUrl: 'https://graph.facebook.com/v18.0',
      },
      greenapi: {
        apiUrl: 'https://api.green-api.com',
        idInstance: '1100000001',
        apiTokenInstance: 'token-abc',
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    const greenResult = await greenService.testConnection({
      phoneNumberId: '',
      accessToken: '',
      verifyToken: '',
    });

    expect(greenResult).toEqual({ success: true, error: undefined });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.green-api.com/waInstance1100000001/getSettings/token-abc');
  });

  test('production mode never uses GreenApi even if selected', async () => {
    const service = createServiceWithConfig({
      env: 'production',
      whatsapp: {
        provider: 'greenapi',
        apiUrl: 'https://graph.facebook.com/v18.0',
      },
      greenapi: {
        apiUrl: 'https://api.green-api.com',
        idInstance: '1100000001',
        apiTokenInstance: 'token-abc',
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.999' }] }),
    });

    const ok = await service.sendMessage('+919876543210', 'Hello', {
      phoneNumberId: '123456789',
      accessToken: 'token',
      verifyToken: '',
    });

    expect(ok).toBe(true);

    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('graph.facebook.com');
    expect(String(url)).not.toContain('green-api.com');
  });

  describe('meta-only advanced sends', () => {
    test('sendImage returns not supported when provider=greenapi', async () => {
      const service = createServiceWithConfig({
        env: 'test',
        whatsapp: {
          provider: 'greenapi',
          apiUrl: 'https://graph.facebook.com/v18.0',
        },
        greenapi: {
          apiUrl: 'https://api.green-api.com',
          idInstance: '1100000001',
          apiTokenInstance: 'token-abc',
        },
      });

      const result = await service.sendImage('+919876543210', 'https://cdn.example.com/a.jpg', null, {
        phoneNumberId: '',
        accessToken: '',
        verifyToken: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not supported/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('sendDocument returns not supported when provider=greenapi', async () => {
      const service = createServiceWithConfig({
        env: 'test',
        whatsapp: {
          provider: 'greenapi',
          apiUrl: 'https://graph.facebook.com/v18.0',
        },
        greenapi: {
          apiUrl: 'https://api.green-api.com',
          idInstance: '1100000001',
          apiTokenInstance: 'token-abc',
        },
      });

      const result = await service.sendDocument('+919876543210', 'https://cdn.example.com/a.pdf', 'a.pdf', null, {
        phoneNumberId: '',
        accessToken: '',
        verifyToken: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not supported/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('sendLocation returns not supported when provider=greenapi', async () => {
      const service = createServiceWithConfig({
        env: 'test',
        whatsapp: {
          provider: 'greenapi',
          apiUrl: 'https://graph.facebook.com/v18.0',
        },
        greenapi: {
          apiUrl: 'https://api.green-api.com',
          idInstance: '1100000001',
          apiTokenInstance: 'token-abc',
        },
      });

      const result = await service.sendLocation('+919876543210', 12.9716, 77.5946, 'Somewhere', 'Addr', {
        phoneNumberId: '',
        accessToken: '',
        verifyToken: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not supported/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('sendInteractiveButtons returns not supported when provider=greenapi', async () => {
      const service = createServiceWithConfig({
        env: 'test',
        whatsapp: {
          provider: 'greenapi',
          apiUrl: 'https://graph.facebook.com/v18.0',
        },
        greenapi: {
          apiUrl: 'https://api.green-api.com',
          idInstance: '1100000001',
          apiTokenInstance: 'token-abc',
        },
      });

      const result = await service.sendInteractiveButtons(
        '+919876543210',
        'Body',
        [{ id: 'a', title: 'A' }],
        null,
        null,
        {
          phoneNumberId: '',
          accessToken: '',
          verifyToken: '',
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not supported/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('sendInteractiveList returns not supported when provider=greenapi', async () => {
      const service = createServiceWithConfig({
        env: 'test',
        whatsapp: {
          provider: 'greenapi',
          apiUrl: 'https://graph.facebook.com/v18.0',
        },
        greenapi: {
          apiUrl: 'https://api.green-api.com',
          idInstance: '1100000001',
          apiTokenInstance: 'token-abc',
        },
      });

      const result = await service.sendInteractiveList(
        '+919876543210',
        'Body',
        'Button',
        [{ title: 'Section', rows: [{ id: 'row', title: 'Row' }] }],
        null,
        null,
        {
          phoneNumberId: '',
          accessToken: '',
          verifyToken: '',
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not supported/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
