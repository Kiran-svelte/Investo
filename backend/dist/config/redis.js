"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedis = getRedis;
exports.cacheGet = cacheGet;
exports.cacheSet = cacheSet;
exports.cacheDel = cacheDel;
exports.getCacheType = getCacheType;
exports.cacheIncr = cacheIncr;
const redis_1 = require("@upstash/redis");
const index_1 = __importDefault(require("./index"));
const logger_1 = __importDefault(require("./logger"));
let redis = null;
let upstashAvailable = false;
// In-memory cache fallback (Map with TTL)
const memCache = new Map();
function getRedis() {
    if (redis)
        return redis;
    const redisConfig = index_1.default.redis ?? { url: '', token: '' };
    if (!redisConfig.url || !redisConfig.token) {
        if (index_1.default.env === 'production') {
            // In production, Redis is required for distributed dedup, rate limiting,
            // and job queues. Warn loudly — the process continues but in degraded mode
            // until the next deployment with UPSTASH_REDIS_REST_URL configured.
            logger_1.default.error('CRITICAL: Upstash Redis is not configured in production (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing). ' +
                'Rate limits, dedup, and job queues will be per-instance in-memory only. ' +
                'Set these environment variables and redeploy.');
        }
        else {
            logger_1.default.warn('Upstash Redis not configured — using in-memory cache');
        }
        return null;
    }
    try {
        redis = new redis_1.Redis({
            url: redisConfig.url,
            token: redisConfig.token,
        });
        logger_1.default.info('Upstash Redis client initialized');
        return redis;
    }
    catch (err) {
        logger_1.default.error('Failed to init Redis', { error: err.message });
        return null;
    }
}
// Test Upstash connectivity on first use
async function testUpstash() {
    const r = getRedis();
    if (!r)
        return false;
    try {
        await r.ping();
        upstashAvailable = true;
        logger_1.default.info('Upstash Redis connection verified');
        return true;
    }
    catch {
        logger_1.default.warn('Upstash Redis unreachable — falling back to in-memory cache');
        upstashAvailable = false;
        return false;
    }
}
let testedOnce = false;
// Cache helpers with TTL (seconds)
async function cacheGet(key) {
    if (!testedOnce) {
        testedOnce = true;
        await testUpstash();
    }
    if (upstashAvailable) {
        const r = getRedis();
        if (r) {
            try {
                return await r.get(key);
            }
            catch { /* fall through */ }
        }
    }
    // In-memory fallback
    const entry = memCache.get(key);
    if (entry && entry.expiresAt > Date.now()) {
        return entry.value;
    }
    memCache.delete(key);
    return null;
}
async function cacheSet(key, value, ttlSeconds = 300) {
    if (upstashAvailable) {
        const r = getRedis();
        if (r) {
            try {
                await r.set(key, value, { ex: ttlSeconds });
                return;
            }
            catch { /* fall through */ }
        }
    }
    // In-memory fallback
    memCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}
async function cacheDel(key) {
    if (upstashAvailable) {
        const r = getRedis();
        if (r) {
            try {
                await r.del(key);
            }
            catch { /* swallow */ }
        }
    }
    memCache.delete(key);
}
function getCacheType() {
    return upstashAvailable ? 'upstash' : 'memory';
}
/** Increment a counter with TTL (rate limits, ops metrics). */
async function cacheIncr(key, ttlSeconds = 60) {
    if (!testedOnce) {
        testedOnce = true;
        await testUpstash();
    }
    if (upstashAvailable) {
        const r = getRedis();
        if (r) {
            try {
                const n = await r.incr(key);
                if (n === 1) {
                    await r.expire(key, ttlSeconds);
                }
                return Number(n);
            }
            catch {
                /* fall through */
            }
        }
    }
    const memKey = `incr:${key}`;
    const entry = memCache.get(memKey);
    const now = Date.now();
    if (!entry || entry.expiresAt <= now) {
        memCache.set(memKey, { value: 1, expiresAt: now + ttlSeconds * 1000 });
        return 1;
    }
    const next = Number(entry.value) + 1;
    memCache.set(memKey, { value: next, expiresAt: entry.expiresAt });
    return next;
}
exports.default = getRedis;
