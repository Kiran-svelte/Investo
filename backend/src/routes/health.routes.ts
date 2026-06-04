import { Router, Request, Response } from 'express';
import config from '../config';
import logger from '../config/logger';
import prisma from '../config/prisma';
import { isAwsStorageConfigured, isR2StorageConfigured } from '../services/storage.service';
import { isSupabaseStorageConfigured } from '../services/supabaseStorage.service';
import { getMailServiceHealth } from '../services/mailHealth.service';
import { getOpenAiServiceHealth } from '../services/openaiStatus.service';
import { getPropertyKnowledgeEmbeddingHealth } from '../services/propertyKnowledge.service';
import { AI_STACK_CAPABILITIES } from '../constants/ai-capabilities.constants';
import { PRODUCTION_POLISH_PILLARS } from '../constants/production-polish.constants';
import { getOpsMetricsSnapshot } from '../services/opsMetrics.service';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    const [propertyKnowledgeEmbeddings, openai, mail] = await Promise.all([
      getPropertyKnowledgeEmbeddingHealth(),
      getOpenAiServiceHealth(),
      getMailServiceHealth(),
    ]);

    const openAiBlocks = openai.status === 'down';
    const overallOk = propertyKnowledgeEmbeddings.status !== 'error' && !openAiBlocks;

    res.status(200).json({
      status: overallOk ? (openai.status === 'degraded' || propertyKnowledgeEmbeddings.status === 'degraded' ? 'degraded' : 'ok') : 'degraded',
      timestamp: new Date().toISOString(),
      environment: config.env,
      dependencies: {
        db: {
          status: 'ok',
          latency_ms: Date.now() - startedAt,
        },
        storage: {
          aws_s3: isAwsStorageConfigured(),
          r2: isR2StorageConfigured(),
          supabase: isSupabaseStorageConfigured(),
          provider: config.storage.provider,
        },
        openai,
        mail,
        property_knowledge_embeddings: propertyKnowledgeEmbeddings,
      },
      ai_capabilities: AI_STACK_CAPABILITIES,
      agent_ai_enabled: Boolean(config.agentAi?.enabled),
      production_polish: PRODUCTION_POLISH_PILLARS,
      ops_metrics: await getOpsMetricsSnapshot(),
    });
  } catch (err: any) {
    logger.error('Health check failed', { error: err.message });

    // Render health checks require HTTP 200; report degraded state in JSON.
    res.status(200).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      environment: config.env,
      dependencies: {
        db: {
          status: 'down',
          latency_ms: null,
        },
      },
      error: 'db_unreachable',
    });
  }
});

export default router;
