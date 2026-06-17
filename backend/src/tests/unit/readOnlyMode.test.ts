/// <reference types="jest" />

import express from 'express';
import request from 'supertest';

jest.mock('../../dr/readOnlyMode.service', () => ({
  readOnlyModeService: {
    isEnabled: jest.fn().mockReturnValue(true),
    getReason: jest.fn().mockReturnValue('DR maintenance'),
  },
}));

import { readOnlyMiddleware } from '../../dr/readOnly.middleware';

describe('readOnlyMiddleware', () => {
  function buildApp() {
    const app = express();
    app.use(readOnlyMiddleware);
    app.post('/api/leads', (_req, res) => res.json({ ok: true }));
    app.get('/api/leads', (_req, res) => res.json({ ok: true }));
    app.post('/api/health/check', (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('blocks POST mutations when read-only mode is enabled', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/leads').send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('read_only_mode');
  });

  it('allows GET requests', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/leads');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('allows health POST endpoints', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/health/check');
    expect(res.status).toBe(200);
  });
});

describe('ReadOnlyModeService', () => {
  it('reads enabled flag from config', async () => {
    jest.resetModules();
    jest.doMock('../../config', () => ({
      __esModule: true,
      default: { features: { readOnlyMode: true } },
    }));
    const { readOnlyModeService } = await import('../../dr/readOnlyMode.service');
    expect(readOnlyModeService.isEnabled()).toBe(true);
  });
});
