"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.automationQueueService = exports.AutomationQueueService = void 0;
const redis_1 = require("../config/redis");
const logger_1 = __importDefault(require("../config/logger"));
const JOB_PREFIX = 'automation:job:';
const PROCESSING_PREFIX = 'automation:processing:';
const DEAD_LETTER_PREFIX = 'automation:dead-letter:';
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_MAX_ATTEMPTS = 3;
const memoryJobs = new Map();
const memoryProcessing = new Set();
const memoryDeadLetters = new Map();
function buildJobKey(type, uniqueKey) {
    return `${JOB_PREFIX}${type}:${uniqueKey}`;
}
function buildProcessingKey(jobKey) {
    return `${PROCESSING_PREFIX}${jobKey}`;
}
function parseStoredJob(raw) {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
function buildDeadLetterKey(jobKey) {
    return `${DEAD_LETTER_PREFIX}${jobKey}`;
}
function calculateRetryDelayMs(nextAttempt) {
    const backoffSeconds = Math.min(300, Math.pow(2, nextAttempt) * 10);
    return backoffSeconds * 1000;
}
class AutomationQueueService {
    async schedule(type, uniqueKey, executeAt, data, ttlSeconds = DEFAULT_TTL_SECONDS) {
        const jobKey = buildJobKey(type, uniqueKey);
        const payload = {
            type,
            uniqueKey,
            executeAt: executeAt.toISOString(),
            data,
            createdAt: new Date().toISOString(),
            attempt: 0,
            maxAttempts: DEFAULT_MAX_ATTEMPTS,
            lastError: null,
        };
        const redis = (0, redis_1.getRedis)();
        if (redis) {
            try {
                const result = await redis.set(jobKey, JSON.stringify(payload), {
                    nx: true,
                    ex: ttlSeconds,
                });
                if (result === null) {
                    return false;
                }
                logger_1.default.info('Automation queue transition', {
                    queue: 'automation',
                    transition: 'queued',
                    jobKey,
                    type: payload.type,
                    uniqueKey: payload.uniqueKey,
                    attempt: payload.attempt,
                    maxAttempts: payload.maxAttempts,
                    executeAt: payload.executeAt,
                });
                return true;
            }
            catch (err) {
                logger_1.default.warn('Failed to schedule automation job in Redis, falling back to memory', {
                    jobKey,
                    error: err.message,
                });
            }
        }
        if (memoryJobs.has(jobKey)) {
            return false;
        }
        memoryJobs.set(jobKey, payload);
        logger_1.default.info('Automation queue transition', {
            queue: 'automation',
            transition: 'queued',
            storage: 'memory',
            jobKey,
            type: payload.type,
            uniqueKey: payload.uniqueKey,
            attempt: payload.attempt,
            maxAttempts: payload.maxAttempts,
            executeAt: payload.executeAt,
        });
        return true;
    }
    async processDueJobs(processor) {
        const now = Date.now();
        let processed = 0;
        const jobs = await this.getAllJobs();
        const dueJobs = jobs
            .filter((entry) => new Date(entry.job.executeAt).getTime() <= now)
            .sort((left, right) => new Date(left.job.executeAt).getTime() - new Date(right.job.executeAt).getTime())
            .slice(0, 25);
        for (const { key, job } of dueJobs) {
            const claimed = await this.claimJob(key);
            if (!claimed) {
                logger_1.default.debug('Automation queue transition', {
                    queue: 'automation',
                    transition: 'claim_skipped',
                    reason: 'already_processing',
                    jobKey: key,
                    type: job.type,
                    uniqueKey: job.uniqueKey,
                    attempt: job.attempt,
                    maxAttempts: job.maxAttempts,
                });
                continue;
            }
            logger_1.default.info('Automation queue transition', {
                queue: 'automation',
                transition: 'processing',
                jobKey: key,
                type: job.type,
                uniqueKey: job.uniqueKey,
                attempt: job.attempt,
                maxAttempts: job.maxAttempts,
            });
            try {
                await processor(job);
                await this.deleteJob(key);
                logger_1.default.info('Automation queue transition', {
                    queue: 'automation',
                    transition: 'succeeded',
                    jobKey: key,
                    type: job.type,
                    uniqueKey: job.uniqueKey,
                    attempt: job.attempt,
                    maxAttempts: job.maxAttempts,
                });
                processed += 1;
            }
            catch (err) {
                await this.handleProcessingFailure(key, job, err);
            }
        }
        return processed;
    }
    async clearAll() {
        const redis = (0, redis_1.getRedis)();
        if (redis) {
            try {
                const keys = await redis.keys(`${JOB_PREFIX}*`);
                if (keys.length > 0) {
                    await redis.del(...keys);
                }
                const processingKeys = await redis.keys(`${PROCESSING_PREFIX}*`);
                if (processingKeys.length > 0) {
                    await redis.del(...processingKeys);
                }
                const deadLetterKeys = await redis.keys(`${DEAD_LETTER_PREFIX}*`);
                if (deadLetterKeys.length > 0) {
                    await redis.del(...deadLetterKeys);
                }
                return;
            }
            catch (err) {
                logger_1.default.warn('Failed to clear automation jobs in Redis', { error: err.message });
            }
        }
        memoryJobs.clear();
        memoryProcessing.clear();
        memoryDeadLetters.clear();
    }
    async getAllJobs() {
        const redis = (0, redis_1.getRedis)();
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
                        logger_1.default.warn('Discarding malformed automation job', { key });
                        return null;
                    }
                }));
                return entries.filter((entry) => Boolean(entry));
            }
            catch (err) {
                logger_1.default.warn('Failed to list automation jobs from Redis, falling back to memory', { error: err.message });
            }
        }
        return Array.from(memoryJobs.entries()).map(([key, job]) => ({ key, job }));
    }
    async claimJob(jobKey) {
        const redis = (0, redis_1.getRedis)();
        const processingKey = buildProcessingKey(jobKey);
        if (redis) {
            try {
                const result = await redis.set(processingKey, '1', { nx: true, ex: 300 });
                return result !== null;
            }
            catch (err) {
                logger_1.default.warn('Failed to claim automation job in Redis, falling back to memory', {
                    jobKey,
                    error: err.message,
                });
            }
        }
        if (memoryProcessing.has(jobKey)) {
            return false;
        }
        memoryProcessing.add(jobKey);
        return true;
    }
    async releaseJob(jobKey) {
        const redis = (0, redis_1.getRedis)();
        const processingKey = buildProcessingKey(jobKey);
        if (redis) {
            try {
                await redis.del(processingKey);
            }
            catch {
                // ignore release failures
            }
            return;
        }
        memoryProcessing.delete(jobKey);
    }
    async deleteJob(jobKey) {
        const redis = (0, redis_1.getRedis)();
        const processingKey = buildProcessingKey(jobKey);
        if (redis) {
            try {
                await redis.del(jobKey, processingKey);
                return;
            }
            catch (err) {
                logger_1.default.warn('Failed to delete automation job from Redis', { jobKey, error: err.message });
            }
        }
        memoryJobs.delete(jobKey);
        memoryProcessing.delete(jobKey);
    }
    async handleProcessingFailure(jobKey, job, error) {
        const failureReason = error.message || 'Automation job processor failed';
        const nextAttempt = job.attempt + 1;
        const canRetry = nextAttempt < job.maxAttempts;
        if (canRetry) {
            const nextExecuteAt = new Date(Date.now() + calculateRetryDelayMs(nextAttempt)).toISOString();
            const updatedJob = {
                ...job,
                attempt: nextAttempt,
                executeAt: nextExecuteAt,
                lastError: failureReason,
            };
            await this.upsertJob(jobKey, updatedJob);
            await this.releaseJob(jobKey);
            logger_1.default.warn('Automation queue transition', {
                queue: 'automation',
                transition: 'retry_scheduled',
                jobKey,
                type: job.type,
                uniqueKey: job.uniqueKey,
                attempt: nextAttempt,
                maxAttempts: job.maxAttempts,
                nextExecuteAt,
                failureReason,
            });
            return;
        }
        const deadLetter = {
            ...job,
            attempt: nextAttempt,
            lastError: failureReason,
            failedAt: new Date().toISOString(),
            failureReason,
        };
        await this.saveDeadLetter(jobKey, deadLetter);
        await this.deleteJob(jobKey);
        logger_1.default.error('Automation queue transition', {
            queue: 'automation',
            transition: 'dead_lettered',
            jobKey,
            deadLetterKey: buildDeadLetterKey(jobKey),
            type: job.type,
            uniqueKey: job.uniqueKey,
            attempt: deadLetter.attempt,
            maxAttempts: deadLetter.maxAttempts,
            failureReason,
        });
    }
    async upsertJob(jobKey, job) {
        const redis = (0, redis_1.getRedis)();
        if (redis) {
            try {
                await redis.set(jobKey, JSON.stringify(job), { ex: DEFAULT_TTL_SECONDS });
                return;
            }
            catch (err) {
                logger_1.default.warn('Failed to update automation job in Redis, falling back to memory', {
                    jobKey,
                    error: err.message,
                });
            }
        }
        memoryJobs.set(jobKey, job);
    }
    async saveDeadLetter(jobKey, job) {
        const deadLetterKey = buildDeadLetterKey(jobKey);
        const redis = (0, redis_1.getRedis)();
        if (redis) {
            try {
                await redis.set(deadLetterKey, JSON.stringify(job), { ex: DEFAULT_TTL_SECONDS });
                return;
            }
            catch (err) {
                logger_1.default.warn('Failed to store automation dead-letter job in Redis, falling back to memory', {
                    deadLetterKey,
                    error: err.message,
                });
            }
        }
        memoryDeadLetters.set(deadLetterKey, job);
    }
}
exports.AutomationQueueService = AutomationQueueService;
exports.automationQueueService = new AutomationQueueService();
