#!/usr/bin/env node
/**
 * Enterprise exit gate — verifies criteria from main_docs/enterprise.md §7.
 *
 * Usage:
 *   npm run exit-gate
 *   RUN_K6=true npm run exit-gate
 *   EXIT_GATE_BASE_URL=https://investo-backend-production.up.railway.app npm run exit-gate
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const backendRoot = path.resolve(__dirname, '..');
const chunkStatusPath = path.join(repoRoot, 'docs/enterprise/CHUNK_STATUS.json');
const reportPath = path.join(repoRoot, 'docs/enterprise/EXIT_GATE_REPORT.json');
const k6ScriptPath = path.join(repoRoot, 'infra/k6/load-test.js');

const baseUrl = (process.env.EXIT_GATE_BASE_URL || process.env.SMOKE_BASE_URL || 'https://investo-backend-production.up.railway.app').replace(/\/+$/, '');
const runK6 = String(process.env.RUN_K6 || '').toLowerCase() === 'true';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function runJest(relativeTestPath) {
  const abs = path.join(backendRoot, relativeTestPath);
  if (!fs.existsSync(abs)) {
    return { passed: false, detail: `Missing test file: ${relativeTestPath}` };
  }

  const jestBin = path.join(backendRoot, 'node_modules', 'jest', 'bin', 'jest.js');
  const result = spawnSync(
    process.execPath,
    [jestBin, relativeTestPath, '--runInBand', '--no-cache', '--forceExit'],
    { cwd: backendRoot, encoding: 'utf8', env: process.env },
  );

  if (result.status === 0) {
    return { passed: true, detail: `${relativeTestPath} passed` };
  }

  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  return { passed: false, detail: output.slice(-800) || `${relativeTestPath} failed` };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, body };
}

function allChunksComplete(chunkStatus) {
  const chunks = chunkStatus?.chunks || [];
  if (chunks.length !== 15) return false;
  return chunks.every((chunk) => chunk.status === 'complete');
}

async function main() {
  const startedAt = new Date().toISOString();
  const chunkStatus = fs.existsSync(chunkStatusPath) ? readJson(chunkStatusPath) : null;
  const gates = [];

  // Load
  const k6Exists = fs.existsSync(k6ScriptPath);
  let loadPassed = k6Exists;
  let loadDetail = k6Exists ? 'k6 script present at infra/k6/load-test.js' : 'Missing infra/k6/load-test.js';

  if (runK6 && k6Exists) {
    const k6Bin = process.platform === 'win32' ? 'k6.exe' : 'k6';
    const k6Result = spawnSync(k6Bin, ['run', k6ScriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, BASE_URL: baseUrl },
    });
    loadPassed = k6Result.status === 0;
    loadDetail = loadPassed
      ? 'k6 load test passed thresholds'
      : `${(k6Result.stderr || k6Result.stdout || 'k6 run failed').slice(-500)}`;
  } else if (runK6) {
    loadPassed = false;
    loadDetail = 'RUN_K6=true but k6 script missing';
  }

  gates.push({ id: 'load', passed: loadPassed, detail: loadDetail });

  // Reliability — SLO snapshot in public health
  let reliabilityPassed = false;
  let reliabilityDetail = 'Health check unavailable';
  try {
    const health = await fetchJson(`${baseUrl}/api/health`);
    const slo = health.body?.slo;
    const uptimeTarget = 99.9;
    const sloOk = slo?.status === 'operational' || slo?.status === 'ok' || slo?.status === 'degraded';
    reliabilityPassed = health.ok && sloOk;
    reliabilityDetail = health.ok
      ? `Health SLO status=${slo?.status || 'unknown'} (target uptime ${uptimeTarget}%)`
      : `Health HTTP ${health.status}`;
  } catch (err) {
    reliabilityDetail = err instanceof Error ? err.message : String(err);
  }
  gates.push({ id: 'reliability', passed: reliabilityPassed, detail: reliabilityDetail });

  // Isolation
  const isolation = runJest('src/tests/integration/tenantIsolation.matrix.test.ts');
  gates.push({ id: 'isolation', passed: isolation.passed, detail: isolation.detail });

  // IAM
  const mfa = runJest('src/tests/unit/mfa.service.test.ts');
  const sso = runJest('src/tests/unit/sso.service.test.ts');
  const iamPassed = mfa.passed && sso.passed;
  gates.push({
    id: 'iam',
    passed: iamPassed,
    detail: iamPassed ? 'MFA + SSO unit tests passed' : [mfa.detail, sso.detail].join(' | '),
  });

  // Compliance
  const dsr = runJest('src/tests/unit/dsr.service.test.ts');
  gates.push({ id: 'compliance', passed: dsr.passed, detail: dsr.detail });

  // Observability — status API
  let observabilityPassed = false;
  let observabilityDetail = 'Status API check failed';
  try {
    const status = await fetchJson(`${baseUrl}/api/status`);
    observabilityPassed = status.ok && typeof status.body?.status === 'string';
    observabilityDetail = observabilityPassed
      ? `Status API UP (${status.body.status})`
      : status.status === 404
        ? 'Status API disabled (FEATURE_PUBLIC_STATUS_API=false) — enable for exit gate'
        : `Status HTTP ${status.status}`;
  } catch (err) {
    observabilityDetail = err instanceof Error ? err.message : String(err);
  }
  gates.push({ id: 'observability', passed: observabilityPassed, detail: observabilityDetail });

  // Integrations — public API health + api key unit test
  const apiKey = runJest('src/tests/unit/apiKey.service.test.ts');
  let integrationsPassed = apiKey.passed;
  let integrationsDetail = apiKey.detail;
  try {
    const publicHealth = await fetchJson(`${baseUrl}/api/v1/health`);
    if (publicHealth.ok && publicHealth.body?.version === 'v1') {
      integrationsDetail = `${apiKey.detail}; public API health v1 OK`;
    } else {
      integrationsPassed = false;
      integrationsDetail = `${apiKey.detail}; public API health HTTP ${publicHealth.status}`;
    }
  } catch (err) {
    integrationsPassed = false;
    integrationsDetail = `${apiKey.detail}; public API health error: ${err instanceof Error ? err.message : String(err)}`;
  }
  gates.push({ id: 'integrations', passed: integrationsPassed, detail: integrationsDetail });

  // AI governance
  const aiReview = runJest('src/tests/unit/aiReviewQueue.service.test.ts');
  gates.push({ id: 'ai_governance', passed: aiReview.passed, detail: aiReview.detail });

  // Support
  const impersonation = runJest('src/tests/unit/impersonation.service.test.ts');
  gates.push({ id: 'support', passed: impersonation.passed, detail: impersonation.detail });

  const chunksComplete = allChunksComplete(chunkStatus);
  const failed_gates = gates.filter((g) => !g.passed).map((g) => g.id);
  if (!chunksComplete) {
    failed_gates.push('chunks_incomplete');
  }

  const ready = failed_gates.length === 0;
  const report = {
    ready,
    generated_at: startedAt,
    finished_at: new Date().toISOString(),
    base_url: baseUrl,
    run_k6: runK6,
    chunks_complete: chunksComplete,
    gates,
    failed_gates: Array.from(new Set(failed_gates)),
    chunk_status_path: 'docs/enterprise/CHUNK_STATUS.json',
  };

  writeJson(reportPath, report);

  if (chunkStatus) {
    chunkStatus.exit_gate = {
      ready,
      last_run: report.finished_at,
      failed_gates: report.failed_gates.filter((id) => id !== 'chunks_incomplete'),
    };
    chunkStatus.updated_at = report.finished_at;
    writeJson(chunkStatusPath, chunkStatus);
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(ready ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
