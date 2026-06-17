import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

const register = new Registry();
collectDefaultMetrics({ register, prefix: 'investo_' });

export const httpRequestsTotal = new Counter({
  name: 'investo_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'company_id_hash'] as const,
  registers: [register],
});

export const httpRequestDurationMs = new Histogram({
  name: 'investo_http_request_duration_ms',
  help: 'HTTP request latency in milliseconds',
  labelNames: ['method', 'route', 'status_code', 'company_id_hash'] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [register],
});

export const webhookAckDurationMs = new Histogram({
  name: 'investo_webhook_ack_duration_ms',
  help: 'WhatsApp webhook ACK latency in milliseconds',
  labelNames: ['status_code'] as const,
  buckets: [10, 25, 50, 100, 150, 200, 300, 500, 1000, 2500],
  registers: [register],
});

export const whatsAppTurnCompletionMs = new Histogram({
  name: 'investo_whatsapp_turn_completion_ms',
  help: 'WhatsApp inbound job processing duration in milliseconds',
  labelNames: ['status'] as const,
  buckets: [100, 250, 500, 1000, 2500, 5000, 10000, 15000, 30000, 60000],
  registers: [register],
});

export const whatsAppQueueDepth = new Gauge({
  name: 'investo_whatsapp_queue_depth',
  help: 'WhatsApp inbound queue depth by job status',
  labelNames: ['status'] as const,
  registers: [register],
});

export const workerLagMs = new Gauge({
  name: 'investo_worker_lag_ms',
  help: 'Oldest due worker job age in milliseconds',
  labelNames: ['queue'] as const,
  registers: [register],
});

export const metaCircuitBreakerState = new Gauge({
  name: 'investo_meta_circuit_state',
  help: 'Meta WhatsApp circuit breaker state. 1 for current state, 0 otherwise.',
  labelNames: ['state'] as const,
  registers: [register],
});

export const aiLlmCallsTotal = new Counter({
  name: 'investo_ai_llm_calls_total',
  help: 'AI LLM calls by provider and status',
  labelNames: ['provider', 'status'] as const,
  registers: [register],
});

export const aiTokensTotal = new Counter({
  name: 'investo_ai_tokens_total',
  help: 'Estimated AI tokens consumed by provider',
  labelNames: ['provider'] as const,
  registers: [register],
});

export const aiFallbacksTotal = new Counter({
  name: 'investo_ai_fallbacks_total',
  help: 'AI fallback decisions by reason',
  labelNames: ['reason'] as const,
  registers: [register],
});

export const sloBurnRate = new Gauge({
  name: 'investo_slo_burn_rate',
  help: 'Current SLO burn rate estimate by SLO id',
  labelNames: ['slo'] as const,
  registers: [register],
});

function normalizeRoutePath(path: string): string {
  const withoutQuery = path.split('?')[0];
  return withoutQuery
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

export function recordHttpRequestMetrics(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number,
  companyIdHash = 'public',
): void {
  const route = normalizeRoutePath(path);
  const labels = {
    method: method.toUpperCase(),
    route,
    status_code: String(statusCode),
    company_id_hash: companyIdHash,
  };
  httpRequestsTotal.inc(labels);
  httpRequestDurationMs.observe(labels, durationMs);
}

export function recordWebhookAckMetrics(statusCode: number, durationMs: number): void {
  webhookAckDurationMs.observe({ status_code: String(statusCode) }, durationMs);
}

export function recordWhatsAppTurnMetrics(status: string, durationMs: number): void {
  whatsAppTurnCompletionMs.observe({ status }, durationMs);
}

export function setWhatsAppQueueMetrics(depthByStatus: Record<string, number>, lagMs: number): void {
  for (const status of ['pending', 'processing', 'failed', 'dlq', 'completed']) {
    whatsAppQueueDepth.set({ status }, depthByStatus[status] ?? 0);
  }
  workerLagMs.set({ queue: 'whatsapp_inbound' }, Math.max(0, lagMs));
}

export function setMetaCircuitBreakerMetric(state: 'closed' | 'open' | 'half_open'): void {
  for (const candidate of ['closed', 'open', 'half_open'] as const) {
    metaCircuitBreakerState.set({ state: candidate }, candidate === state ? 1 : 0);
  }
}

export function recordAiUsageMetric(params: {
  provider: string;
  status: 'success' | 'failed' | 'fallback';
  tokens?: number;
  fallbackReason?: string;
}): void {
  aiLlmCallsTotal.inc({ provider: params.provider || 'unknown', status: params.status });
  if (params.tokens && params.tokens > 0) {
    aiTokensTotal.inc({ provider: params.provider || 'unknown' }, params.tokens);
  }
  if (params.status === 'fallback' || params.fallbackReason) {
    aiFallbacksTotal.inc({ reason: params.fallbackReason || 'unspecified' });
  }
}

export function setSloBurnRateMetric(slo: string, burnRate: number): void {
  sloBurnRate.set({ slo }, Number.isFinite(burnRate) ? burnRate : 0);
}

export async function getPrometheusMetrics(): Promise<string> {
  return register.metrics();
}

export function getPrometheusContentType(): string {
  return register.contentType;
}
