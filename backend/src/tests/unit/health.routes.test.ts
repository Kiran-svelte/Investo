/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

type MockPrisma = {
  $queryRaw: jest.Mock;
};

function createHealthApp(prismaBehavior: 'ok' | 'fail'): { app: Express; mockPrisma: MockPrisma } {
  jest.resetModules();

  const mockPrisma: MockPrisma = {
    $queryRaw: jest.fn(),
  };

  if (prismaBehavior === 'ok') {
    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  } else {
    mockPrisma.$queryRaw.mockRejectedValue(new Error('DB is down'));
  }

  jest.doMock('../../config/prisma', () => ({
    __esModule: true,
    default: mockPrisma,
  }));

  jest.doMock('../../config', () => ({
    __esModule: true,
    default: {
      env: 'test',
    },
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

  let router: any;
  jest.isolateModules(() => {
    router = require('../../routes/health.routes').default;
  });

  const app = express();
  app.use('/api/health', router);
  return { app, mockPrisma };
}

describe('GET /api/health', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('returns 200 with db ok when Prisma ping succeeds', async () => {
    const { app, mockPrisma } = createHealthApp('ok');

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.environment).toBe('test');
    expect(response.body.dependencies?.db?.status).toBe('ok');
    expect(typeof response.body.dependencies?.db?.latency_ms).toBe('number');
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  test('returns 503 with db_unreachable when Prisma ping fails', async () => {
    const { app } = createHealthApp('fail');

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('error');
    expect(response.body.error).toBe('db_unreachable');
    expect(response.body.dependencies?.db?.status).toBe('down');
    expect(response.body).not.toHaveProperty('message');
  });
});
