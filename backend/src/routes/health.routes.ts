import { Router, Request, Response } from 'express';
import config from '../config';
import logger from '../config/logger';
import prisma from '../config/prisma';
import { isAwsStorageConfigured, isR2StorageConfigured } from '../services/storage.service';
import { isSupabaseStorageConfigured } from '../services/supabaseStorage.service';

const router = Router();

async function checkOpenAiEmbeddings(): Promise<{ status: string; detail?: string }> {
  const key = config.ai.openaiApiKey?.trim();
  if (!key) {
    return { status: 'not_configured', detail: 'OPENAI_API_KEY missing' };
  }
  if (!key.startsWith('sk-')) {
    return { status: 'invalid', detail: 'OPENAI_API_KEY format invalid' };
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
        input: 'health',
      }),
    });
    if (response.ok) {
      return { status: 'ok' };
    }
    if (response.status === 401) {
      return { status: 'invalid_key', detail: 'OpenAI rejected the API key — create a new key and update Render' };
    }
    return { status: 'error', detail: `OpenAI HTTP ${response.status}` };
  } catch (err: unknown) {
    return {
      status: 'error',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

router.get('/', async (_req: Request, res: Response) => {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    const openai = await checkOpenAiEmbeddings();

    res.status(200).json({
      status: openai.status === 'ok' ? 'ok' : 'degraded',
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
        openai_embeddings: openai,
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
