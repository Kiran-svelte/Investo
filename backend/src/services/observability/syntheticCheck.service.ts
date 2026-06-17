import config from '../../config';
import { cacheGet, cacheSet } from '../../config/redis';
import logger from '../../config/logger';

export type SyntheticCheckId =
  | 'api_live'
  | 'db_ready'
  | 'webhook_reachable'
  | 'worker_heartbeat'
  | 'auth_flow';

export interface SyntheticCheckResult {
  id: SyntheticCheckId;
  name: string;
  ok: boolean;
  statusCode: number | null;
  durationMs: number;
  detail: string;
  skipped?: boolean;
}

export interface SyntheticRunReport {
  generated_at: string;
  base_url: string;
  passed: number;
  failed: number;
  skipped: number;
  overall_ok: boolean;
  checks: SyntheticCheckResult[];
}

const WORKER_HEARTBEAT_KEY = 'ops:worker:heartbeat';

function resolveBaseUrl(override?: string): string {
  const base = (override || config.observability.syntheticBaseUrl || 'http://127.0.0.1:3001').replace(/\/+$/, '');
  return base;
}

async function fetchCheck(
  id: SyntheticCheckId,
  name: string,
  path: string,
  baseUrl: string,
  options: RequestInit = {},
): Promise<SyntheticCheckResult> {
  const started = Date.now();
  const url = `${baseUrl}${path}`;

  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(15_000),
    });
    const durationMs = Date.now() - started;
    const ok = response.ok;

    return {
      id,
      name,
      ok,
      statusCode: response.status,
      durationMs,
      detail: ok ? 'ok' : `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      id,
      name,
      ok: false,
      statusCode: null,
      durationMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runSyntheticChecks(params?: {
  baseUrl?: string;
  includeAuthFlow?: boolean;
}): Promise<SyntheticRunReport> {
  const baseUrl = resolveBaseUrl(params?.baseUrl);
  const checks: SyntheticCheckResult[] = [];

  checks.push(await fetchCheck('api_live', 'API live', '/api/health/live', baseUrl));
  checks.push(await fetchCheck('db_ready', 'Database ready', '/api/health', baseUrl));

  checks.push(await fetchCheck(
    'webhook_reachable',
    'Webhook verify endpoint',
    '/api/webhook?hub.mode=subscribe&hub.verify_token=invalid&hub.challenge=probe',
    baseUrl,
  ).then((result) => ({
    ...result,
    ok: result.statusCode === 403 || result.ok,
    detail: result.statusCode === 403 ? 'reachable (403 on invalid token)' : result.detail,
  })));

  const workerHeartbeat = await cacheGet<number>(WORKER_HEARTBEAT_KEY);
  checks.push({
    id: 'worker_heartbeat',
    name: 'Worker heartbeat',
    ok: typeof workerHeartbeat === 'number' && workerHeartbeat > 0,
    statusCode: null,
    durationMs: 0,
    detail: typeof workerHeartbeat === 'number'
      ? `last_heartbeat_ms=${workerHeartbeat}`
      : 'no heartbeat key in cache (worker may be offline or Redis unavailable)',
    skipped: false,
  });

  const authEmail = process.env.SYNTHETIC_AUTH_EMAIL;
  const authPassword = process.env.SYNTHETIC_AUTH_PASSWORD;
  if (params?.includeAuthFlow !== false && authEmail && authPassword) {
    const loginStarted = Date.now();
    try {
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
        signal: AbortSignal.timeout(20_000),
      });
      const loginBody = await loginRes.json().catch(() => ({})) as { accessToken?: string; token?: string };
      const token = loginBody?.accessToken || loginBody?.token;
      if (!loginRes.ok || !token) {
        checks.push({
          id: 'auth_flow',
          name: 'Auth flow',
          ok: false,
          statusCode: loginRes.status,
          durationMs: Date.now() - loginStarted,
          detail: 'login failed',
        });
      } else {
        const leadsRes = await fetch(`${baseUrl}/api/leads?limit=1`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(15_000),
        });
        checks.push({
          id: 'auth_flow',
          name: 'Auth flow',
          ok: leadsRes.ok,
          statusCode: leadsRes.status,
          durationMs: Date.now() - loginStarted,
          detail: leadsRes.ok ? 'login + leads ok' : `leads HTTP ${leadsRes.status}`,
        });
      }
    } catch (err) {
      checks.push({
        id: 'auth_flow',
        name: 'Auth flow',
        ok: false,
        statusCode: null,
        durationMs: Date.now() - loginStarted,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    checks.push({
      id: 'auth_flow',
      name: 'Auth flow',
      ok: true,
      statusCode: null,
      durationMs: 0,
      detail: 'skipped (SYNTHETIC_AUTH_EMAIL/PASSWORD not set)',
      skipped: true,
    });
  }

  const passed = checks.filter((check) => check.ok && !check.skipped).length;
  const failed = checks.filter((check) => !check.ok && !check.skipped).length;
  const skipped = checks.filter((check) => check.skipped).length;
  const overallOk = failed === 0;

  const report: SyntheticRunReport = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    passed,
    failed,
    skipped,
    overall_ok: overallOk,
    checks,
  };

  if (!overallOk) {
    logger.warn('Synthetic monitor failed', {
      failed,
      checks: checks.filter((check) => !check.ok && !check.skipped).map((check) => ({
        id: check.id,
        detail: check.detail,
      })),
    });
  }

  return report;
}

export async function touchWorkerHeartbeat(): Promise<void> {
  await cacheSet(WORKER_HEARTBEAT_KEY, Date.now(), 600);
}

export async function persistSyntheticReport(report: SyntheticRunReport): Promise<void> {
  await cacheSet('ops:synthetic:last_report', report, 3600);
}

export async function getLastSyntheticReport(): Promise<SyntheticRunReport | null> {
  return cacheGet<SyntheticRunReport>('ops:synthetic:last_report');
}
