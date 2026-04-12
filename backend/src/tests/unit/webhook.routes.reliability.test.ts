/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';
import crypto from 'crypto';

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
    verifyToken: string;
    appSecret: string;
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
};

function createTestApp(params: {
  env: string;
  appSecret: string;
  claimResult?: boolean;
  serviceStatus?: 'processed' | 'skipped' | 'failed';
  propagationStatus?: 'success' | 'failed' | 'not_attempted';
}): {
  app: Express;
  logger: LoggerMock;
  dedup: DedupMock;
  whatsappService: WhatsAppServiceMock;
} {
  jest.resetModules();
  restoreEnv();

  process.env.NODE_ENV = params.env;

  const config: ConfigMock = {
    env: params.env,
    whatsapp: {
      verifyToken: 'verify-token',
      appSecret: params.appSecret,
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
      propagation: { status: params.propagationStatus ?? 'success' },
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

  jest.doMock('../../services/whatsappHealth.service', () => ({
    __esModule: true,
    whatsappHealthService: {
      getHealthStatus: jest.fn().mockResolvedValue({ whatsapp: { connected: true } }),
    },
  }));

  // Keep whitelist out of scope for these route tests.
  jest.doMock('../../middleware/whatsappSecurity', () => ({
    __esModule: true,
    whatsappIpWhitelist: (_req: any, _res: any, next: any) => next(),
  }));

  let router: any;
  jest.isolateModules(() => {
    router = require('../../routes/webhook.routes').default;
  });

  const app = express();
  app.use('/api/webhook', router);

  return { app, logger, dedup, whatsappService };
}

function buildPayload(overrides?: Partial<any>): any {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'pnid-1' },
              contacts: [{ profile: { name: 'A User' } }],
              messages: [
                {
                  id: 'wamid-1',
                  from: '919999999999',
                  type: 'text',
                  text: { body: 'hello' },
                },
              ],
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function signatureFor(body: any, appSecret: string): string {
  return `sha256=${crypto.createHmac('sha256', appSecret).update(JSON.stringify(body)).digest('hex')}`;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function safeStringify(value: any): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function expectNoRawPhoneInLoggerMetadata(logger: LoggerMock): void {
  const forbidden = ['919999999999', '+919999999999'];
  const calls = [
    ...logger.info.mock.calls,
    ...logger.warn.mock.calls,
    ...logger.error.mock.calls,
    ...logger.debug.mock.calls,
  ];

  for (const call of calls) {
    const metaArgs = call.slice(1);
    for (const meta of metaArgs) {
      const serialized = safeStringify(meta);
      for (const raw of forbidden) {
        expect(serialized).not.toContain(raw);
      }
    }
  }
}

describe('Webhook reliability (Chunk 1)', () => {
  afterEach(() => {
    restoreEnv();
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('rejects unsigned webhook in production when app secret is configured', async () => {
    const { app } = createTestApp({ env: 'production', appSecret: 'prod-secret' });
    const payload = buildPayload();

    const response = await request(app)
      .post('/api/webhook')
      .send(payload);

    expect(response.status).toBe(403);
    expect(response.body.status).toBe('rejected');
    expect(response.body.reason).toBe('signature_missing');
  });

  test('accepts unsigned webhook in development and processes normally', async () => {
    const { app, logger, whatsappService } = createTestApp({ env: 'development', appSecret: 'dev-secret' });
    const payload = buildPayload();

    const response = await request(app)
      .post('/api/webhook')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('received');

    await flushAsyncWork();
    expect(whatsappService.handleIncomingMessage).toHaveBeenCalledTimes(1);
    expectNoRawPhoneInLoggerMetadata(logger);
  });

  test('short-circuits duplicate inbound message deterministically', async () => {
    const { app, logger, dedup, whatsappService } = createTestApp({
      env: 'production',
      appSecret: 'prod-secret',
      claimResult: false,
    });

    const payload = buildPayload();
    const response = await request(app)
      .post('/api/webhook')
      .set('x-hub-signature-256', signatureFor(payload, 'prod-secret'))
      .send(payload);

    expect(response.status).toBe(200);

    await flushAsyncWork();

    expect(dedup.claimMessageProcessing).toHaveBeenCalledWith('meta:pnid-1:wamid-1');
    expect(whatsappService.handleIncomingMessage).not.toHaveBeenCalled();

    const summaryCall = logger.info.mock.calls.find(([message]) => message === 'Webhook processing summary');
    expect(summaryCall).toBeDefined();
    expect(summaryCall?.[1]?.summary?.outcomes?.[0]?.status).toBe('duplicate');
    expect(summaryCall?.[1]?.summary?.outcomes?.[0]?.reason).toBe('duplicate_message_id');
    expectNoRawPhoneInLoggerMetadata(logger);
  });

  test('records unsupported payload variants as skipped with clear reason', async () => {
    const { app, logger, whatsappService } = createTestApp({
      env: 'production',
      appSecret: 'prod-secret',
    });

    const payload = buildPayload({
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'pnid-1' },
                contacts: [{ profile: { name: 'A User' } }],
                messages: [
                  {
                    id: 'wamid-unsupported',
                    from: '919999999999',
                    type: 'image',
                    image: { id: 'media-1' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const response = await request(app)
      .post('/api/webhook')
      .set('x-hub-signature-256', signatureFor(payload, 'prod-secret'))
      .send(payload);

    expect(response.status).toBe(200);

    await flushAsyncWork();

    expect(whatsappService.handleIncomingMessage).not.toHaveBeenCalled();
    const summaryCall = logger.info.mock.calls.find(([message]) => message === 'Webhook processing summary');
    expect(summaryCall?.[1]?.summary?.outcomes?.[0]?.status).toBe('skipped');
    expect(summaryCall?.[1]?.summary?.outcomes?.[0]?.reason).toBe('unsupported_message_type');
    expectNoRawPhoneInLoggerMetadata(logger);
  });

  test('extracts and dispatches interactive button_reply payloads', async () => {
    const { app, logger, whatsappService } = createTestApp({
      env: 'production',
      appSecret: 'prod-secret',
    });

    const payload = buildPayload({
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'pnid-1' },
                contacts: [{ profile: { name: 'Button User' } }],
                messages: [
                  {
                    id: 'wamid-interactive-button-1',
                    from: '919999999998',
                    type: 'interactive',
                    interactive: {
                      button_reply: {
                        id: 'book-visit-prop-1',
                        title: 'Book Visit',
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const response = await request(app)
      .post('/api/webhook')
      .set('x-hub-signature-256', signatureFor(payload, 'prod-secret'))
      .send(payload);

    expect(response.status).toBe(200);

    await flushAsyncWork();

    expect(whatsappService.handleIncomingMessage).toHaveBeenCalledTimes(1);
    expect(whatsappService.handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: 'pnid-1',
        customerPhone: '+919999999998',
        customerName: 'Button User',
        messageId: 'wamid-interactive-button-1',
        messageText: 'Book Visit',
        interactiveId: 'book-visit-prop-1',
        interactiveType: 'button_reply',
      }),
    );
    expectNoRawPhoneInLoggerMetadata(logger);
  });

  test('extracts and dispatches interactive list_reply payloads using description text', async () => {
    const { app, logger, whatsappService } = createTestApp({
      env: 'production',
      appSecret: 'prod-secret',
    });

    const payload = buildPayload({
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'pnid-1' },
                contacts: [{ profile: { name: 'List User' } }],
                messages: [
                  {
                    id: 'wamid-interactive-list-1',
                    from: '919999999997',
                    type: 'interactive',
                    interactive: {
                      list_reply: {
                        id: 'filter-2bhk',
                        title: '2 BHK',
                        description: '2 BHK in Whitefield',
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const response = await request(app)
      .post('/api/webhook')
      .set('x-hub-signature-256', signatureFor(payload, 'prod-secret'))
      .send(payload);

    expect(response.status).toBe(200);

    await flushAsyncWork();

    expect(whatsappService.handleIncomingMessage).toHaveBeenCalledTimes(1);
    expect(whatsappService.handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: 'pnid-1',
        customerPhone: '+919999999997',
        customerName: 'List User',
        messageId: 'wamid-interactive-list-1',
        messageText: '2 BHK in Whitefield',
        interactiveId: 'filter-2bhk',
        interactiveType: 'list_reply',
      }),
    );
    expectNoRawPhoneInLoggerMetadata(logger);
  });

  test('releases dedup claim when downstream processing fails', async () => {
    const { app, dedup, logger } = createTestApp({
      env: 'production',
      appSecret: 'prod-secret',
      serviceStatus: 'failed',
      propagationStatus: 'failed',
    });

    const payload = buildPayload();
    const response = await request(app)
      .post('/api/webhook')
      .set('x-hub-signature-256', signatureFor(payload, 'prod-secret'))
      .send(payload);

    expect(response.status).toBe(200);

    await flushAsyncWork();

    expect(dedup.release).toHaveBeenCalledWith('meta:pnid-1:wamid-1');

    const summaryCall = logger.info.mock.calls.find(([message]) => message === 'Webhook processing summary');
    expect(summaryCall?.[1]?.summary?.outcomes?.[0]?.status).toBe('failed');
    expect(summaryCall?.[1]?.summary?.outcomes?.[0]?.propagationStatus).toBe('failed');
    expectNoRawPhoneInLoggerMetadata(logger);
  });

  test('blocks /api/webhook/test in production', async () => {
    const { app } = createTestApp({ env: 'production', appSecret: 'prod-secret' });

    const response = await request(app)
      .post('/api/webhook/test')
      .send({ phone: '+911234567890', message: 'hello' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Test endpoint only available in development');
  });

  test('returns 400 for missing fields on /api/webhook/test in development (body parsed)', async () => {
    const { app } = createTestApp({ env: 'development', appSecret: 'dev-secret' });

    const response = await request(app)
      .post('/api/webhook/test')
      .send({ message: 'hello' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('phone and message are required');
  });
});
