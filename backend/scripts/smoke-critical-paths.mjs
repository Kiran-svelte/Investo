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
runDeterministicSmoke();

if (failures.length) {
  console.error('\nSmoke FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('\nSmoke passed.');
process.exit(0);
