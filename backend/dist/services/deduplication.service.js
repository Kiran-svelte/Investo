"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.markMessageProcessed = exports.isMessageDuplicate = exports.deduplicationService = exports.DeduplicationService = void 0;
const redis_1 = require("../config/redis");
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
/**
 * Redis key prefix for message deduplication
 */
const DEDUP_KEY_PREFIX = 'whatsapp:msg:';
/**
 * In-memory fallback for deduplication when Redis is unavailable
 */
const memoryDedup = new Map(); // messageId -> expiry timestamp
/**
 * Deduplication Service for WhatsApp Messages
 *
 * Prevents duplicate processing of WhatsApp webhook messages.
 * Uses Redis SET with NX (only if not exists) for atomic operation.
 * Falls back to in-memory Map if Redis is unavailable.
 *
 * Default TTL: 5 minutes (300 seconds) - this covers the typical
 * retry window for WhatsApp webhook delivery.
 */
class DeduplicationService {
    constructor(ttlSeconds) {
        this.ttlSeconds = ttlSeconds ?? config_1.default.whatsapp?.dedupTtlSeconds ?? 300;
    }
    /**
     * Check if a message has already been processed
     *
     * Uses Redis SETNX for atomic check-and-set operation.
     * Returns true if message was already processed (key exists).
     *
     * @param messageId - Unique WhatsApp message ID
     * @param ttlSeconds - Time-to-live for the deduplication key
     * @returns Promise<boolean> - True if duplicate, false if new message
     */
    async isDuplicate(messageId, ttlSeconds = this.ttlSeconds) {
        const claimed = await this.claimMessageProcessing(messageId, ttlSeconds);
        return !claimed;
    }
    /**
     * Atomically claim a message for processing.
     *
     * Returns true only for the first claimant inside TTL window.
     */
    async claimMessageProcessing(messageId, ttlSeconds = this.ttlSeconds) {
        const redis = (0, redis_1.getRedis)();
        const key = `${DEDUP_KEY_PREFIX}${messageId}`;
        if (redis) {
            try {
                const result = await redis.set(key, '1', {
                    nx: true,
                    ex: ttlSeconds,
                });
                const claimed = result === 'OK';
                logger_1.default.debug('Deduplication claim (Redis)', {
                    messageId,
                    claimed,
                    ttlSeconds,
                });
                return claimed;
            }
            catch (err) {
                logger_1.default.warn('Redis deduplication claim failed, falling back to memory', {
                    messageId,
                    error: err.message,
                });
            }
        }
        return this.memoryClaimMessage(messageId, ttlSeconds);
    }
    /**
     * Mark a message as processed
     *
     * Explicitly marks a message as processed with TTL.
     * Useful when processing starts but isn't complete yet.
     *
     * @param messageId - Unique WhatsApp message ID
     * @param ttlSeconds - Time-to-live for the deduplication key
     */
    async markProcessed(messageId, ttlSeconds = this.ttlSeconds) {
        const redis = (0, redis_1.getRedis)();
        const key = `${DEDUP_KEY_PREFIX}${messageId}`;
        if (redis) {
            try {
                await redis.set(key, '1', { ex: ttlSeconds });
                logger_1.default.debug('Marked message as processed (Redis)', { messageId, ttlSeconds });
                return;
            }
            catch (err) {
                logger_1.default.warn('Redis markProcessed failed, falling back to memory', {
                    messageId,
                    error: err.message,
                });
            }
        }
        // Fallback to in-memory
        this.memoryMarkProcessed(messageId, ttlSeconds);
    }
    /**
     * Release a message claim so a failed processing attempt can be retried.
     */
    async release(messageId) {
        const redis = (0, redis_1.getRedis)();
        const key = `${DEDUP_KEY_PREFIX}${messageId}`;
        if (redis) {
            try {
                await redis.del(key);
                logger_1.default.debug('Released message claim (Redis)', { messageId });
                return;
            }
            catch (err) {
                logger_1.default.warn('Redis release failed, falling back to memory', {
                    messageId,
                    error: err.message,
                });
            }
        }
        memoryDedup.delete(key);
        logger_1.default.debug('Released message claim (memory)', { messageId });
    }
    /**
     * Get the count of currently processed messages (for monitoring)
     *
     * Note: This is approximate with Redis SCARD, and not supported
     * with in-memory fallback (returns 0).
     *
     * @returns Promise<number> - Approximate count of tracked messages
     */
    async getProcessedCount() {
        const redis = (0, redis_1.getRedis)();
        if (redis) {
            try {
                // Get all keys matching the pattern
                const keys = await redis.keys(`${DEDUP_KEY_PREFIX}*`);
                return keys.length;
            }
            catch (err) {
                logger_1.default.warn('Failed to get processed count from Redis', {
                    error: err.message,
                });
            }
        }
        // Return approximate count from memory
        return this.memoryGetCount();
    }
    /**
     * Clear all deduplication keys (for testing)
     */
    async clearAll() {
        const redis = (0, redis_1.getRedis)();
        if (redis) {
            try {
                const keys = await redis.keys(`${DEDUP_KEY_PREFIX}*`);
                if (keys.length > 0) {
                    await redis.del(...keys);
                }
                logger_1.default.info('Cleared all deduplication keys', { count: keys.length });
                return;
            }
            catch (err) {
                logger_1.default.warn('Failed to clear Redis keys', { error: err.message });
            }
        }
        // Clear memory
        memoryDedup.clear();
    }
    // ===== In-memory fallback methods =====
    memoryIsDuplicate(messageId, ttlSeconds) {
        const key = `${DEDUP_KEY_PREFIX}${messageId}`;
        const expiry = memoryDedup.get(key);
        if (expiry && expiry > Date.now()) {
            // Key exists and hasn't expired - this is a duplicate
            logger_1.default.debug('Memory deduplication: duplicate found', { messageId });
            return true;
        }
        // Either doesn't exist or has expired - add it
        memoryDedup.set(key, Date.now() + ttlSeconds * 1000);
        // Clean up expired entries occasionally
        if (memoryDedup.size > 1000) {
            this.memoryCleanup();
        }
        logger_1.default.debug('Memory deduplication: new message', { messageId });
        return false;
    }
    memoryClaimMessage(messageId, ttlSeconds) {
        const key = `${DEDUP_KEY_PREFIX}${messageId}`;
        const expiry = memoryDedup.get(key);
        if (expiry && expiry > Date.now()) {
            logger_1.default.debug('Memory deduplication claim rejected: duplicate found', { messageId });
            return false;
        }
        memoryDedup.set(key, Date.now() + ttlSeconds * 1000);
        if (memoryDedup.size > 1000) {
            this.memoryCleanup();
        }
        logger_1.default.debug('Memory deduplication claim accepted: new message', { messageId });
        return true;
    }
    memoryMarkProcessed(messageId, ttlSeconds) {
        const key = `${DEDUP_KEY_PREFIX}${messageId}`;
        memoryDedup.set(key, Date.now() + ttlSeconds * 1000);
        logger_1.default.debug('Memory deduplication: marked processed', { messageId });
    }
    memoryGetCount() {
        this.memoryCleanup(); // Clean first
        return memoryDedup.size;
    }
    memoryCleanup() {
        const now = Date.now();
        for (const [key, expiry] of memoryDedup.entries()) {
            if (expiry < now) {
                memoryDedup.delete(key);
            }
        }
    }
}
exports.DeduplicationService = DeduplicationService;
/**
 * Default deduplication service instance
 */
exports.deduplicationService = new DeduplicationService();
/**
 * Convenience function for checking duplicates
 */
const isMessageDuplicate = (messageId, ttlSeconds) => exports.deduplicationService.isDuplicate(messageId, ttlSeconds);
exports.isMessageDuplicate = isMessageDuplicate;
/**
 * Convenience function for marking messages as processed
 */
const markMessageProcessed = (messageId, ttlSeconds) => exports.deduplicationService.markProcessed(messageId, ttlSeconds);
exports.markMessageProcessed = markMessageProcessed;
