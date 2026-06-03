import { Router, Request, Response } from 'express';
import config from '../config';
import logger from '../config/logger';
import prisma from '../config/prisma';
import { isAwsStorageConfigured, isR2StorageConfigured } from '../services/storage.service';
import { isSupabaseStorageConfigured } from '../services/supabaseStorage.service';
import { getPropertyKnowledgeEmbeddingHealth } from '../services/propertyKnowledge.service';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    const propertyKnowledgeEmbeddings = await getPropertyKnowledgeEmbeddingHealth();

    res.status(200).json({
      status: propertyKnowledgeEmbeddings.status === 'ok' ? 'ok' : 'degraded',
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
        property_knowledge_embeddings: propertyKnowledgeEmbeddings,
      },
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
