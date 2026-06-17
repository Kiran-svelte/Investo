import logger from './config/logger';
import prisma from './config/prisma';
import { getRedis } from './config/redis';
import { propertyImportWorkerService } from './services/propertyImportWorker.service';
import { automationService } from './services/automation.service';
import { whatsappInboundWorkerService } from './services/queue/whatsappInboundWorker.service';
import { touchWorkerHeartbeat } from './services/observability/syntheticCheck.service';

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

    // Property import background processing
    propertyImportWorkerService.start();

    // Automation queue: visit reminders, follow-ups, conversation timeouts,
    // and the new retry_concurrent_inbound job queue
    automationService.start();

    whatsappInboundWorkerService.start();

    void touchWorkerHeartbeat();
    setInterval(() => {
      void touchWorkerHeartbeat();
    }, 60_000);

    logger.info('Investo worker runtime started', {
      services: ['property_import_worker', 'automation_service', 'whatsapp_inbound_worker'],
    });
  } catch (err: any) {
    logger.error('Failed to start worker runtime', {
      error: err.message,
    });
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  logger.info('Worker runtime shutting down', { signal });
  whatsappInboundWorkerService.stop();
  propertyImportWorkerService.stop();
  automationService.stop();
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
