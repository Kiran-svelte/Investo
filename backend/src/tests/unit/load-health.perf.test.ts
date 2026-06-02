/// <reference types="jest" />
import express, { Express } from 'express';
import request from 'supertest';

function createHealthApp(): Express {
  jest.resetModules();
  const mockPrisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
  jest.doMock('../../config/prisma', () => ({ __esModule: true, default: mockPrisma }));
  jest.doMock('../../config', () => ({ __esModule: true, default: { env: 'test' } }));
  jest.doMock('../../config/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  }));
  let router: any;
  jest.isolateModules(() => {
    router = require('../../routes/health.routes').default;
  });
  const app = express();
  app.use('/api/health', router);
  return app;
}

describe('load/performance smoke (health)', () => {
  test('50 sequential health checks stay under latency budget', async () => {
    const app = createHealthApp();
    const times: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = Date.now();
      await request(app).get('/api/health').expect(200);
      times.push(Date.now() - t0);
    }
    const sorted = [...times].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    expect(p95).toBeLessThan(500);
  });
});
