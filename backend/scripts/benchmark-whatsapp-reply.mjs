#!/usr/bin/env node
/**
 * WhatsApp reply speed benchmark — run before deploy.
 *
 * Usage:
 *   npm run benchmark:reply-speed
 *   SMOKE_BASE_URL=https://investo-backend-production.up.railway.app npm run benchmark:reply-speed
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

function runJestPerfSuite() {
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    [
      'jest',
      'src/tests/unit/whatsappReplySpeed.util.test.ts',
      'src/tests/unit/load-health.perf.test.ts',
      'src/tests/unit/whatsappPresence.service.test.ts',
      '--runInBand',
      '--forceExit',
    ],
    { cwd: backendRoot, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' },
  );
  if (result.status !== 0) {
    failures.push('Reply-speed Jest perf suite failed');
  }
}

async function probeHealthLive() {
  const url = `${baseUrl}/api/health/live`;
  const times = [];
  for (let i = 0; i < 20; i += 1) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        failures.push(`Health live returned ${res.status}`);
        return;
      }
      times.push(Date.now() - t0);
    } catch (err) {
      failures.push(`Health live unreachable: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }
  const sorted = [...times].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(`Health live latency (20 probes): p50=${p50}ms p95=${p95}ms`);
  if (p95 > 1500) {
    failures.push(`Health live p95 ${p95}ms exceeds 1500ms budget`);
  }
}

console.log('Benchmark: WhatsApp reply speed');
console.log(`Base URL: ${baseUrl}`);
console.log('');
console.log('Targets (fast mode default ON):');
console.log('  - Artificial pacing delay: 0ms (none mode)');
console.log('  - Buyer LLM wall timeout: 12s');
console.log('  - Staff copilot wall timeout: 18s');
console.log('  - Health live p95: <1500ms');
console.log('');

runJestPerfSuite();
await probeHealthLive();

if (failures.length) {
  console.error('\nBenchmark FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('\nBenchmark passed — reply pacing and latency budgets OK.');
process.exit(0);
