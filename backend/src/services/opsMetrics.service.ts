import { cacheGet, cacheIncr, cacheSet, getCacheType } from '../config/redis';

const COUNTERS = [
  'http_requests',
  'webhook_inbound',
  'ai_replies',
  'workflow_runs',
  'workflow_idempotency_hits',
  // AI quality signals: how often the classifier asked to clarify vs fell
  // through to the language brain. Used to measure routing accuracy.
  'workflow_clarification',
  'workflow_fallthrough',
  'whatsapp_outbound',
  'errors_5xx',
  'rate_limited',
  'slow_requests',
  // Autonomous agent observability — idempotency wins and retry activity.
  'visit_idem_hit',
  'call_idem_hit',
  'booking_approval_idem_hit',
  'booking_approval_created',
  'booking_approval_approved',
  'booking_approval_declined',
  'booking_approval_expired',
  'notification_retry',
] as const;

export type OpsMetricName = (typeof COUNTERS)[number];

const localCounts: Record<string, number> = Object.fromEntries(COUNTERS.map((k) => [k, 0]));
const startedAt = Date.now();

/** Rolling window for HTTP latency percentiles (last N samples). */
const LATENCY_WINDOW_SIZE = 500;
const latencySamples: number[] = [];

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

export function recordLatency(durationMs: number): void {
  latencySamples.push(durationMs);
  if (latencySamples.length > LATENCY_WINDOW_SIZE) {
    latencySamples.splice(0, latencySamples.length - LATENCY_WINDOW_SIZE);
  }
}

export function getLatencyPercentiles(): { p50: number; p95: number; p99: number; sample_count: number } {
  if (!latencySamples.length) {
    return { p50: 0, p95: 0, p99: 0, sample_count: 0 };
  }
  const sorted = [...latencySamples].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    sample_count: sorted.length,
  };
}

export function incrementOpsMetric(name: OpsMetricName, delta = 1): void {
  localCounts[name] = (localCounts[name] ?? 0) + delta;
  void cacheIncr(`ops:${name}`, 86_400).catch(() => undefined);
}

export async function getOpsMetricsSnapshot(): Promise<{
  uptime_seconds: number;
  cache_backend: string;
  counters: Record<string, number>;
  latency_buckets: ReturnType<typeof getLatencyPercentiles>;
  automation_queue_depth: number;
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

  // Snapshot automation queue depth (pending job count) for health monitoring.
  // A sustained high depth indicates the worker is not keeping up.
  let automationQueueDepth = 0;
  try {
    const { automationQueueService } = await import('./automationQueue.service');
    const redis = (await import('../config/redis')).getRedis();
    if (redis) {
      const keys = await redis.keys('automation:job:*');
      automationQueueDepth = keys.length;
    } else {
      // Memory store: ask the service via a safe cast
      const pendingJobs = await automationQueueService.findExistingJobsForVisits([], []);
      automationQueueDepth = pendingJobs.length;
    }
  } catch {
    automationQueueDepth = -1; // -1 = could not sample
  }

  return {
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    cache_backend: getCacheType(),
    counters: merged,
    latency_buckets: getLatencyPercentiles(),
    automation_queue_depth: automationQueueDepth,
    timestamp: new Date().toISOString(),
  };
}

/** Persist daily rollup for agency reporting (lightweight). */
export async function recordDailyOpsRollup(): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const snap = await getOpsMetricsSnapshot();
  await cacheSet(`ops:rollup:${day}`, snap.counters, 86_400 * 8);
}

/** UTC cron: 2:00 AM IST — nightly ops counter rollup. */
export const DAILY_OPS_ROLLUP_CRON = '30 20 * * *';
