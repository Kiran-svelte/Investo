import * as Sentry from '@sentry/node';
import { createServer, type Server } from 'http';
import app from './app';
import config from './config';
import logger from './config/logger';
import prisma from './config/prisma';
import { bootstrapDatabase } from './config/bootstrapDatabase';
import { automationService } from './services/automation.service';
import { propertyImportWorkerService } from './services/propertyImportWorker.service';
import { socketService } from './services/socket.service';
import { startCronScheduler, stopCronScheduler } from './services/agent/cron-scheduler.service';
import { destroyCheckpointer } from './services/agent/agent-memory.service';
import { reconcileOrphanedVisitReminders } from './services/visitLifecycle.service';

/** Maximum time (ms) to wait for in-flight requests to drain before forced exit. */
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;

let httpServer: Server | null = null;
let keepAliveTimer: NodeJS.Timeout | null = null;
let automationStarted = false;
let agentCronStarted = false;
let propertyImportWorkerStarted = false;
let isShuttingDown = false;

/**
 * In production, background workers (automation queue, property import) should run on
 * the dedicated worker process (`npm run start:worker`). Set RUN_BACKGROUND_WORKERS_ON_API=true
 * on the API service only when no separate worker is deployed.
 */
function shouldRunBackgroundWorkersOnApi(): boolean {
  if (config.env !== 'production') return true;
  return process.env.RUN_BACKGROUND_WORKERS_ON_API === 'true';
}

function startAutomationIfNeeded(): void {
  if (automationStarted || !shouldRunBackgroundWorkersOnApi()) return;
  automationService.start();
  automationStarted = true;
}

function startAgentCronIfNeeded(): void {
  if (agentCronStarted || !config.agentAi?.enabled || !config.agentAi?.cronEnabled) return;
  startCronScheduler();
  agentCronStarted = true;
}

function startPropertyImportWorkerIfNeeded(): void {
  if (propertyImportWorkerStarted || !shouldRunBackgroundWorkersOnApi()) return;
  propertyImportWorkerService.start();
  propertyImportWorkerStarted = true;
}

/**
 * Graceful shutdown handler.
 * Stops accepting new connections, drains in-flight work, flushes buffers,
 * closes DB and cache connections, then exits with code 0.
 * Forced exit after GRACEFUL_SHUTDOWN_TIMEOUT_MS if drain takes too long.
 *
 * @param signal - POSIX signal name (for logging)
 */
async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received — graceful shutdown initiated`, {
    drainTimeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
  });

  // Forced-exit safety net: kills the process if drain takes too long.
  const forceExitTimer = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit', {
      timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
    });
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  // Step 1: Stop accepting new HTTP connections.
  if (httpServer) {
    await new Promise<void>((resolve) => {
      httpServer!.close((err) => {
        if (err) {
          logger.warn('HTTP server close error', { error: (err as Error).message });
        } else {
          logger.info('HTTP server closed — no longer accepting connections');
        }
        resolve();
      });
    });
  }

  // Step 2: Stop background workers and timers.
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  if (automationStarted) {
    automationService.stop();
    automationStarted = false;
  }
  if (agentCronStarted) {
    stopCronScheduler();
    agentCronStarted = false;
  }
  if (propertyImportWorkerStarted) {
    propertyImportWorkerService.stop();
    propertyImportWorkerStarted = false;
  }

  // Step 3: Flush agent memory checkpointer and DB connection pool.
  try {
    await destroyCheckpointer();
  } catch (err: unknown) {
    logger.warn('Checkpointer destroy failed during shutdown', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await prisma.$disconnect();
    logger.info('Database connection pool closed');
  } catch (err: unknown) {
    logger.warn('Prisma disconnect failed during shutdown', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('Graceful shutdown complete');
  clearTimeout(forceExitTimer);
  process.exit(0);
}

function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    if (config.env === 'production') {
      logger.warn('SENTRY_DSN not configured — error tracking disabled in production');
    }
    return;
  }
  Sentry.init({
    dsn,
    environment: config.env,
    // Capture 10% of transactions for performance monitoring
    tracesSampleRate: config.env === 'production' ? 0.1 : 0,
    // Only log errors in production, not 4xx noise
    beforeSend(event) {
      if (event.exception) return event;
      return null;
    },
  });
  logger.info('Sentry error tracking initialized', { environment: config.env });
}

async function start(): Promise<void> {
  // Initialize Sentry before anything else so uncaught errors are captured.
  initSentry();

  try {
    if (config.db.supabasePoolerConfigured) {
      logger.info('Database pooler: Supabase transaction mode (port 6543)');
    } else if (!config.db.neonPoolerConfigured) {
      logger.warn(
        'DATABASE_URL is not using a pooled connection string. Use Supabase pooler (6543) or Neon -pooler for high concurrency.',
      );
    }

    // Create HTTP server and bind immediately so Render health checks pass while DB warms up.
    httpServer = createServer(app);
    socketService.initialize(httpServer);

    await new Promise<void>((resolve, reject) => {
      const host = process.env.HOST || '0.0.0.0';
      httpServer!.listen(config.port, host, () => {
        logger.info(`Investo API server running on ${host}:${config.port} [${config.env}]`);
        logger.info('WebSocket enabled for real-time updates');
        resolve();
      });
      httpServer!.once('error', reject);
    });

    // Warm database and bootstrap in the background.
    void (async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        logger.info('Database connected (Prisma → PostgreSQL)');

        await bootstrapDatabase({
          autoMigrate: config.db.autoMigrate,
          autoSeed: config.db.autoSeed,
        });

        // Pre-warm pgvector schemas so per-request ensureSchema() calls are
        // instant in-memory cache hits instead of 5 SQL round-trips each.
        try {
          const { ensureClientMemorySchema } = await import('./services/clientMemory.service');
          const { ensurePropertyKnowledgeSchema } = await import('./services/propertyKnowledge.service');
          await Promise.all([ensureClientMemorySchema(), ensurePropertyKnowledgeSchema()]);
          logger.info('pgvector schemas pre-warmed (clientMemory + propertyKnowledge)');
        } catch (schemaErr: unknown) {
          logger.warn('pgvector schema pre-warm failed; will retry on first request', {
            error: schemaErr instanceof Error ? schemaErr.message : String(schemaErr),
          });
        }

        startAutomationIfNeeded();
        startAgentCronIfNeeded();
        startPropertyImportWorkerIfNeeded();

        // Self-heal: re-enqueue any visit reminder jobs that were lost during
        // a previous server crash between visit.create and scheduleVisitReminderJobs.
        void reconcileOrphanedVisitReminders().then((count) => {
          if (count > 0) {
            logger.warn('Startup reconciler: re-enqueued orphaned visit reminders', { count });
          }
        });

        const { backfillPropertyKnowledgeOnBoot } = await import('./services/propertyKnowledgeBackfill.service');
        void backfillPropertyKnowledgeOnBoot();
      } catch (err: unknown) {
        logger.warn('Database warmup failed at startup; API remains available for health checks', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    if (config.db.keepAliveEnabled) {
      keepAliveTimer = setInterval(async () => {
        try {
          await prisma.$queryRaw`SELECT 1`;
          logger.debug('Neon keep-alive ping succeeded');
          if (!automationStarted) {
            logger.info('Dependencies healthy; starting automation service');
            startAutomationIfNeeded();
          }
          if (!agentCronStarted) {
            logger.info('Dependencies healthy; starting Agent AI cron scheduler');
            startAgentCronIfNeeded();
          }
          if (!propertyImportWorkerStarted) {
            logger.info('Dependencies healthy; starting property import worker');
            startPropertyImportWorkerIfNeeded();
          }
        } catch (err: unknown) {
          logger.warn('Neon keep-alive ping failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }, Math.max(config.db.keepAliveIntervalMs, 60_000));
    }
  } catch (err: unknown) {
    logger.error('Failed to start server', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  Sentry.captureException(err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error('Unhandled rejection', { error: err.message, stack: err.stack });
  Sentry.captureException(err);
  // Exit so the process manager (Render, PM2) restarts with a clean state.
  process.exit(1);
});

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

void start();

export { httpServer };
