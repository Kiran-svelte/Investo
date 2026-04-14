import { Redis } from '@upstash/redis';
export declare function getRedis(): Redis | null;
export declare function cacheGet<T>(key: string): Promise<T | null>;
export declare function cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
export declare function cacheDel(key: string): Promise<void>;
export declare function getCacheType(): string;
export default getRedis;
//# sourceMappingURL=redis.d.ts.map