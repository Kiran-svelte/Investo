export const SLO_TARGETS = {
  apiAvailabilityMonthly: {
    id: 'api_availability_monthly',
    name: 'API availability',
    target: 0.999,
    unit: 'ratio',
    errorBudget: 0.001,
  },
  apiLatencyP95Ms: {
    id: 'api_latency_p95_ms',
    name: 'API latency p95',
    target: 500,
    unit: 'ms',
  },
  webhookAckP95Ms: {
    id: 'webhook_ack_p95_ms',
    name: 'Webhook ACK p95',
    target: 200,
    unit: 'ms',
  },
  whatsappTurnCompletionP95Ms: {
    id: 'whatsapp_turn_completion_p95_ms',
    name: 'WhatsApp turn completion p95',
    target: 15000,
    unit: 'ms',
  },
  errorRate5xx: {
    id: 'error_rate_5xx',
    name: '5xx error rate',
    target: 0.001,
    unit: 'ratio',
  },
  workerLagP95Ms: {
    id: 'worker_lag_p95_ms',
    name: 'Worker lag p95',
    target: 60000,
    unit: 'ms',
  },
} as const;

export type SloStatus = 'ok' | 'warning' | 'breached' | 'unknown';

export const STATUS_COMPONENTS = [
  'api',
  'database',
  'cache',
  'whatsapp_pipeline',
  'ai',
  'worker',
  'observability',
] as const;

export type StatusComponentId = (typeof STATUS_COMPONENTS)[number];
