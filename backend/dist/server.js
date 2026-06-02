"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
let keepAliveTimer = null;
let automationStarted = false;
let agentCronStarted = false;
let propertyImportWorkerStarted = false;
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
async function start() {
    try {
        if (config_1.default.db.supabasePoolerConfigured) {
            logger_1.default.info('Database pooler: Supabase transaction mode (port 6543)');
        }
        else if (!config_1.default.db.neonPoolerConfigured) {
            logger_1.default.warn('DATABASE_URL is not using a pooled connection string. Use Supabase pooler (6543) or Neon -pooler for high concurrency.');
        }
        let dbConnectedAtStartup = false;
        // Test database connection via Prisma, but do not hard-fail local dev startup.
        try {
            await prisma_1.default.$queryRaw `SELECT 1`;
            logger_1.default.info('Database connected (Prisma → PostgreSQL)');
            dbConnectedAtStartup = true;
            await (0, bootstrapDatabase_1.bootstrapDatabase)({
                autoMigrate: config_1.default.db.autoMigrate,
                autoSeed: config_1.default.db.autoSeed,
            });
        }
        catch (err) {
            logger_1.default.warn('Database check failed at startup; continuing in development mode', {
                error: err.message,
            });
        }
        // Create HTTP server
        const httpServer = (0, http_1.createServer)(app_1.default);
        // Initialize WebSocket
        socket_service_1.socketService.initialize(httpServer);
        httpServer.listen(config_1.default.port, () => {
            logger_1.default.info(`Investo API server running on port ${config_1.default.port} [${config_1.default.env}]`);
            logger_1.default.info('WebSocket enabled for real-time updates');
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
                        logger_1.default.warn('Neon keep-alive ping failed', { error: err.message });
                    }
                }, Math.max(config_1.default.db.keepAliveIntervalMs, 60000));
            }
            if (dbConnectedAtStartup) {
                startAutomationIfNeeded();
                startAgentCronIfNeeded();
                startPropertyImportWorkerIfNeeded();
            }
            else {
                logger_1.default.warn('Automation service delayed until database connectivity is healthy');
                logger_1.default.warn('Agent AI cron scheduler delayed until database connectivity is healthy');
                logger_1.default.warn('Property import worker delayed until database connectivity is healthy');
            }
        });
    }
    catch (err) {
        logger_1.default.error('Failed to start server', { error: err.message });
        process.exit(1);
    }
}
// Graceful shutdown
process.on('SIGTERM', async () => {
    logger_1.default.info('SIGTERM received, shutting down...');
    if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
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
    await (0, agent_memory_service_1.destroyCheckpointer)();
    await prisma_1.default.$disconnect();
    process.exit(0);
});
process.on('SIGINT', async () => {
    logger_1.default.info('SIGINT received, shutting down...');
    if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
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
    await (0, agent_memory_service_1.destroyCheckpointer)();
    await prisma_1.default.$disconnect();
    process.exit(0);
});
start();
