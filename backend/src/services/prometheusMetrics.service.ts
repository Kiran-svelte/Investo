import { Registry, Counter, Histogram, collectDefaultMetrics } from 'prom-client';

const register = new Registry();
collectDefaultMetrics({ register, prefix: 'investo_' });

export const httpRequestsTotal = new Counter({
  name: 'investo_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

export const httpRequestDurationMs = new Histogram({
  name: 'investo_http_request_duration_ms',
  help: 'HTTP request latency in milliseconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
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
): void {
  const route = normalizeRoutePath(path);
  const labels = {
    method: method.toUpperCase(),
    route,
    status_code: String(statusCode),
  };
  httpRequestsTotal.inc(labels);
  httpRequestDurationMs.observe(labels, durationMs);
}

export async function getPrometheusMetrics(): Promise<string> {
  return register.metrics();
}

export function getPrometheusContentType(): string {
  return register.contentType;
}
