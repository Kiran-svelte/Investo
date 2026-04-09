/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

type LoggerMock = {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
};

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

function createSecurityApp(params: {
  env: string;
  whitelistEnabled: boolean;
  skipIpWhitelist?: boolean;
}): {
  app: Express;
  logger: LoggerMock;
} {
  jest.resetModules();
  restoreEnv();

  process.env.NODE_ENV = params.env;

  const logger: LoggerMock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  jest.doMock('../../config', () => ({
    __esModule: true,
    default: {
      env: params.env,
      whatsapp: {
        ipWhitelistEnabled: params.whitelistEnabled,
        skipIpWhitelist: params.skipIpWhitelist === true,
      },
    },
  }));

  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: logger,
  }));

  let whatsappIpWhitelist: any;
  jest.isolateModules(() => {
    whatsappIpWhitelist = require('../../middleware/whatsappSecurity').whatsappIpWhitelist;
  });

  const app = express();
  app.use('/api/webhook', whatsappIpWhitelist, (_req, res) => {
    res.status(200).json({ ok: true });
  });

  return { app, logger };
}

describe('WhatsApp security middleware', () => {
  afterEach(() => {
    restoreEnv();
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('allows localhost in non-production when whitelist is enabled', async () => {
    const { app } = createSecurityApp({ env: 'development', whitelistEnabled: true });

    const response = await request(app)
      .get('/api/webhook')
      .set('x-forwarded-for', '127.0.0.1');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  test('blocks localhost in production when not in Meta IP ranges', async () => {
    const { app } = createSecurityApp({ env: 'production', whitelistEnabled: true });

    const response = await request(app)
      .get('/api/webhook')
      .set('x-forwarded-for', '127.0.0.1');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Access denied');
  });

  test('allows known Meta IP in production', async () => {
    const { app } = createSecurityApp({ env: 'production', whitelistEnabled: true });

    const response = await request(app)
      .get('/api/webhook')
      .set('x-forwarded-for', '173.252.96.10');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
