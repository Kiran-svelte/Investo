"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("./config/logger"));
const prisma_1 = __importDefault(require("./config/prisma"));
const redis_1 = require("./config/redis");
const propertyImportWorker_service_1 = require("./services/propertyImportWorker.service");
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
        propertyImportWorker_service_1.propertyImportWorkerService.start();
        logger_1.default.info('Investo property import worker runtime is running');
    }
    catch (err) {
        logger_1.default.error('Failed to start property import worker runtime', {
            error: err.message,
        });
        process.exit(1);
    }
}
async function shutdown(signal) {
    logger_1.default.info('Property import worker runtime shutting down', { signal });
    propertyImportWorker_service_1.propertyImportWorkerService.stop();
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
//# sourceMappingURL=worker.js.map