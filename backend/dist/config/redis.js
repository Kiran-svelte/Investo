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
    if (!index_1.default.redis.url || !index_1.default.redis.token) {
        logger_1.default.warn('Upstash Redis not configured — using in-memory cache');
        return null;
    }
    try {
        redis = new redis_1.Redis({
            url: index_1.default.redis.url,
            token: index_1.default.redis.token,
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
exports.default = getRedis;
