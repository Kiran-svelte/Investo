"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("./config/logger"));
const prisma_1 = __importDefault(require("./config/prisma"));
const redis_1 = require("./config/redis");
const propertyImportWorker_service_1 = require("./services/propertyImportWorker.service");
const automation_service_1 = require("./services/automation.service");
async function startWorker() {
    try {
        await prisma_1.default.$queryRaw `SELECT 1`;
        logger_1.default.info('Database connected for worker runtime');
        if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
            const redis = (0, redis_1.getRedis)();
            if (!redis) {
                throw new Error('Worker requires Redis in production. Configure UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
            }
            await redis.ping();
            logger_1.default.info('Redis connected for worker runtime');
        }
        // Property import background processing
        propertyImportWorker_service_1.propertyImportWorkerService.start();
        // Automation queue: visit reminders, follow-ups, conversation timeouts,
        // and the new retry_concurrent_inbound job queue
        automation_service_1.automationService.start();
        logger_1.default.info('Investo worker runtime started', {
            services: ['property_import_worker', 'automation_service'],
        });
    }
    catch (err) {
        logger_1.default.error('Failed to start worker runtime', {
            error: err.message,
        });
        process.exit(1);
    }
}
async function shutdown(signal) {
    logger_1.default.info('Worker runtime shutting down', { signal });
    propertyImportWorker_service_1.propertyImportWorkerService.stop();
    automation_service_1.automationService.stop();
    await prisma_1.default.$disconnect();
    process.exit(0);
}
process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
    void shutdown('SIGINT');
});
void startWorker();
