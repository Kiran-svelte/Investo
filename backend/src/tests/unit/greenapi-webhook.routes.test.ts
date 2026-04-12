/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

type ConfigMock = {
  env: string;
  whatsapp: {
    provider: 'greenapi' | 'meta';
    phoneNumberId?: string;
  };
  greenapi: {
    webhookUrlToken: string;
  };
};

type LoggerMock = {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
};

type DedupMock = {
  claimMessageProcessing: jest.Mock;
  release: jest.Mock;
};

type WhatsAppServiceMock = {
  handleIncomingMessage: jest.Mock;
  getCompanyByPhoneNumberId: jest.Mock;
};

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function stringifyLoggerCallArgs(args: unknown[]): string {
  try {
    return JSON.stringify(args);
  } catch {
    return args
      .map((value) => {
        if (typeof value === 'string') {
          return value;
        }

        if (value instanceof Error) {
          return `${value.name}: ${value.message}`;
        }

        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      })
      .join(' ');
  }
}

function expectLoggerNotToLeakRawValues(logger: LoggerMock, forbiddenRawValues: string[]): void {
  const calls = [...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls];
  const haystack = calls.map((call) => stringifyLoggerCallArgs(call)).join('\n');

  for (const forbidden of forbiddenRawValues) {
    expect(haystack).not.toContain(forbidden);
  }
}

function buildIncomingTextPayload(overrides?: Partial<any>): any {
  return {
    typeWebhook: 'incomingMessageReceived',
    timestamp: 1710000000,
    idMessage: 'green-msg-1',
    instanceData: {
      idInstance: 110,
      wid: '110@c.us',
    },
    senderData: {
      chatId: '919999999999@c.us',
      sender: '919999999999@c.us',
      senderName: 'A User',
    },
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: {
        textMessage: 'hello',
      },
    },
    ...overrides,
  };
}

function buildIncomingExtendedTextPayload(overrides?: Partial<any>): any {
  return {
    typeWebhook: 'incomingMessageReceived',
    timestamp: 1710000001,
    idMessage: 'green-msg-2',
    instanceData: {
      idInstance: 110,
      wid: '110@c.us',
    },
    senderData: {
      chatId: '14155552671@c.us',
      senderName: 'B User',
    },
    messageData: {
      typeMessage: 'extendedTextMessage',
      extendedTextMessageData: {
        text: 'hi there',
      },
    },
    ...overrides,
  };
}

function createTestApp(params: {
  env: 'development' | 'test' | 'production';
  provider?: 'greenapi' | 'meta';
  webhookToken?: string;
  authHeader?: string;
  phoneNumberId?: string;
  claimResult?: boolean;
  serviceStatus?: 'processed' | 'skipped' | 'failed';
}): {
  app: Express;
  logger: LoggerMock;
  dedup: DedupMock;
  whatsappService: WhatsAppServiceMock;
  authHeader: string;
} {
  jest.resetModules();
  restoreEnv();

  process.env.NODE_ENV = params.env;

  const config: ConfigMock = {
    env: params.env,
    whatsapp: {
      provider: params.provider ?? 'greenapi',
      phoneNumberId: params.phoneNumberId ?? '',
    },
    greenapi: {
      webhookUrlToken: params.webhookToken ?? 'token-1',
    },
  };

  const logger: LoggerMock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  const dedup: DedupMock = {
    claimMessageProcessing: jest.fn().mockResolvedValue(params.claimResult ?? true),
    release: jest.fn().mockResolvedValue(undefined),
  };

  const whatsappService: WhatsAppServiceMock = {
    handleIncomingMessage: jest.fn().mockResolvedValue({
      status: params.serviceStatus ?? 'processed',
      propagation: { status: 'success' },
    }),
    getCompanyByPhoneNumberId: jest.fn().mockResolvedValue({
      company: { id: 'company-1', name: 'Test Company' },
      config: null,
    }),
  };

  jest.doMock('../../config', () => ({
    __esModule: true,
    default: config,
  }));

  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: logger,
  }));

  jest.doMock('../../services/deduplication.service', () => ({
    __esModule: true,
    deduplicationService: dedup,
  }));

  jest.doMock('../../services/whatsapp.service', () => ({
    __esModule: true,
    whatsappService,
  }));

  let router: any;
  jest.isolateModules(() => {
    router = require('../../routes/greenapi-webhook.routes').default;
  });

  const app = express();
  app.use('/api/greenapi/webhook', router);

  return {
    app,
    logger,
    dedup,
    whatsappService,
    authHeader: params.authHeader ?? `Bearer ${config.greenapi.webhookUrlToken}`,
  };
}

describe('Green-API webhook route', () => {
  afterEach(() => {
    restoreEnv();
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('rejects missing Authorization header with 401', async () => {
    const { app, whatsappService } = createTestApp({ env: 'development' });

    const response = await request(app)
      .post('/api/greenapi/webhook')
      .send(buildIncomingTextPayload());

    expect(response.status).toBe(401);

    await flushAsyncWork();
    expect(whatsappService.handleIncomingMessage).not.toHaveBeenCalled();
  });

  test('rejects invalid Authorization token with 401', async () => {
    const { app, whatsappService } = createTestApp({ env: 'development', webhookToken: 'token-1' });

    const response = await request(app)
      .post('/api/greenapi/webhook')
      .set('Authorization', 'Bearer wrong-token')
      .send(buildIncomingTextPayload());

    expect(response.status).toBe(401);

    await flushAsyncWork();
    expect(whatsappService.handleIncomingMessage).not.toHaveBeenCalled();
  });

  test('accepts valid Authorization and processes incoming text message', async () => {
    const { app, dedup, whatsappService, authHeader, logger } = createTestApp({
      env: 'development',
      webhookToken: 'token-1',
      phoneNumberId: '',
    });

    const response = await request(app)
      .post('/api/greenapi/webhook')
      .set('Authorization', authHeader)
      .send(buildIncomingTextPayload());

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('received');

    await flushAsyncWork();

    expect(dedup.claimMessageProcessing).toHaveBeenCalledWith('greenapi:110:green-msg-1');
    expect(whatsappService.handleIncomingMessage).toHaveBeenCalledWith({
      phoneNumberId: '110',
      customerPhone: '+919999999999',
      customerName: 'A User',
      messageText: 'hello',
      messageId: 'green-msg-1',
    });

    expectLoggerNotToLeakRawValues(logger, ['+919999999999', '919999999999']);
  });

  test('fails closed with 404 when no company is mapped for the instance identifier', async () => {
    const { app, dedup, whatsappService, authHeader } = createTestApp({
      env: 'development',
      webhookToken: 'token-1',
    });

    whatsappService.getCompanyByPhoneNumberId.mockResolvedValueOnce(null);

    const response = await request(app)
      .post('/api/greenapi/webhook')
      .set('Authorization', authHeader)
      .send(buildIncomingTextPayload({ idMessage: 'green-msg-no-company-1' }));

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('greenapi_company_not_found');

    await flushAsyncWork();
    expect(dedup.claimMessageProcessing).not.toHaveBeenCalled();
    expect(whatsappService.handleIncomingMessage).not.toHaveBeenCalled();
  });

  test('accepts Basic Authorization scheme when token matches', async () => {
    const { app, whatsappService, logger } = createTestApp({
      env: 'development',
      webhookToken: 'token-1',
    });

    const response = await request(app)
      .post('/api/greenapi/webhook')
      .set('Authorization', 'Basic token-1')
      .send(buildIncomingTextPayload({ idMessage: 'green-msg-basic-1' }));

    expect(response.status).toBe(200);

    await flushAsyncWork();
    expect(whatsappService.handleIncomingMessage).toHaveBeenCalledTimes(1);

    expectLoggerNotToLeakRawValues(logger, ['+919999999999', '919999999999']);
  });

  test('accepts when configured token includes scheme/whitespace (normalizes expected token)', async () => {
    const { app, whatsappService, logger } = createTestApp({
      env: 'development',
      webhookToken: '  Bearer token-1  ',
    });

    const response = await request(app)
      .post('/api/greenapi/webhook')
      .set('Authorization', 'token-1')
      .send(buildIncomingTextPayload({ idMessage: 'green-msg-normalize-1' }));

    expect(response.status).toBe(200);

    await flushAsyncWork();
    expect(whatsappService.handleIncomingMessage).toHaveBeenCalledTimes(1);

    expectLoggerNotToLeakRawValues(logger, ['+919999999999', '919999999999']);
  });

  test('parses extendedTextMessage payloads and normalizes sender from chatId when sender is missing', async () => {
    const { app, whatsappService, authHeader, logger } = createTestApp({ env: 'development', webhookToken: 'token-1' });

    const response = await request(app)
      .post('/api/greenapi/webhook')
      .set('Authorization', authHeader)
      .send(buildIncomingExtendedTextPayload());

    expect(response.status).toBe(200);

    await flushAsyncWork();

    expect(whatsappService.handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: '110',
        customerPhone: '+14155552671',
        customerName: 'B User',
        messageText: 'hi there',
        messageId: 'green-msg-2',
      }),
    );

    expectLoggerNotToLeakRawValues(logger, ['+14155552671', '14155552671']);
  });

  test('short-circuits duplicate messages when deduplication rejects claim', async () => {
    const { app, dedup, whatsappService, authHeader, logger } = createTestApp({
      env: 'development',
      webhookToken: 'token-1',
      claimResult: false,
    });

    const response = await request(app)
      .post('/api/greenapi/webhook')
      .set('Authorization', authHeader)
      .send(buildIncomingTextPayload({ idMessage: 'green-dup-1' }));

    expect(response.status).toBe(200);

    await flushAsyncWork();

    expect(dedup.claimMessageProcessing).toHaveBeenCalledWith('greenapi:110:green-dup-1');
    expect(whatsappService.handleIncomingMessage).not.toHaveBeenCalled();

    expectLoggerNotToLeakRawValues(logger, ['+919999999999', '919999999999']);
  });
});
