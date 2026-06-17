/// <reference types="jest" />

import crypto from 'crypto';

jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn().mockResolvedValue({ status: 200 }) },
}));

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    webhookSubscription: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'sub-1',
          companyId: 'co-1',
          url: 'https://example.com/hook',
          events: ['lead.created'],
          active: true,
        },
      ]),
    },
  },
}));

jest.mock('../../config', () => ({
  __esModule: true,
  default: { features: { publicApi: true } },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import axios from 'axios';
import { webhookSubscriptionService } from '../../publicApi/webhookSubscription.service';

describe('publicWebhook dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('signs payload with HMAC-SHA256', () => {
    const secret = 'test-secret';
    const body = JSON.stringify({ event: 'lead.created' });
    const timestamp = 1_700_000_000;
    const signature = webhookSubscriptionService.signPayload(secret, body, timestamp);
    const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    expect(signature).toBe(expected);
  });

  it('dispatches to active subscriptions', async () => {
    await webhookSubscriptionService.dispatch('co-1', 'lead.created', { id: 'lead-1' }, 'test-secret');
    expect(axios.post).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Investo-Event': 'lead.created',
          'X-Investo-Signature': expect.any(String),
        }),
      }),
    );
  });
});
