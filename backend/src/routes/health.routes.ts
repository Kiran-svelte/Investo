import { Router, Request, Response } from 'express';
import config from '../config';
import logger from '../config/logger';
import prisma from '../config/prisma';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: config.env,
      dependencies: {
        db: {
          status: 'ok',
          latency_ms: Date.now() - startedAt,
        },
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
