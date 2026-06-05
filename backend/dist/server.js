"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpServer = void 0;
const http_1 = require("http");
const app_1 = __importDefault(require("./app"));
const config_1 = __importDefault(require("./config"));
const logger_1 = __importDefault(require("./config/logger"));
const prisma_1 = __importDefault(require("./config/prisma"));
const bootstrapDatabase_1 = require("./config/bootstrapDatabase");
const automation_service_1 = require("./services/automation.service");
const propertyImportWorker_service_1 = require("./services/propertyImportWorker.service");
const socket_service_1 = require("./services/socket.service");
const cron_scheduler_service_1 = require("./services/agent/cron-scheduler.service");
const agent_memory_service_1 = require("./services/agent/agent-memory.service");
/** Maximum time (ms) to wait for in-flight requests to drain before forced exit. */
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30000;
let httpServer = null;
exports.httpServer = httpServer;
let keepAliveTimer = null;
let automationStarted = false;
let agentCronStarted = false;
let propertyImportWorkerStarted = false;
let isShuttingDown = false;
function startAutomationIfNeeded() {
    if (automationStarted)
        return;
    automation_service_1.automationService.start();
    automationStarted = true;
}
function startAgentCronIfNeeded() {
    if (agentCronStarted || !config_1.default.agentAi?.enabled || !config_1.default.agentAi?.cronEnabled)
        return;
    (0, cron_scheduler_service_1.startCronScheduler)();
    agentCronStarted = true;
}
function startPropertyImportWorkerIfNeeded() {
    if (propertyImportWorkerStarted)
        return;
    propertyImportWorker_service_1.propertyImportWorkerService.start();
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
async function shutdown(signal) {
    if (isShuttingDown)
        return;
    isShuttingDown = true;
    logger_1.default.info(`${signal} received — graceful shutdown initiated`, {
        drainTimeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
    });
    // Forced-exit safety net: kills the process if drain takes too long.
    const forceExitTimer = setTimeout(() => {
        logger_1.default.error('Graceful shutdown timed out — forcing exit', {
            timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
        });
        process.exit(1);
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();
    // Step 1: Stop accepting new HTTP connections.
    if (httpServer) {
        await new Promise((resolve) => {
            httpServer.close((err) => {
                if (err) {
                    logger_1.default.warn('HTTP server close error', { error: err.message });
                }
                else {
                    logger_1.default.info('HTTP server closed — no longer accepting connections');
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
        automation_service_1.automationService.stop();
        automationStarted = false;
    }
    if (agentCronStarted) {
        (0, cron_scheduler_service_1.stopCronScheduler)();
        agentCronStarted = false;
    }
    if (propertyImportWorkerStarted) {
        propertyImportWorker_service_1.propertyImportWorkerService.stop();
        propertyImportWorkerStarted = false;
    }
    // Step 3: Flush agent memory checkpointer and DB connection pool.
    try {
        await (0, agent_memory_service_1.destroyCheckpointer)();
    }
    catch (err) {
        logger_1.default.warn('Checkpointer destroy failed during shutdown', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    try {
        await prisma_1.default.$disconnect();
        logger_1.default.info('Database connection pool closed');
    }
    catch (err) {
        logger_1.default.warn('Prisma disconnect failed during shutdown', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    logger_1.default.info('Graceful shutdown complete');
    clearTimeout(forceExitTimer);
    process.exit(0);
}
async function start() {
    try {
        if (config_1.default.db.supabasePoolerConfigured) {
            logger_1.default.info('Database pooler: Supabase transaction mode (port 6543)');
        }
        else if (!config_1.default.db.neonPoolerConfigured) {
            logger_1.default.warn('DATABASE_URL is not using a pooled connection string. Use Supabase pooler (6543) or Neon -pooler for high concurrency.');
        }
        // Create HTTP server and bind immediately so Render health checks pass while DB warms up.
        exports.httpServer = httpServer = (0, http_1.createServer)(app_1.default);
        socket_service_1.socketService.initialize(httpServer);
        await new Promise((resolve, reject) => {
            const host = process.env.HOST || '0.0.0.0';
            httpServer.listen(config_1.default.port, host, () => {
                logger_1.default.info(`Investo API server running on ${host}:${config_1.default.port} [${config_1.default.env}]`);
                logger_1.default.info('WebSocket enabled for real-time updates');
                resolve();
            });
            httpServer.once('error', reject);
        });
        // Warm database and bootstrap in the background.
        void (async () => {
            try {
                await prisma_1.default.$queryRaw `SELECT 1`;
                logger_1.default.info('Database connected (Prisma → PostgreSQL)');
                await (0, bootstrapDatabase_1.bootstrapDatabase)({
                    autoMigrate: config_1.default.db.autoMigrate,
                    autoSeed: config_1.default.db.autoSeed,
                });
                // Pre-warm pgvector schemas so per-request ensureSchema() calls are
                // instant in-memory cache hits instead of 5 SQL round-trips each.
                try {
                    const { ensureClientMemorySchema } = await Promise.resolve().then(() => __importStar(require('./services/clientMemory.service')));
                    const { ensurePropertyKnowledgeSchema } = await Promise.resolve().then(() => __importStar(require('./services/propertyKnowledge.service')));
                    await Promise.all([ensureClientMemorySchema(), ensurePropertyKnowledgeSchema()]);
                    logger_1.default.info('pgvector schemas pre-warmed (clientMemory + propertyKnowledge)');
                }
                catch (schemaErr) {
                    logger_1.default.warn('pgvector schema pre-warm failed; will retry on first request', {
                        error: schemaErr instanceof Error ? schemaErr.message : String(schemaErr),
                    });
                }
                startAutomationIfNeeded();
                startAgentCronIfNeeded();
                startPropertyImportWorkerIfNeeded();
            }
            catch (err) {
                logger_1.default.warn('Database warmup failed at startup; API remains available for health checks', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        })();
        if (config_1.default.db.keepAliveEnabled) {
            keepAliveTimer = setInterval(async () => {
                try {
                    await prisma_1.default.$queryRaw `SELECT 1`;
                    logger_1.default.debug('Neon keep-alive ping succeeded');
                    if (!automationStarted) {
                        logger_1.default.info('Dependencies healthy; starting automation service');
                        startAutomationIfNeeded();
                    }
                    if (!agentCronStarted) {
                        logger_1.default.info('Dependencies healthy; starting Agent AI cron scheduler');
                        startAgentCronIfNeeded();
                    }
                    if (!propertyImportWorkerStarted) {
                        logger_1.default.info('Dependencies healthy; starting property import worker');
                        startPropertyImportWorkerIfNeeded();
                    }
                }
                catch (err) {
                    logger_1.default.warn('Neon keep-alive ping failed', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }, Math.max(config_1.default.db.keepAliveIntervalMs, 60000));
        }
    }
    catch (err) {
        logger_1.default.error('Failed to start server', {
            error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
    }
}
process.on('uncaughtException', (err) => {
    logger_1.default.error('Uncaught exception', { error: err.message, stack: err.stack });
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    logger_1.default.error('Unhandled rejection', { error: message });
});
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
void start();
