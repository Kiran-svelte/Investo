import { Redis } from '@upstash/redis';
import config from './index';
import logger from './logger';

let redis: Redis | null = null;
let upstashAvailable = false;

// In-memory cache fallback (Map with TTL)
const memCache = new Map<string, { value: unknown; expiresAt: number }>();

export function getRedis(): Redis | null {
  if (redis) return redis;
  const redisConfig = config.redis ?? { url: '', token: '' };
  if (!redisConfig.url || !redisConfig.token) {
    if (config.env === 'production') {
      // In production, Redis is required for distributed dedup, rate limiting,
      // and job queues. Warn loudly — the process continues but in degraded mode
      // until the next deployment with UPSTASH_REDIS_REST_URL configured.
      logger.error(
        'CRITICAL: Upstash Redis is not configured in production (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN missing). ' +
        'Rate limits, dedup, and job queues will be per-instance in-memory only. ' +
        'Set these environment variables and redeploy.',
      );
    } else {
      logger.warn('Upstash Redis not configured — using in-memory cache');
    }
    return null;
  }
  try {
    redis = new Redis({
      url: redisConfig.url,
      token: redisConfig.token,
    });
    logger.info('Upstash Redis client initialized');
    return redis;
  } catch (err: any) {
    logger.error('Failed to init Redis', { error: err.message });
    return null;
  }
}

// Test Upstash connectivity on first use
async function testUpstash(): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    await r.ping();
    upstashAvailable = true;
    logger.info('Upstash Redis connection verified');
    return true;
  } catch {
    logger.warn('Upstash Redis unreachable — falling back to in-memory cache');
    upstashAvailable = false;
    return false;
  }
}

let testedOnce = false;

// Cache helpers with TTL (seconds)
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!testedOnce) { testedOnce = true; await testUpstash(); }

  if (upstashAvailable) {
    const r = getRedis();
    if (r) {
      try { return await r.get<T>(key); } catch { /* fall through */ }
    }
  }

  // In-memory fallback
  const entry = memCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.value as T;
  }
  memCache.delete(key);
  return null;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
  if (upstashAvailable) {
    const r = getRedis();
    if (r) {
      try { await r.set(key, value, { ex: ttlSeconds }); return; } catch { /* fall through */ }
    }
  }

  // In-memory fallback
  memCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheDel(key: string): Promise<void> {
  if (upstashAvailable) {
    const r = getRedis();
    if (r) {
      try { await r.del(key); } catch { /* swallow */ }
    }
  }
  memCache.delete(key);
}

export function getCacheType(): string {
  return upstashAvailable ? 'upstash' : 'memory';
}

/** Increment a counter with TTL (rate limits, ops metrics). */
export async function cacheIncr(key: string, ttlSeconds = 60): Promise<number> {
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
      } catch {
        /* fall through */
      }
    }
  }

  const entry = memCache.get(key);
  const now = Date.now();
  if (!entry || entry.expiresAt <= now) {
    memCache.set(key, { value: 1, expiresAt: now + ttlSeconds * 1000 });
    return 1;
  }
  const next = Number(entry.value) + 1;
  memCache.set(key, { value: next, expiresAt: entry.expiresAt });
  return next;
}

export default getRedis;
