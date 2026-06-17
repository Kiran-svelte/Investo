#!/usr/bin/env node
/**
 * Synthetic uptime checks for Investo production/staging.
 *
 * Usage:
 *   npm run synthetic
 *   SYNTHETIC_BASE_URL=https://investo-backend-production.up.railway.app npm run synthetic
 *   FEATURE_SLO_ALERTS=true SLO_ALERT_WEBHOOK=https://events.pagerduty.com/... npm run synthetic -- --alert
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

const baseUrl = (
  process.env.SYNTHETIC_BASE_URL
  || process.env.SMOKE_BASE_URL
  || process.env.BACKEND_PUBLIC_URL
  || 'https://investo-backend-production.up.railway.app'
).replace(/\/+$/, '');

const sendAlert = process.argv.includes('--alert');
const failures = [];

async function runHttpChecks() {
  const checks = [
    { id: 'api_live', path: '/api/health/live', expectOk: true },
    { id: 'db_ready', path: '/api/health', expectOk: true },
    {
      id: 'webhook_reachable',
      path: '/api/webhook?hub.mode=subscribe&hub.verify_token=invalid&hub.challenge=probe',
      expectOk: false,
      expectStatus: 403,
    },
  ];

  for (const check of checks) {
    const url = `${baseUrl}${check.path}`;
    const started = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const durationMs = Date.now() - started;
      const ok = check.expectStatus ? res.status === check.expectStatus : res.ok;
      if (!ok) {
        failures.push(`${check.id} failed: HTTP ${res.status} (${durationMs}ms) ${url}`);
      } else {
        console.log(`OK ${check.id} ${durationMs}ms ${url}`);
      }
    } catch (err) {
      failures.push(`${check.id} unreachable (${url}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function runStatusApiCheck() {
  if (process.env.FEATURE_PUBLIC_STATUS_API !== 'true') {
    console.log('SKIP /api/status (FEATURE_PUBLIC_STATUS_API not true)');
    return;
  }

  const url = `${baseUrl}/api/status`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const body = await res.json();
    if (!res.ok || !body?.components) {
      failures.push(`Status API failed: ${res.status}`);
      return;
    }
    console.log(`OK status_api components=${body.components.length} overall=${body.status}`);
  } catch (err) {
    failures.push(`Status API unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function runUnitSyntheticSuite() {
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'jest',
      'src/tests/unit/syntheticCheck.service.test.ts',
      'src/tests/unit/slo.service.test.ts',
      'src/tests/unit/metricsMiddleware.test.ts',
      '--runInBand',
      '--forceExit',
    ],
    {
      cwd: backendRoot,
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32',
    },
  );

  if (result.status !== 0) {
    failures.push('Synthetic unit test suite failed');
  }
}

async function maybeSendTestAlert() {
  if (!sendAlert) return;
  const webhook = process.env.SLO_ALERT_WEBHOOK || process.env.PAGERDUTY_EVENTS_WEBHOOK;
  if (!webhook) {
    console.log('SKIP test alert (SLO_ALERT_WEBHOOK not set)');
    return;
  }

  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'slo_alert',
        severity: 'p2',
        rule_id: 'synthetic_monitor_test',
        generated_at: new Date().toISOString(),
        overall_status: 'operational',
        indicator: {
          id: 'test',
          name: 'Synthetic monitor heartbeat',
          status: 'ok',
          value: 0,
          target: 1,
          burn_rate: 0,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      failures.push(`Test alert webhook failed: HTTP ${res.status}`);
      return;
    }
    console.log('OK test alert webhook');
  } catch (err) {
    failures.push(`Test alert webhook error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`Synthetic monitor base URL: ${baseUrl}`);
await runHttpChecks();
await runStatusApiCheck();
runUnitSyntheticSuite();
await maybeSendTestAlert();

if (failures.length) {
  console.error('\nSynthetic monitor FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('\nSynthetic monitor passed.');
process.exit(0);
