"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.propertyImportQueueService = exports.PropertyImportQueueService = void 0;
const redis_1 = require("../config/redis");
const logger_1 = __importDefault(require("../config/logger"));
const JOB_PREFIX = 'property-import:job:';
const PROCESSING_PREFIX = 'property-import:processing:';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const memoryJobs = new Map();
const memoryProcessing = new Set();
function isProductionRuntime() {
    const env = (process.env.NODE_ENV || '').toLowerCase();
    return env === 'production' && !Boolean(process.env.JEST_WORKER_ID);
}
function warnRedisUnavailable(operation, metadata) {
    // #region agent log
    fetch('http://127.0.0.1:7571/ingest/b04febcc-8277-456d-aee1-de68df62bb9e', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '765cca' }, body: JSON.stringify({ sessionId: '765cca', runId: 'run1', hypothesisId: 'H2', location: 'propertyImportQueue.service.ts:warnRedisUnavailable', message: 'Redis unavailable, using memory fallback', data: { operation, hasMetadata: Number(Boolean(metadata)) }, timestamp: Date.now() }) }).catch(() => { });
    // #endregion
    logger_1.default.warn('Property import queue: Redis unavailable, using in-memory fallback (data will not survive restarts). Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for durable queueing.', {
        operation,
        ...metadata,
    });
}
function buildQueueKey(type, idempotencyKey) {
    return `${JOB_PREFIX}${type}:${idempotencyKey}`;
}
function buildProcessingKey(queueKey) {
    return `${PROCESSING_PREFIX}${queueKey}`;
}
function parseStoredJob(raw) {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
class PropertyImportQueueService {
    async enqueueExtraction(idempotencyKey, payload, ttlSeconds = DEFAULT_TTL_SECONDS) {
        const queueKey = buildQueueKey('extract_media', idempotencyKey);
        const job = {
            type: 'extract_media',
            idempotencyKey,
            payload,
            enqueuedAt: new Date().toISOString(),
        };
        const redis = (0, redis_1.getRedis)();
        if (!redis && isProductionRuntime()) {
            warnRedisUnavailable('enqueueExtraction', { queueKey });
        }
        if (redis) {
            try {
                const result = await redis.set(queueKey, JSON.stringify(job), {
                    nx: true,
                    ex: ttlSeconds,
                });
                if (result === null) {
                    return false;
                }
                logger_1.default.info('Property import queue transition', {
                    queue: 'property_import',
                    transition: 'queued',
                    storage: 'redis',
                    queueKey,
                    draftId: payload.draftId,
                    mediaId: payload.mediaId,
                    attempt: payload.attempt,
                    maxAttempts: payload.maxAttempts,
                });
                return true;
            }
            catch (err) {
                logger_1.default.warn('Property import queue Redis enqueue failed, falling back to memory', {
                    queueKey,
                    error: err.message,
                });
            }
        }
        if (memoryJobs.has(queueKey)) {
            return false;
        }
        memoryJobs.set(queueKey, job);
        logger_1.default.info('Property import queue transition', {
            queue: 'property_import',
            transition: 'queued',
            storage: 'memory',
            queueKey,
            draftId: payload.draftId,
            mediaId: payload.mediaId,
            attempt: payload.attempt,
            maxAttempts: payload.maxAttempts,
        });
        return true;
    }
    async clearAll() {
        const redis = (0, redis_1.getRedis)();
        if (!redis && isProductionRuntime()) {
            warnRedisUnavailable('clearAll');
        }
        if (redis) {
            try {
                const queueKeys = await redis.keys(`${JOB_PREFIX}*`);
                if (queueKeys.length > 0) {
                    await redis.del(...queueKeys);
                }
                const processingKeys = await redis.keys(`${PROCESSING_PREFIX}*`);
                if (processingKeys.length > 0) {
                    await redis.del(...processingKeys);
                }
                return;
            }
            catch (err) {
                logger_1.default.warn('Failed to clear property import queue in Redis', { error: err.message });
            }
        }
        memoryJobs.clear();
        memoryProcessing.clear();
    }
    async processDueJobs(processor) {
        const jobs = await this.getAllJobs();
        let processed = 0;
        for (const { key, job } of jobs.slice(0, 25)) {
            const claimed = await this.claimJob(key);
            if (!claimed) {
                logger_1.default.debug('Property import queue transition', {
                    queue: 'property_import',
                    transition: 'claim_skipped',
                    reason: 'already_processing',
                    queueKey: key,
                    draftId: job.payload.draftId,
                    mediaId: job.payload.mediaId,
                    attempt: job.payload.attempt,
                    maxAttempts: job.payload.maxAttempts,
                });
                continue;
            }
            logger_1.default.info('Property import queue transition', {
                queue: 'property_import',
                transition: 'processing',
                queueKey: key,
                draftId: job.payload.draftId,
                mediaId: job.payload.mediaId,
                attempt: job.payload.attempt,
                maxAttempts: job.payload.maxAttempts,
            });
            try {
                const result = await processor(job);
                if (result === 'retry') {
                    logger_1.default.warn('Property import queue transition', {
                        queue: 'property_import',
                        transition: 'retry_scheduled',
                        queueKey: key,
                        draftId: job.payload.draftId,
                        mediaId: job.payload.mediaId,
                        attempt: job.payload.attempt,
                        maxAttempts: job.payload.maxAttempts,
                    });
                    await this.releaseJob(key);
                    continue;
                }
                await this.deleteJob(key);
                logger_1.default.info('Property import queue transition', {
                    queue: 'property_import',
                    transition: 'succeeded',
                    queueKey: key,
                    draftId: job.payload.draftId,
                    mediaId: job.payload.mediaId,
                    attempt: job.payload.attempt,
                    maxAttempts: job.payload.maxAttempts,
                });
                processed += 1;
            }
            catch (err) {
                logger_1.default.error('Property import queue transition', {
                    queue: 'property_import',
                    transition: 'processing_error_released',
                    queueKey: key,
                    error: err.message,
                    draftId: job.payload.draftId,
                    mediaId: job.payload.mediaId,
                    attempt: job.payload.attempt,
                    maxAttempts: job.payload.maxAttempts,
                });
                await this.releaseJob(key);
            }
        }
        return processed;
    }
    async getAllJobs() {
        const redis = (0, redis_1.getRedis)();
        if (!redis && isProductionRuntime()) {
            warnRedisUnavailable('getAllJobs');
        }
        if (redis) {
            try {
                const keys = await redis.keys(`${JOB_PREFIX}*`);
                const entries = await Promise.all(keys.map(async (key) => {
                    const raw = await redis.get(key);
                    if (!raw) {
                        return null;
                    }
                    try {
                        return { key, job: parseStoredJob(raw) };
                    }
                    catch {
                        logger_1.default.warn('Discarding malformed property import queue payload', { key });
                        return null;
                    }
                }));
                return entries.filter((entry) => Boolean(entry));
            }
            catch (err) {
                logger_1.default.warn('Failed to list property import jobs in Redis, falling back to memory', {
                    error: err.message,
                });
            }
        }
        return Array.from(memoryJobs.entries()).map(([key, job]) => ({ key, job }));
    }
    async claimJob(queueKey) {
        const redis = (0, redis_1.getRedis)();
        const processingKey = buildProcessingKey(queueKey);
        if (!redis && isProductionRuntime()) {
            warnRedisUnavailable('claimJob', { queueKey });
        }
        if (redis) {
            try {
                const result = await redis.set(processingKey, '1', { nx: true, ex: 300 });
                return result !== null;
            }
            catch (err) {
                logger_1.default.warn('Failed to claim property import job in Redis, falling back to memory', {
                    queueKey,
                    error: err.message,
                });
            }
        }
        if (memoryProcessing.has(queueKey)) {
            return false;
        }
        memoryProcessing.add(queueKey);
        return true;
    }
    async releaseJob(queueKey) {
        const redis = (0, redis_1.getRedis)();
        const processingKey = buildProcessingKey(queueKey);
        if (!redis && isProductionRuntime()) {
            warnRedisUnavailable('releaseJob', { queueKey });
        }
        if (redis) {
            try {
                await redis.del(processingKey);
            }
            catch {
                // best effort
            }
            return;
        }
        memoryProcessing.delete(queueKey);
    }
    async deleteJob(queueKey) {
        const redis = (0, redis_1.getRedis)();
        const processingKey = buildProcessingKey(queueKey);
        if (!redis && isProductionRuntime()) {
            warnRedisUnavailable('deleteJob', { queueKey });
        }
        if (redis) {
            try {
                await redis.del(queueKey, processingKey);
                return;
            }
            catch (err) {
                logger_1.default.warn('Failed to delete property import queue key in Redis', {
                    queueKey,
                    error: err.message,
                });
            }
        }
        memoryJobs.delete(queueKey);
        memoryProcessing.delete(queueKey);
    }
}
exports.PropertyImportQueueService = PropertyImportQueueService;
exports.propertyImportQueueService = new PropertyImportQueueService();
//# sourceMappingURL=propertyImportQueue.service.js.map