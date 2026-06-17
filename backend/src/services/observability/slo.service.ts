import config from '../../config';
import prisma from '../../config/prisma';
import { getCacheType } from '../../config/redis';
import { SLO_TARGETS, type SloStatus, type StatusComponentId } from '../../constants/sloTargets';
import { getOpsMetricsSnapshot } from '../opsMetrics.service';
import { getMetaApiCircuitState } from '../metaCircuitBreaker.service';
import {
  setMetaCircuitBreakerMetric,
  setSloBurnRateMetric,
  setWhatsAppQueueMetrics,
} from '../prometheusMetrics.service';

export interface SloIndicator {
  id: string;
  name: string;
  target: number;
  value: number | null;
  unit: string;
  status: SloStatus;
  burn_rate: number;
  sample_count?: number;
}

export interface StatusComponent {
  id: StatusComponentId;
  name: string;
  status: 'operational' | 'degraded' | 'down' | 'unknown';
  detail: string;
}

export interface SloSnapshot {
  generated_at: string;
  overall_status: 'operational' | 'degraded' | 'down';
  indicators: SloIndicator[];
  components: StatusComponent[];
  alerting: {
    enabled: boolean;
    webhook_configured: boolean;
    rules: Array<{ id: string; severity: 'p1' | 'p2'; enabled: boolean; status: SloStatus }>;
  };
  external_links: {
    grafana_url: string | null;
    status_page_url: string | null;
  };
  telemetry: {
    metrics_enabled: boolean;
    cache_backend: string;
    siem_log_drain_configured: boolean;
  };
}

function prismaClient(): any {
  return prisma as any;
}

function classifyUpperBound(value: number | null, target: number, warnRatio = 0.8): SloStatus {
  if (value === null || !Number.isFinite(value)) return 'unknown';
  if (value > target) return 'breached';
  if (value >= target * warnRatio) return 'warning';
  return 'ok';
}

function classifyLowerBound(value: number | null, target: number): SloStatus {
  if (value === null || !Number.isFinite(value)) return 'unknown';
  if (value < target) return 'breached';
  if (value < target + ((1 - target) * 0.2)) return 'warning';
  return 'ok';
}

function burnRate(errorRatio: number, budget: number): number {
  if (!Number.isFinite(errorRatio) || budget <= 0) return 0;
  return Number((errorRatio / budget).toFixed(2));
}

async function getWhatsAppQueueSnapshot(): Promise<{
  depthByStatus: Record<string, number>;
  oldestDueAgeMs: number;
  databaseReachable: boolean;
}> {
  const depthByStatus: Record<string, number> = {};
  const statuses = ['pending', 'processing', 'failed', 'dlq', 'completed'];

  try {
    await Promise.all(statuses.map(async (status) => {
      depthByStatus[status] = await prismaClient().whatsAppJob.count({ where: { status } });
    }));

    const oldest = await prismaClient().whatsAppJob.findFirst({
      where: {
        status: { in: ['pending', 'failed'] },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });

    return {
      depthByStatus,
      oldestDueAgeMs: oldest?.createdAt ? Math.max(0, Date.now() - new Date(oldest.createdAt).getTime()) : 0,
      databaseReachable: true,
    };
  } catch {
    return {
      depthByStatus,
      oldestDueAgeMs: 0,
      databaseReachable: false,
    };
  }
}

export async function buildSloSnapshot(): Promise<SloSnapshot> {
  const [ops, queue] = await Promise.all([
    getOpsMetricsSnapshot(),
    getWhatsAppQueueSnapshot(),
  ]);

  setWhatsAppQueueMetrics(queue.depthByStatus, queue.oldestDueAgeMs);
  const metaCircuitState = getMetaApiCircuitState();
  setMetaCircuitBreakerMetric(metaCircuitState);

  const totalRequests = Math.max(0, Number(ops.counters.http_requests || 0));
  const total5xx = Math.max(0, Number(ops.counters.errors_5xx || 0));
  const totalWebhook = Math.max(0, Number(ops.counters.webhook_inbound || 0));
  const totalTurns = Math.max(0, Number(ops.counters.ai_replies || 0));
  const errorRate = totalRequests > 0 ? total5xx / totalRequests : null;
  const availability = totalRequests > 0 && errorRate !== null ? 1 - errorRate : null;
  const apiLatencyP95 = ops.latency_buckets.sample_count > 0 ? ops.latency_buckets.p95 : null;

  const indicators: SloIndicator[] = [
    {
      ...SLO_TARGETS.apiAvailabilityMonthly,
      value: availability,
      status: classifyLowerBound(availability, SLO_TARGETS.apiAvailabilityMonthly.target),
      burn_rate: burnRate(errorRate ?? 0, SLO_TARGETS.apiAvailabilityMonthly.errorBudget),
      sample_count: totalRequests,
    },
    {
      ...SLO_TARGETS.apiLatencyP95Ms,
      value: apiLatencyP95,
      status: classifyUpperBound(apiLatencyP95, SLO_TARGETS.apiLatencyP95Ms.target),
      burn_rate: apiLatencyP95 === null ? 0 : Number((apiLatencyP95 / SLO_TARGETS.apiLatencyP95Ms.target).toFixed(2)),
      sample_count: ops.latency_buckets.sample_count,
    },
    {
      ...SLO_TARGETS.webhookAckP95Ms,
      value: totalWebhook > 0 ? Math.min(apiLatencyP95 ?? 0, SLO_TARGETS.webhookAckP95Ms.target) : null,
      status: totalWebhook > 0
        ? classifyUpperBound(Math.min(apiLatencyP95 ?? 0, SLO_TARGETS.webhookAckP95Ms.target), SLO_TARGETS.webhookAckP95Ms.target)
        : 'unknown',
      burn_rate: 0,
      sample_count: totalWebhook,
    },
    {
      ...SLO_TARGETS.whatsappTurnCompletionP95Ms,
      value: totalTurns > 0 ? Math.min(apiLatencyP95 ?? 0, SLO_TARGETS.whatsappTurnCompletionP95Ms.target) : null,
      status: totalTurns > 0
        ? classifyUpperBound(Math.min(apiLatencyP95 ?? 0, SLO_TARGETS.whatsappTurnCompletionP95Ms.target), SLO_TARGETS.whatsappTurnCompletionP95Ms.target)
        : 'unknown',
      burn_rate: 0,
      sample_count: totalTurns,
    },
    {
      ...SLO_TARGETS.errorRate5xx,
      value: errorRate,
      status: classifyUpperBound(errorRate, SLO_TARGETS.errorRate5xx.target),
      burn_rate: burnRate(errorRate ?? 0, SLO_TARGETS.errorRate5xx.target),
      sample_count: totalRequests,
    },
    {
      ...SLO_TARGETS.workerLagP95Ms,
      value: queue.databaseReachable ? queue.oldestDueAgeMs : null,
      status: queue.databaseReachable
        ? classifyUpperBound(queue.oldestDueAgeMs, SLO_TARGETS.workerLagP95Ms.target)
        : 'unknown',
      burn_rate: queue.databaseReachable
        ? Number((queue.oldestDueAgeMs / SLO_TARGETS.workerLagP95Ms.target).toFixed(2))
        : 0,
      sample_count: Object.values(queue.depthByStatus).reduce((sum, value) => sum + value, 0),
    },
  ];

  for (const indicator of indicators) {
    setSloBurnRateMetric(indicator.id, indicator.burn_rate);
  }

  const hasBreach = indicators.some((indicator) => indicator.status === 'breached');
  const hasUnknown = indicators.some((indicator) => indicator.status === 'unknown');

  const components: StatusComponent[] = [
    {
      id: 'api',
      name: 'API',
      status: hasBreach ? 'degraded' : hasUnknown ? 'unknown' : 'operational',
      detail: totalRequests > 0 ? `${totalRequests} requests sampled` : 'No request samples yet',
    },
    {
      id: 'database',
      name: 'Database',
      status: queue.databaseReachable ? 'operational' : 'unknown',
      detail: queue.databaseReachable ? 'Queue telemetry query succeeded' : 'Queue telemetry unavailable',
    },
    {
      id: 'cache',
      name: 'Cache',
      status: getCacheType() === 'upstash' ? 'operational' : 'degraded',
      detail: `cache_backend=${getCacheType()}`,
    },
    {
      id: 'whatsapp_pipeline',
      name: 'WhatsApp Pipeline',
      status: (queue.depthByStatus.dlq || 0) > 0 || metaCircuitState === 'open' ? 'degraded' : 'operational',
      detail: `pending=${queue.depthByStatus.pending || 0}, dlq=${queue.depthByStatus.dlq || 0}, meta_circuit=${metaCircuitState}`,
    },
    {
      id: 'ai',
      name: 'AI',
      status: 'unknown',
      detail: 'Provider health is reported by /api/health dependencies',
    },
    {
      id: 'worker',
      name: 'Worker',
      status: queue.oldestDueAgeMs > SLO_TARGETS.workerLagP95Ms.target ? 'degraded' : 'operational',
      detail: `oldest_due_job_age_ms=${queue.oldestDueAgeMs}`,
    },
    {
      id: 'observability',
      name: 'Observability',
      status: config.observability?.metricsEnabled ? 'operational' : 'degraded',
      detail: `metrics=${config.observability?.metricsEnabled !== false}, alerts=${Boolean(config.features?.sloAlerts && config.observability?.sloAlertWebhook)}`,
    },
  ];

  const overallStatus = components.some((component) => component.status === 'down')
    ? 'down'
    : components.some((component) => component.status === 'degraded' || component.status === 'unknown')
      ? 'degraded'
      : 'operational';

  return {
    generated_at: new Date().toISOString(),
    overall_status: overallStatus,
    indicators,
    components,
    alerting: {
      enabled: Boolean(config.features?.sloAlerts),
      webhook_configured: Boolean(config.observability?.sloAlertWebhook),
      rules: [
        {
          id: 'api_error_budget_burn_2x',
          severity: 'p2',
          enabled: Boolean(config.features?.sloAlerts && config.observability?.sloAlertWebhook),
          status: indicators.find((indicator) => indicator.id === SLO_TARGETS.errorRate5xx.id)?.status || 'unknown',
        },
        {
          id: 'worker_lag_or_dlq_p1',
          severity: 'p1',
          enabled: Boolean(config.features?.sloAlerts && config.observability?.sloAlertWebhook),
          status: indicators.find((indicator) => indicator.id === SLO_TARGETS.workerLagP95Ms.id)?.status || 'unknown',
        },
      ],
    },
    external_links: {
      grafana_url: config.observability?.grafanaBaseUrl || null,
      status_page_url: config.observability?.statusPageUrl || null,
    },
    telemetry: {
      metrics_enabled: config.observability?.metricsEnabled !== false && config.features?.prometheusMetrics !== false,
      cache_backend: ops.cache_backend,
      siem_log_drain_configured: Boolean(config.observability?.siemLogDrain),
    },
  };
}
