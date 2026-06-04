import { cacheGet, cacheIncr, cacheSet, getCacheType } from '../config/redis';

const COUNTERS = [
  'http_requests',
  'webhook_inbound',
  'ai_replies',
  'workflow_runs',
  'whatsapp_outbound',
  'errors_5xx',
  'rate_limited',
] as const;

export type OpsMetricName = (typeof COUNTERS)[number];

const localCounts: Record<string, number> = Object.fromEntries(COUNTERS.map((k) => [k, 0]));
const startedAt = Date.now();

export function incrementOpsMetric(name: OpsMetricName, delta = 1): void {
  localCounts[name] = (localCounts[name] ?? 0) + delta;
  void cacheIncr(`ops:${name}`, 86_400).catch(() => undefined);
}

export async function getOpsMetricsSnapshot(): Promise<{
  uptime_seconds: number;
  cache_backend: string;
  counters: Record<string, number>;
  timestamp: string;
}> {
  const merged: Record<string, number> = { ...localCounts };
  for (const name of COUNTERS) {
    try {
      const cached = await cacheGet<number>(`ops:${name}`);
      if (typeof cached === 'number' && cached > (merged[name] ?? 0)) {
        merged[name] = cached;
      }
    } catch {
      // ignore
    }
  }

  return {
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    cache_backend: getCacheType(),
    counters: merged,
    timestamp: new Date().toISOString(),
  };
}

/** Persist daily rollup for agency reporting (lightweight). */
export async function recordDailyOpsRollup(): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const snap = await getOpsMetricsSnapshot();
  await cacheSet(`ops:rollup:${day}`, snap.counters, 86_400 * 8);
}
