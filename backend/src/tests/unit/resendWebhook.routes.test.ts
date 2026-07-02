/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

function createResendWebhookApp(overrides: { verify?: jest.Mock; apply?: jest.Mock } = {}): {
  app: Express;
  verify: jest.Mock;
  apply: jest.Mock;
} {
  jest.resetModules();
  process.env.RESEND_WEBHOOK_SECRET = 'whsec_test';

  const verify = overrides.verify ?? jest.fn().mockReturnValue({
    type: 'email.delivered',
    data: { email_id: 'email-1' },
  });
  const apply = overrides.apply ?? jest.fn().mockResolvedValue({
    status: 'updated',
    inviteId: 'invite-1',
    emailId: 'email-1',
    deliveryStatus: 'delivered',
  });

  jest.doMock('svix', () => ({
    __esModule: true,
    Webhook: jest.fn().mockImplementation(() => ({ verify })),
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

  jest.doMock('../../services/resendWebhook.service', () => ({
    __esModule: true,
    applyResendEmailEventToAgencyInvite: apply,
  }));

  let resendWebhookRoutes: any;
  jest.isolateModules(() => {
    resendWebhookRoutes = require('../../routes/resendWebhook.routes').default;
  });

  const app = express();
  app.use('/api/webhooks/resend', resendWebhookRoutes);
  return { app, verify, apply };
}

describe('resend webhook route', () => {
  afterEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('verifies raw Resend webhook payload and applies event', async () => {
    const { app, verify, apply } = createResendWebhookApp();
    const payload = JSON.stringify({
      type: 'email.delivered',
      data: { email_id: 'email-1' },
    });

    const response = await request(app)
      .post('/api/webhooks/resend')
      .set('Content-Type', 'application/json')
      .set('svix-id', 'svix-1')
      .set('svix-timestamp', '1782496800')
      .set('svix-signature', 'v1,test')
      .send(payload);

    expect(response.status).toBe(200);
    expect(verify).toHaveBeenCalledWith(payload, {
      'svix-id': 'svix-1',
      'svix-timestamp': '1782496800',
      'svix-signature': 'v1,test',
    });
    expect(apply).toHaveBeenCalledWith(
      { type: 'email.delivered', data: { email_id: 'email-1' } },
      'svix-1',
    );
    expect(response.body).toEqual({
      ok: true,
      result: {
        status: 'updated',
        inviteId: 'invite-1',
        emailId: 'email-1',
        deliveryStatus: 'delivered',
      },
    });
  });

  test('rejects webhook requests missing Svix signature headers', async () => {
    const { app, apply } = createResendWebhookApp();

    const response = await request(app)
      .post('/api/webhooks/resend')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'email.delivered' }));

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid webhook' });
    expect(apply).not.toHaveBeenCalled();
  });
});
