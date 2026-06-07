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

jest.mock('../../services/opsMetrics.service', () => ({
  getOpsMetricsSnapshot: jest.fn().mockResolvedValue({
    uptime_seconds: 100,
    counters: { http_requests: 1 },
    timestamp: new Date().toISOString(),
  }),
}));

import request from 'supertest';
import express from 'express';
import healthRoutes from '../../routes/health.routes';

describe('production polish health', () => {
  const app = express();
  app.use('/api/health', healthRoutes);

  it('public /api/health returns minimal dependency shape (no ops_metrics)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
    expect(res.body.dependencies?.db?.status).toBe('ok');
    expect(res.body.ops_metrics).toBeUndefined();
    expect(res.body.production_polish).toBeUndefined();
  });

  it('internal /api/health/internal exposes production_polish pillars and ops_metrics', async () => {
    const res = await request(app).get('/api/health/internal');
    expect(res.status).toBe(200);
    expect(res.body.production_polish?.error_handling?.status).toBe('ready');
    expect(res.body.production_polish?.user_experience?.status).toBe('ready');
    expect(res.body.ops_metrics?.counters).toBeDefined();
  });

  it('internal health exposes zero_ui and enterprise_hardening proof blocks', async () => {
    const res = await request(app).get('/api/health/internal');
    expect(res.body.zero_ui?.buyer?.channel).toBe('whatsapp');
    expect(res.body.zero_ui?.staff?.whatsapp_copilot).toBe(true);
    expect(res.body.agent_ai?.copilot_enabled).toBe(true);
    expect(res.body.enterprise_hardening?.buyer_llm_temperature).toBe(0);
    expect(res.body.enterprise_hardening?.mutation_confidence_threshold).toBe(0.8);
  });
});
