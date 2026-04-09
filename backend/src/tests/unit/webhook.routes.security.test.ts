/// <reference types="jest" />

import crypto from 'crypto';
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

function createWebhookApp(env: {
  nodeEnv: 'production' | 'development' | 'test';
  verifyToken: string;
  appSecret?: string;
  ipWhitelistEnabled?: boolean;
}): { app: Express } {
  jest.resetModules();
  restoreEnv();

  process.env.NODE_ENV = env.nodeEnv;
  process.env.WHATSAPP_VERIFY_TOKEN = env.verifyToken;

  if (env.appSecret === undefined) {
    delete process.env.WHATSAPP_APP_SECRET;
  } else {
    process.env.WHATSAPP_APP_SECRET = env.appSecret;
  }

  if (env.ipWhitelistEnabled === undefined) {
    delete process.env.WHATSAPP_IP_WHITELIST_ENABLED;
  } else {
    process.env.WHATSAPP_IP_WHITELIST_ENABLED = env.ipWhitelistEnabled ? 'true' : 'false';
  }

  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  }));

  // Avoid loading the real WhatsApp services (which pull in Prisma and other heavy deps).
  jest.doMock('../../services/whatsapp.service', () => ({
    __esModule: true,
    whatsappService: {
      handleIncomingMessage: jest.fn().mockResolvedValue({
        status: 'skipped',
        reason: 'test_stub',
        propagation: { status: 'not_attempted' },
      }),
      getCompanyByPhoneNumberId: jest.fn().mockResolvedValue(null),
    },
  }));

  jest.doMock('../../services/deduplication.service', () => ({
    __esModule: true,
    deduplicationService: {
      claimMessageProcessing: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    },
  }));

  jest.doMock('../../services/whatsappHealth.service', () => ({
    __esModule: true,
    whatsappHealthService: {
      getHealthStatus: jest.fn().mockResolvedValue({ status: 'ok' }),
    },
  }));

  let router: any;
  jest.isolateModules(() => {
    router = require('../../routes/webhook.routes').default;
  });

  const app = express();
  app.use('/api/webhook', router);
  return { app };
}

describe('WhatsApp webhook security (production)', () => {
  afterEach(() => {
    restoreEnv();
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('GET verification echoes challenge when token matches and IP is allowed', async () => {
    const { app } = createWebhookApp({
      nodeEnv: 'production',
      verifyToken: 'verify-123',
      appSecret: 'app-secret',
      ipWhitelistEnabled: true,
    });

    const response = await request(app)
      .get('/api/webhook')
      .set('x-forwarded-for', '173.252.96.1')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'verify-123',
        'hub.challenge': 'challenge-abc',
      });

    expect(response.status).toBe(200);
    expect(response.text).toBe('challenge-abc');
  });

  test('GET verification rejects when token mismatches (even from allowed IP)', async () => {
    const { app } = createWebhookApp({
      nodeEnv: 'production',
      verifyToken: 'verify-123',
      appSecret: 'app-secret',
      ipWhitelistEnabled: true,
    });

    const response = await request(app)
      .get('/api/webhook')
      .set('x-forwarded-for', '173.252.96.1')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'challenge-abc',
      });

    expect(response.status).toBe(403);
    expect(response.body?.error).toBe('Webhook verification failed');
  });

  test('GET verification is blocked by IP whitelist when enabled', async () => {
    const { app } = createWebhookApp({
      nodeEnv: 'production',
      verifyToken: 'verify-123',
      appSecret: 'app-secret',
      ipWhitelistEnabled: true,
    });

    const response = await request(app)
      .get('/api/webhook')
      .set('x-forwarded-for', '1.2.3.4')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'verify-123',
        'hub.challenge': 'challenge-abc',
      });

    expect(response.status).toBe(403);
    expect(response.body?.error).toBe('Access denied');
  });

  test('POST accepts valid signature computed over raw JSON body (whitespace tolerant)', async () => {
    const secret = 'app-secret';
    const { app } = createWebhookApp({
      nodeEnv: 'production',
      verifyToken: 'verify-123',
      appSecret: secret,
      ipWhitelistEnabled: true,
    });

    const payload = {
      object: 'whatsapp_business_account',
      entry: [],
    };

    // Intentionally include whitespace/newlines to ensure verification uses raw body bytes.
    const rawJson = JSON.stringify(payload, null, 2);
    const signature =
      'sha256=' + crypto.createHmac('sha256', secret).update(rawJson).digest('hex');

    const response = await request(app)
      .post('/api/webhook')
      .set('x-forwarded-for', '173.252.96.1')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(rawJson);

    expect(response.status).toBe(200);
    expect(response.body?.status).toBe('received');
  });

  test('POST rejects invalid signature in production', async () => {
    const secret = 'app-secret';
    const { app } = createWebhookApp({
      nodeEnv: 'production',
      verifyToken: 'verify-123',
      appSecret: secret,
      ipWhitelistEnabled: true,
    });

    const payload = { object: 'whatsapp_business_account', entry: [] };
    const rawJson = JSON.stringify(payload);
    const invalidSignature = 'sha256=' + '0'.repeat(64);

    const response = await request(app)
      .post('/api/webhook')
      .set('x-forwarded-for', '173.252.96.1')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', invalidSignature)
      .send(rawJson);

    expect(response.status).toBe(403);
    expect(response.body?.status).toBe('rejected');
    expect(response.body?.reason).toBe('signature_mismatch');
  });

  test('POST rejects missing signature in production', async () => {
    const { app } = createWebhookApp({
      nodeEnv: 'production',
      verifyToken: 'verify-123',
      appSecret: 'app-secret',
      ipWhitelistEnabled: true,
    });

    const rawJson = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

    const response = await request(app)
      .post('/api/webhook')
      .set('x-forwarded-for', '173.252.96.1')
      .set('Content-Type', 'application/json')
      .send(rawJson);

    expect(response.status).toBe(403);
    expect(response.body?.status).toBe('rejected');
    expect(response.body?.reason).toBe('signature_missing');
  });

  test('POST rejects when WHATSAPP_APP_SECRET is missing in production', async () => {
    const { app } = createWebhookApp({
      nodeEnv: 'production',
      verifyToken: 'verify-123',
      appSecret: '',
      ipWhitelistEnabled: true,
    });

    const rawJson = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

    const response = await request(app)
      .post('/api/webhook')
      .set('x-forwarded-for', '173.252.96.1')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=' + '0'.repeat(64))
      .send(rawJson);

    expect(response.status).toBe(403);
    expect(response.body?.status).toBe('rejected');
    expect(response.body?.reason).toBe('app_secret_missing');
  });
});
