import { createServer } from 'http';
import app from './app';
import config from './config';
import logger from './config/logger';
import prisma from './config/prisma';
import { bootstrapDatabase } from './config/bootstrapDatabase';
import { automationService } from './services/automation.service';
import { socketService } from './services/socket.service';

let keepAliveTimer: NodeJS.Timeout | null = null;
let automationStarted = false;

function startAutomationIfNeeded(): void {
  if (automationStarted) return;
  automationService.start();
  automationStarted = true;
}

async function start() {
  try {
    if (!config.db.neonPoolerConfigured) {
      logger.warn('DATABASE_URL is not using a Neon pooler host. Use a -pooler connection string for high concurrency.');
    }

    let dbConnectedAtStartup = false;

    // Test database connection via Prisma, but do not hard-fail local dev startup.
    try {
      await prisma.$queryRaw`SELECT 1`;
      logger.info('Database connected (Prisma → Neon PostgreSQL)');
      dbConnectedAtStartup = true;

      await bootstrapDatabase({
        autoMigrate: config.db.autoMigrate,
        autoSeed: config.db.autoSeed,
      });
    } catch (err: any) {
      logger.warn('Database check failed at startup; continuing in development mode', {
        error: err.message,
      });
    }

    // Create HTTP server
    const httpServer = createServer(app);
    
    // Initialize WebSocket
    socketService.initialize(httpServer);

    httpServer.listen(config.port, () => {
      logger.info(`Investo API server running on port ${config.port} [${config.env}]`);
      logger.info('WebSocket enabled for real-time updates');

      if (config.db.keepAliveEnabled) {
        keepAliveTimer = setInterval(async () => {
          try {
            await prisma.$queryRaw`SELECT 1`;
            logger.debug('Neon keep-alive ping succeeded');
            if (!automationStarted) {
              logger.info('Dependencies healthy; starting automation service');
              startAutomationIfNeeded();
            }
          } catch (err: any) {
            logger.warn('Neon keep-alive ping failed', { error: err.message });
          }
        }, Math.max(config.db.keepAliveIntervalMs, 60_000));
      }

      if (dbConnectedAtStartup) {
        startAutomationIfNeeded();
      } else {
        logger.warn('Automation service delayed until database connectivity is healthy');
      }
    });
  } catch (err: any) {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
  }
  if (automationStarted) {
    automationService.stop();
    automationStarted = false;
  }
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down...');
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
  }
  if (automationStarted) {
    automationService.stop();
    automationStarted = false;
  }
  await prisma.$disconnect();
  process.exit(0);
});

start();
