/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

function createSanitizeApp(): Express {
  jest.resetModules();

  let sanitizeInput: any;
  jest.isolateModules(() => {
    sanitizeInput = require('../../middleware/sanitizeInput').sanitizeInput;
  });

  const app = express();
  app.use(express.json());
  app.use(sanitizeInput);
  app.post('/api/leads', (req, res) => {
    res.json({ body: req.body });
  });
  app.post('/api/webhook/whatsapp', (req, res) => {
    res.json({ body: req.body });
  });

  return app;
}

describe('sanitizeInput middleware', () => {
  afterEach(() => {
    jest.resetModules();
  });

  test('strips script tags from nested string fields', async () => {
    const app = createSanitizeApp();
    const response = await request(app)
      .post('/api/leads')
      .send({
        customer_name: '<script>alert(1)</script>Jane',
        notes: '<img src=x onerror=alert(1)> hello',
        tags: ['<b>vip</b>', 'warm'],
        nested: { detail: '<iframe src="evil"></iframe>ok' },
      });

    expect(response.status).toBe(200);
    expect(response.body.body.customer_name).toBe('Jane');
    expect(response.body.body.notes).toBe('hello');
    expect(response.body.body.tags).toEqual(['vip', 'warm']);
    expect(response.body.body.nested.detail).toBe('ok');
  });

  test('preserves non-string values', async () => {
    const app = createSanitizeApp();
    const response = await request(app)
      .post('/api/leads')
      .send({
        budget_min: 1000,
        active: true,
        metadata: null,
      });

    expect(response.status).toBe(200);
    expect(response.body.body).toEqual({
      budget_min: 1000,
      active: true,
      metadata: null,
    });
  });

  test('skips sanitization for webhook routes', async () => {
    const app = createSanitizeApp();
    const payload = { text: '<script>keep-me</script>' };
    const response = await request(app)
      .post('/api/webhook/whatsapp')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.body.text).toBe('<script>keep-me</script>');
  });
});
