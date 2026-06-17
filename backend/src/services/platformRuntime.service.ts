import { getCacheType, getRedis } from '../config/redis';
import type { PlatformRedisStatus } from './platformMaturity.service';

export async function getPlatformRedisStatus(): Promise<PlatformRedisStatus> {
  const redis = getRedis();
  if (!redis) return 'memory_fallback';

  try {
    await redis.ping();
    return 'ok';
  } catch {
    return getCacheType() === 'memory' ? 'memory_fallback' : 'degraded';
  }
}
