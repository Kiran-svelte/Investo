import { getCacheType, getRedis } from '../../config/redis';

export function getQueueRedisConnection() {
  return getRedis();
}

export function getQueueStorageMode(): 'redis' | 'memory_fallback' {
  return getRedis() ? 'redis' : getCacheType() === 'memory' ? 'memory_fallback' : 'redis';
}
