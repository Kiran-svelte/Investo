jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: { $queryRaw: jest.fn().mockResolvedValue([1]) },
}));

jest.mock('../../services/propertyKnowledge.service', () => ({
  getPropertyKnowledgeEmbeddingHealth: jest.fn().mockResolvedValue({ status: 'ok' }),
}));

jest.mock('../../services/openaiStatus.service', () => ({
  getOpenAiServiceHealth: jest.fn().mockResolvedValue({ status: 'ok', configured: true, detail: 'ok' }),
}));

jest.mock('../../services/mailHealth.service', () => ({
  getMailServiceHealth: jest.fn().mockResolvedValue({ status: 'ok', configured: false, detail: 'n/a' }),
}));

jest.mock('../../services/storage.service', () => ({
  isAwsStorageConfigured: jest.fn(() => false),
  isR2StorageConfigured: jest.fn(() => false),
}));

jest.mock('../../services/supabaseStorage.service', () => ({
  isSupabaseStorageConfigured: jest.fn(() => false),
}));

import request from 'supertest';
import express from 'express';
import healthRoutes from '../../routes/health.routes';

describe('production polish health', () => {
  const app = express();
  app.use('/api/health', healthRoutes);

  it('exposes production_polish pillars and ops_metrics', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.production_polish?.error_handling?.status).toBe('ready');
    expect(res.body.production_polish?.user_experience?.status).toBe('ready');
    expect(res.body.ops_metrics?.counters).toBeDefined();
  });
});
