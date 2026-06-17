#!/usr/bin/env node
/**
 * ~5 min smoke: health check + deterministic critical-path assertions.
 *
 * Usage:
 *   npm run smoke
 *   SMOKE_BASE_URL=https://investo-backend-production.up.railway.app npm run smoke
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const baseUrl = (
  process.env.SMOKE_BASE_URL || 'https://investo-backend-production.up.railway.app'
).replace(/\/+$/, '');

const failures = [];

async function checkHealth() {
  const url = `${baseUrl}/api/health/live`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const body = await res.text();
    if (!res.ok) {
      failures.push(`Health check failed: ${res.status} ${body.slice(0, 200)}`);
      return;
    }
    console.log(`OK health ${url}`);
  } catch (err) {
    failures.push(`Health check unreachable (${url}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

function runEnterpriseBaselineSmoke() {
  const result = spawnSync(
    process.execPath,
    ['scripts/enterprise-baseline.mjs'],
    {
      cwd: backendRoot,
      encoding: 'utf8',
      env: process.env,
    },
  );

  if (result.status !== 0) {
    failures.push(`Enterprise baseline CLI failed: ${(result.stderr || result.stdout || '').slice(0, 500)}`);
    return;
  }

  try {
    const report = JSON.parse(result.stdout);
    if (!Array.isArray(report.domains) || report.domains.length !== 12) {
      failures.push(`Enterprise baseline expected 12 domains, got ${report.domains?.length ?? 'unknown'}`);
      return;
    }
    if (typeof report.overall_score !== 'number') {
      failures.push('Enterprise baseline missing numeric overall_score');
      return;
    }
    console.log(`OK enterprise baseline CLI domains=${report.domains.length} score=${report.overall_score}`);
  } catch (err) {
    failures.push(`Enterprise baseline JSON parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function checkEnterpriseHealthEndpoint() {
  const token = process.env.SMOKE_SUPER_ADMIN_TOKEN;
  if (!token) {
    console.log('SKIP /api/health/enterprise live probe (SMOKE_SUPER_ADMIN_TOKEN not set)');
    return;
  }

  const url = `${baseUrl}/api/health/enterprise`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text();
    if (!res.ok) {
      failures.push(`Enterprise health endpoint failed: ${res.status} ${body.slice(0, 200)}`);
      return;
    }
    const report = JSON.parse(body);
    if (!Array.isArray(report.domains) || report.domains.length !== 12) {
      failures.push(`Enterprise health endpoint expected 12 domains, got ${report.domains?.length ?? 'unknown'}`);
      return;
    }
    console.log(`OK enterprise health ${url}`);
  } catch (err) {
    failures.push(`Enterprise health endpoint unreachable (${url}): ${err instanceof Error ? err.message : String(err)}`);
  }
}

function runDeterministicSmoke() {
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'jest',
      'src/tests/smoke/critical-paths.smoke.test.ts',
      '--runInBand',
      '--detectOpenHandles',
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
    failures.push('Deterministic smoke Jest suite failed');
  }
}

console.log('Smoke: critical buyer paths');
console.log(`Base URL: ${baseUrl}`);
console.log('');
console.log('Manual / webhook paths (when WhatsApp E2E unavailable):');
console.log('  - Send brochure: buyer message "Send brochure for <property>" → workflow brochure_request');
console.log('  - Book visit Saturday 4pm: buyer message with visit scheduling intent → visit_booking stage');
console.log('  - When is my visit?: buyer visit status query → buildBuyerVisitStatusReply (H5)');
console.log('');

await checkHealth();
runEnterpriseBaselineSmoke();
await checkEnterpriseHealthEndpoint();

async function runSyntheticHttpChecks() {
  const checks = [
    { id: 'api_live', path: '/api/health/live' },
    { id: 'db_ready', path: '/api/health' },
  ];
  for (const check of checks) {
    const url = `${baseUrl}${check.path}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        failures.push(`Synthetic ${check.id} failed: HTTP ${res.status} ${url}`);
      } else {
        console.log(`OK synthetic ${check.id} ${url}`);
      }
    } catch (err) {
      failures.push(`Synthetic ${check.id} unreachable (${url}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

await runSyntheticHttpChecks();
runDeterministicSmoke();

if (failures.length) {
  console.error('\nSmoke FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('\nSmoke passed.');
process.exit(0);
