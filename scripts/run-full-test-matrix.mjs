#!/usr/bin/env node
/**
 * Investo full test matrix: unit, integration, regression (e2e), smoke, production build, load/perf.
 * Exit 0 only when all stages pass.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const frontend = path.join(root, 'frontend');

function run(label, cmd, args, cwd, env = {}) {
  console.log(`\n========== ${label} ==========\n`);
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env, FORCE_COLOR: '0', CI: '1' },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    console.error(`\n[FAIL] ${label} (exit ${r.status ?? 1})`);
    process.exit(r.status ?? 1);
  }
  console.log(`\n[PASS] ${label}`);
}

// 1. Unit — backend
run('UNIT (backend)', 'npm', ['run', 'test:unit'], backend);

// 2. Unit — frontend (vitest)
run('UNIT (frontend)', 'npm', ['test'], frontend);

// 3. Integration — backend route tests (same jest pattern; no separate folder yet)
run('INTEGRATION (backend contract)', 'npx', [
  'jest',
  'src/tests/unit/health.routes.test.ts',
  'src/tests/unit/conversionSettings.service.test.ts',
  'src/tests/unit/leadTransition.service.test.ts',
  'src/tests/unit/onboarding.routes.hardening.test.ts',
  '--detectOpenHandles',
  '--forceExit',
], backend);

// 4. Production build
run('PRODUCTION (backend build)', 'npm', ['run', 'build'], backend);
run('PRODUCTION (frontend build)', 'npm', ['run', 'build'], frontend);

// 5. Smoke — health + critical unit smoke
run('SMOKE (health + auth)', 'npx', [
  'jest',
  'src/tests/unit/health.routes.test.ts',
  'src/tests/unit/auth.service.test.ts',
  'src/tests/unit/visitBooking.service.test.ts',
  '--detectOpenHandles',
  '--forceExit',
], backend);

// 6. Performance / load — lightweight health hammer (no server required: uses jest health route)
run('LOAD/PERFORMANCE (health route stress)', 'node', [
  path.join(root, 'scripts', 'load-health-smoke.mjs'),
], root);

// 7. Regression + usability — Playwright (skipped if E2E_SKIP=1)
if (process.env.E2E_SKIP === '1') {
  console.log('\n[SKIP] E2E regression/usability (E2E_SKIP=1)');
} else {
  run('REGRESSION + USABILITY (Playwright e2e)', 'npm', [
    'run',
    'test:e2e',
    '--',
    'e2e/core-routes-regression.spec.ts',
    'e2e/auth-regression.spec.ts',
    'e2e/password-reset-smoke.spec.ts',
  ], frontend, { E2E_PORT: process.env.E2E_PORT || '4173' });
}

console.log('\n========================================');
console.log('FULL TEST MATRIX: ALL STAGES PASSED');
console.log('========================================\n');
