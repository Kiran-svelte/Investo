import { getRedis } from '../config/redis';
import logger from '../config/logger';

/**
 * Best-effort distributed lock for cron handlers.
 * When Redis is unavailable, returns true (single-process Railway fallback).
 */
export async function tryAcquireCronLeaderLock(
  lockName: string,
  ttlSeconds: number,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;

  const key = `cron:leader:${lockName}`;
  try {
    const acquired = await redis.set(key, String(Date.now()), { nx: true, ex: ttlSeconds });
    return acquired === 'OK';
  } catch (err: unknown) {
    logger.warn('cronLeaderLock: acquire failed — running without lock', {
      lockName,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}
