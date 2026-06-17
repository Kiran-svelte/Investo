/// <reference types="jest" />

const recordHttpRequestMetrics = jest.fn();
const recordWebhookAckMetrics = jest.fn();

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    observability: { metricsEnabled: true },
    features: { prometheusMetrics: true },
  },
}));

jest.mock('../../services/prometheusMetrics.service', () => ({
  recordHttpRequestMetrics,
  recordWebhookAckMetrics,
}));

import express from 'express';
import request from 'supertest';
import { hashCompanyId, metricsMiddleware } from '../../middleware/metricsMiddleware';

describe('metricsMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hashes company ids for low-cardinality prometheus labels', () => {
    expect(hashCompanyId(null)).toBe('public');
    expect(hashCompanyId('company-123')).toHaveLength(12);
    expect(hashCompanyId('company-123')).not.toBe('company-123');
  });

  it('records HTTP metrics with company_id_hash on response finish', async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as express.Request & { user?: { company_id: string } }).user = { company_id: 'tenant-a' };
      next();
    });
    app.use(metricsMiddleware);
    app.get('/api/leads', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    await request(app).get('/api/leads').expect(200);

    expect(recordHttpRequestMetrics).toHaveBeenCalledWith(
      'GET',
      '/api/leads',
      200,
      expect.any(Number),
      hashCompanyId('tenant-a'),
    );
  });

  it('records webhook ACK metrics for POST /api/webhook', async () => {
    const app = express();
    app.use(metricsMiddleware);
    app.post('/api/webhook', (_req, res) => {
      res.sendStatus(200);
    });

    await request(app).post('/api/webhook').expect(200);

    expect(recordWebhookAckMetrics).toHaveBeenCalledWith(200, expect.any(Number));
  });
});
