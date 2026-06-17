/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    features: { securityHeadersStrict: true },
  },
}));

import express from 'express';
import request from 'supertest';
import { securityHeadersMiddleware } from '../../middleware/securityHeaders';

describe('securityHeaders middleware', () => {
  it('sets CSP and HSTS headers when strict mode enabled', async () => {
    const app = express();
    app.use(securityHeadersMiddleware);
    app.get('/health', (_req, res) => res.json({ ok: true }));

    const response = await request(app).get('/health');
    expect(response.headers['content-security-policy']).toBeDefined();
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['x-frame-options']).toBeDefined();
  });
});
