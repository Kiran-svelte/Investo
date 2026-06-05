/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

function createMetricsApp(): Express {
  jest.resetModules();

  let metricsRoutes: unknown;
  jest.isolateModules(() => {
    metricsRoutes = require('../../routes/metrics.routes').default;
  });

  const app = express();
  app.use('/api/metrics', metricsRoutes as any);
  return app;
}

describe('metrics routes', () => {
  afterEach(() => {
    jest.resetModules();
  });

  test('GET /api/metrics returns Prometheus text format', async () => {
    const app = createMetricsApp();
    const response = await request(app).get('/api/metrics');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('investo_http_request_duration_ms');
    expect(response.text).toContain('investo_http_requests_total');
  });
});
