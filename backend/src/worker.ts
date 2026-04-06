import logger from './config/logger';
import prisma from './config/prisma';
import { getRedis } from './config/redis';
import { propertyImportWorkerService } from './services/propertyImportWorker.service';

async function startWorker(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connected for worker runtime');

    if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
      const redis = getRedis();
      if (!redis) {
        throw new Error('Worker requires Redis in production. Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
      }

      await redis.ping();
      logger.info('Redis connected for worker runtime');
    }

    propertyImportWorkerService.start();
    logger.info('Investo property import worker runtime is running');
  } catch (err: any) {
    logger.error('Failed to start property import worker runtime', {
      error: err.message,
    });
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  logger.info('Property import worker runtime shutting down', { signal });
  propertyImportWorkerService.stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

void startWorker();
