/// <reference types="jest" />

import express, { Express } from 'express';
import request from 'supertest';

jest.mock('../../services/propertyKnowledge.service', () => ({
  getPropertyKnowledgeEmbeddingHealth: jest.fn().mockResolvedValue({
    status: 'ok',
    provider: 'openai',
    detail: 'ok',
  }),
}));

jest.mock('../../services/openaiStatus.service', () => ({
  getOpenAiServiceHealth: jest.fn().mockResolvedValue({
    status: 'ok',
    configured: true,
    detail: 'OpenAI ok',
  }),
}));

jest.mock('../../services/mailHealth.service', () => ({
  getMailServiceHealth: jest.fn().mockResolvedValue({
    status: 'warn',
    configured: false,
    detail: 'SMTP not configured in test',
  }),
}));

jest.mock('../../services/storage.service', () => ({
  isAwsStorageConfigured: () => false,
  isR2StorageConfigured: () => false,
}));

jest.mock('../../services/supabaseStorage.service', () => ({
  isSupabaseStorageConfigured: () => false,
}));

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
      storage: { provider: 'aws' },
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

  jest.doMock('../../middleware/auth', () => ({
    __esModule: true,
    authenticate: (req: any, _res: any, next: any) => {
      const role = req.header('x-test-role') || 'company_admin';
      req.user = {
        id: `${role}-user`,
        company_id: role === 'super_admin' ? 'platform-company' : 'tenant-company',
        companyId: role === 'super_admin' ? 'platform-company' : 'tenant-company',
        role,
        email: `${role}@investo.test`,
        name: role,
      };
      next();
    },
  }));

  jest.doMock('../../middleware/rbac', () => ({
    __esModule: true,
    hasRole: (...roles: string[]) => (req: any, res: any, next: any) => {
      if (roles.includes(req.user?.role)) {
        next();
        return;
      }
      res.status(403).json({ error: 'Insufficient role' });
    },
  }));

  jest.doMock('../../services/platformRuntime.service', () => ({
    __esModule: true,
    getPlatformRedisStatus: jest.fn().mockResolvedValue('ok'),
  }));

  let router: express.Router;
  jest.isolateModules(() => {
    router = require('../../routes/health.routes').default;
  });

  const app = express();
  app.use('/api/health', router!);
  return { app, mockPrisma };
}

describe('GET /api/health', () => {
  afterEach(() => {
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
    expect(response.body.dependencies?.property_knowledge_embeddings).toEqual({
      status: 'ok',
      provider: 'openai',
      detail: 'ok',
    });
    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  test('returns 200 degraded with db_unreachable when Prisma ping fails', async () => {
    const { app } = createHealthApp('fail');

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('degraded');
    expect(response.body.error).toBe('db_unreachable');
    expect(response.body.dependencies?.db?.status).toBe('down');
    expect(response.body).not.toHaveProperty('message');
  });

  test('enterprise baseline is super-admin only and scores all domains', async () => {
    const { app } = createHealthApp('ok');

    await request(app).get('/api/health/enterprise').set('x-test-role', 'company_admin').expect(403);

    const response = await request(app).get('/api/health/enterprise').set('x-test-role', 'super_admin').expect(200);

    expect(response.body.baseline_version).toBe('chunk-01');
    expect(response.body.domains).toHaveLength(12);
    expect(response.body.redis_status).toBe('ok');
    expect(response.body.overall_score).toBeGreaterThan(0);
  });
});
