/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    observability: {
      metricsEnabled: true,
      grafanaBaseUrl: 'https://grafana.example.com',
      statusPageUrl: 'https://status.example.com',
      sloAlertWebhook: 'https://alerts.example.com/hook',
      siemLogDrain: 'https://logs.example.com/drain',
    },
    features: {
      prometheusMetrics: true,
      sloAlerts: true,
      publicStatusApi: true,
    },
  },
}));

jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    whatsAppJob: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  },
}));

jest.mock('../../config/redis', () => ({
  getCacheType: jest.fn().mockReturnValue('memory'),
}));

jest.mock('../../services/opsMetrics.service', () => ({
  getOpsMetricsSnapshot: jest.fn().mockResolvedValue({
    uptime_seconds: 3600,
    cache_backend: 'memory',
    counters: {
      http_requests: 1000,
      errors_5xx: 1,
      webhook_inbound: 50,
      ai_replies: 20,
    },
    latency_buckets: { p50: 80, p95: 220, p99: 400, sample_count: 1000 },
    automation_queue_depth: 0,
    timestamp: new Date().toISOString(),
  }),
}));

jest.mock('../../services/metaCircuitBreaker.service', () => ({
  getMetaApiCircuitState: jest.fn().mockReturnValue('closed'),
}));

jest.mock('../../services/prometheusMetrics.service', () => ({
  setWhatsAppQueueMetrics: jest.fn(),
  setMetaCircuitBreakerMetric: jest.fn(),
  setSloBurnRateMetric: jest.fn(),
}));

import { buildSloSnapshot } from '../../services/observability/slo.service';
import { SLO_TARGETS } from '../../constants/sloTargets';

describe('slo.service', () => {
  it('returns six SLI indicators aligned with sloTargets SSOT', async () => {
    const snapshot = await buildSloSnapshot();

    expect(snapshot.indicators).toHaveLength(6);
    expect(snapshot.indicators.map((indicator) => indicator.id)).toEqual([
      SLO_TARGETS.apiAvailabilityMonthly.id,
      SLO_TARGETS.apiLatencyP95Ms.id,
      SLO_TARGETS.webhookAckP95Ms.id,
      SLO_TARGETS.whatsappTurnCompletionP95Ms.id,
      SLO_TARGETS.errorRate5xx.id,
      SLO_TARGETS.workerLagP95Ms.id,
    ]);
  });

  it('computes error budget burn rate from 5xx ratio', async () => {
    const snapshot = await buildSloSnapshot();
    const errorIndicator = snapshot.indicators.find((indicator) => indicator.id === 'error_rate_5xx');

    expect(errorIndicator?.value).toBeCloseTo(0.001, 5);
    expect(errorIndicator?.burn_rate).toBeCloseTo(1, 1);
  });

  it('includes public status components and alerting rules', async () => {
    const snapshot = await buildSloSnapshot();

    expect(snapshot.components.length).toBeGreaterThanOrEqual(6);
    expect(snapshot.alerting.rules).toHaveLength(2);
    expect(snapshot.external_links.grafana_url).toBe('https://grafana.example.com');
    expect(snapshot.external_links.status_page_url).toBe('https://status.example.com');
  });
});
