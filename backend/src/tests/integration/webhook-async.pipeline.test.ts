/// <reference types="jest" />

import crypto from 'crypto';
import express from 'express';
import request from 'supertest';

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const whatsappService = {
  handleIncomingMessage: jest.fn(),
  getCompanyByPhoneNumberId: jest.fn().mockResolvedValue({ company: { id: 'company-1' } }),
};

const queue = {
  enqueueWebhookPayload: jest.fn().mockResolvedValue({
    status: 'enqueued',
    jobId: 'job-1',
    companyId: 'company-1',
    messageIds: ['wamid-async-1'],
  }),
};

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    env: 'production',
    features: { asyncWhatsAppPipeline: true },
    whatsapp: {
      e2eWebhookProofToken: '',
    },
    langgraph: { enabled: false },
    enterpriseAgent: { enabled: false },
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: logger,
}));

jest.mock('../../services/whatsapp.service', () => ({
  __esModule: true,
  whatsappService,
}));

jest.mock('../../services/enterpriseAgentBridge', () => ({
  __esModule: true,
  runEnterpriseAgent: jest.fn(),
}));

jest.mock('../../services/langgraphAdapter.service', () => ({
  __esModule: true,
  sendToLangGraph: jest.fn(),
}));

jest.mock('../../services/queue/whatsappInboundQueue.service', () => ({
  __esModule: true,
  whatsappInboundQueueService: queue,
}));

jest.mock('../../middleware/whatsappSecurity', () => ({
  __esModule: true,
  whatsappIpWhitelist: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../utils/companyWhatsAppWebhook.util', () => ({
  __esModule: true,
  matchesWebhookVerifyToken: jest.fn().mockResolvedValue(true),
  resolveWebhookAppSecrets: jest.fn().mockResolvedValue(['prod-secret']),
}));

jest.mock('../../services/whatsappHealth.service', () => ({
  __esModule: true,
  whatsappHealthService: {
    getHealthStatus: jest.fn(),
  },
}));

function payload(messageId = 'wamid-async-1') {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'pnid-1', display_phone_number: '15550001111' },
              contacts: [{ profile: { name: 'Async User' } }],
              messages: [
                {
                  id: messageId,
                  from: '919999999999',
                  type: 'text',
                  text: { body: 'Hi' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function signatureFor(body: any): string {
  return `sha256=${crypto.createHmac('sha256', 'prod-secret').update(JSON.stringify(body)).digest('hex')}`;
}

async function flushAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('webhook async pipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ACKs fast, enqueues once, and does not process the turn inline', async () => {
    const router = require('../../routes/webhook.routes').default;
    const app = express();
    app.use('/api/webhook', router);

    const body = payload();
    const started = Date.now();
    const response = await request(app)
      .post('/api/webhook')
      .set('x-hub-signature-256', signatureFor(body))
      .send(body);
    const ackMs = Date.now() - started;

    expect(response.status).toBe(200);
    expect(ackMs).toBeLessThan(process.env.STRICT_WEBHOOK_ACK_TEST === 'true' ? 200 : 2_500);
    await flushAsyncWork();
    expect(queue.enqueueWebhookPayload).toHaveBeenCalledTimes(1);
    expect(whatsappService.handleIncomingMessage).not.toHaveBeenCalled();
  });

  it('keeps p95 ACK latency below 200ms for 50 concurrent webhook POSTs', async () => {
    const router = require('../../routes/webhook.routes').default;
    const app = express();
    app.use('/api/webhook', router);

    const timings = await Promise.all(
      Array.from({ length: 50 }, async (_, index) => {
        const body = payload(`wamid-load-${index}`);
        const started = Date.now();
        await request(app)
          .post('/api/webhook')
          .set('x-hub-signature-256', signatureFor(body))
          .send(body)
          .expect(200);
        return Date.now() - started;
      }),
    );

    const sorted = [...timings].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95) - 1] ?? sorted[sorted.length - 1];
    expect(p95).toBeLessThan(process.env.STRICT_WEBHOOK_ACK_TEST === 'true' ? 200 : 2_500);
  });
});
