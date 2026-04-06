import { Redis } from '@upstash/redis';
import config from './index';
import logger from './logger';

let redis: Redis | null = null;
let upstashAvailable = false;

// In-memory cache fallback (Map with TTL)
const memCache = new Map<string, { value: unknown; expiresAt: number }>();

export function getRedis(): Redis | null {
  if (redis) return redis;
  if (!config.redis.url || !config.redis.token) {
    logger.warn('Upstash Redis not configured — using in-memory cache');
    return null;
  }
  try {
    redis = new Redis({
      url: config.redis.url,
      token: config.redis.token,
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

export default getRedis;
