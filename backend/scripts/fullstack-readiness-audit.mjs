#!/usr/bin/env node
/**
 * Full-stack enterprise readiness audit.
 *
 * This is intentionally broader than the production proof runner. It classifies
 * what to keep, remove, upgrade, and block across product, UI, backend,
 * workflows, security, operations, billing, and market/FDE readiness.
 *
 * Usage:
 *   node scripts/fullstack-readiness-audit.mjs
 *   node scripts/fullstack-readiness-audit.mjs --write
 *   node scripts/fullstack-readiness-audit.mjs --write --no-strict
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');
const args = new Set(process.argv.slice(2));
const writeReport = args.has('--write');
const strict = !args.has('--no-strict') && process.env.ALLOW_READINESS_BLOCKERS !== 'true';

const outputJsonPath = path.join(repoRoot, 'docs/enterprise/FULLSTACK_READINESS_AUDIT.json');
const outputMarkdownPath = path.join(repoRoot, 'docs/enterprise/FULLSTACK_READINESS_AUDIT.md');
const exitGatePath = path.join(repoRoot, 'docs/enterprise/EXIT_GATE_REPORT.json');
const chunkStatusPath = path.join(repoRoot, 'docs/enterprise/CHUNK_STATUS.json');

function git(args, options = {}) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    }).trim();
  } catch (err) {
    return '';
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function countFiles(relativeDir, predicate = () => true) {
  const root = path.join(repoRoot, relativeDir);
  if (!fs.existsSync(root)) return 0;
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (predicate(fullPath)) {
        count += 1;
      }
    }
  }
  return count;
}

function asLines(text) {
  return text ? text.split(/\r?\n/).filter(Boolean) : [];
}

function statusRows() {
  return asLines(git(['status', '--porcelain=v1']));
}

function trackedFiles() {
  return asLines(git(['ls-files']));
}

function trackedGeneratedArtifacts(files) {
  return files.filter((file) => (
    file === 'backend/.env'
    || (/(^|\/)\.env($|\.)/.test(file) && !file.endsWith('.env.example'))
    || file.includes('/node_modules/')
    || file.includes('/dist/')
    || file.endsWith('.tsbuildinfo')
    || file.includes('/test-results/')
    || file.includes('/.vite/')
  ));
}

function dirtyGeneratedArtifacts(rows) {
  return rows
    .map((row) => row.slice(3))
    .filter((file) => (
      file === 'backend/.env'
      || (/(^|\/)\.env($|\.)/.test(file) && !file.endsWith('.env.example'))
      || file.includes('/node_modules/')
      || file.includes('/dist/')
      || file.endsWith('.tsbuildinfo')
      || file.includes('/test-results/')
      || file.includes('/.vite/')
    ));
}

function tokenizedRemotes() {
  const remotes = asLines(git(['remote', '-v']));
  return remotes.filter((line) => /github_pat_|ghp_|vcp_|railway|token=|x-access-token|@github\.com/i.test(line));
}

function scanTrackedSecretPatterns(files) {
  const patterns = [
    /github_pat_[A-Za-z0-9_]+/g,
    /ghp_[A-Za-z0-9_]+/g,
    /vcp_[A-Za-z0-9_]+/g,
    /sk-[A-Za-z0-9]{20,}/g,
    /-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/g,
  ];
  const include = files.filter((file) => (
    !file.includes('/node_modules/')
    && !file.includes('/dist/')
    && !file.endsWith('.png')
    && !file.endsWith('.jpg')
    && !file.endsWith('.jpeg')
    && !file.endsWith('.xlsx')
    && !file.endsWith('.pdf')
    && !file.endsWith('.map')
  ));
  const findings = [];
  for (const file of include) {
    const fullPath = path.join(repoRoot, file);
    let text = '';
    try {
      text = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        findings.push(file);
        break;
      }
    }
  }
  return findings;
}

function evidenceFresh(isoString, maxAgeDays) {
  if (!isoString) return false;
  const time = Date.parse(isoString);
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= maxAgeDays * 24 * 60 * 60 * 1000;
}

function pushFinding(findings, severity, id, message, action, data = {}) {
  findings.push({ severity, id, message, action, ...data });
}

function domain(id, name, stance, checks, keep = [], remove = [], upgrade = []) {
  const blockers = checks.filter((check) => check.severity === 'blocker');
  const warnings = checks.filter((check) => check.severity === 'warning');
  const passedChecks = checks.filter((check) => check.passed === true).length;
  const score = checks.length === 0 ? 0 : Math.round((passedChecks / checks.length) * 100);
  return {
    id,
    name,
    stance,
    score,
    status: blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'needs_upgrade' : 'keep',
    keep,
    remove,
    upgrade,
    checks,
    blockers: blockers.map((check) => check.message),
    warnings: warnings.map((check) => check.message),
  };
}

function check(passed, severity, id, message, action = '') {
  return {
    id,
    passed: Boolean(passed),
    severity: passed ? 'pass' : severity,
    message,
    action,
  };
}

function markdown(report) {
  const lines = [];
  lines.push('# Full-Stack Enterprise Readiness Audit');
  lines.push('');
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Ready: ${report.ready ? 'true' : 'false'}`);
  lines.push(`Strict blockers: ${report.blockers.length}`);
  lines.push('');
  lines.push('## Current Verdict');
  lines.push('');
  lines.push(report.summary);
  lines.push('');
  lines.push('## Domains');
  lines.push('');
  for (const item of report.domains) {
    lines.push(`### ${item.name}`);
    lines.push('');
    lines.push(`- Status: ${item.status}`);
    lines.push(`- Stance: ${item.stance}`);
    lines.push(`- Score: ${item.score}`);
    if (item.keep.length) lines.push(`- Keep: ${item.keep.join('; ')}`);
    if (item.remove.length) lines.push(`- Remove: ${item.remove.join('; ')}`);
    if (item.upgrade.length) lines.push(`- Upgrade: ${item.upgrade.join('; ')}`);
    if (item.blockers.length) {
      lines.push('- Blockers:');
      for (const blocker of item.blockers) lines.push(`  - ${blocker}`);
    }
    if (item.warnings.length) {
      lines.push('- Warnings:');
      for (const warning of item.warnings) lines.push(`  - ${warning}`);
    }
    lines.push('');
  }
  lines.push('## Required Next Moves');
  lines.push('');
  for (const action of report.next_moves) {
    lines.push(`- [${action.severity}] ${action.action}`);
  }
  lines.push('');
  lines.push('## Proof Inputs');
  lines.push('');
  lines.push(`- Exit gate report: ${report.inputs.exit_gate_report}`);
  lines.push(`- Chunk status: ${report.inputs.chunk_status}`);
  lines.push(`- Backend unit tests discovered: ${report.inputs.backend_test_count}`);
  lines.push(`- Frontend E2E specs discovered: ${report.inputs.frontend_e2e_count}`);
  lines.push(`- Tracked generated/vendor/env artifacts: ${report.inputs.tracked_generated_artifact_count}`);
  lines.push(`- Dirty generated/vendor/env artifacts: ${report.inputs.dirty_generated_artifact_count}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

const tracked = trackedFiles();
const dirty = statusRows();
const exitGate = readJson(exitGatePath);
const chunkStatus = readJson(chunkStatusPath);
const trackedArtifacts = trackedGeneratedArtifacts(tracked);
const dirtyArtifacts = dirtyGeneratedArtifacts(dirty);
const secretFindings = scanTrackedSecretPatterns(tracked);
const remoteFindings = tokenizedRemotes();
const frontendE2eCount = countFiles('frontend/e2e', (file) => /\.spec\.ts$/.test(file));
const backendTestCount = countFiles('backend/src/tests', (file) => /\.test\.ts$/.test(file));
const proofScriptPresent = fileExists('backend/scripts/enterprise-production-proof.mjs');
const smokeScriptPresent = fileExists('backend/scripts/smoke-critical-paths.mjs');
const frontendBuildPresent = fileExists('frontend/package.json');
const backendBuildPresent = fileExists('backend/package.json');
const runbooksPresent = [
  'docs/enterprise/DR_RUNBOOK.md',
  'docs/enterprise/INCIDENT_RUNBOOK.md',
  'docs/enterprise/ON_CALL.md',
].every(fileExists);

const exitFailedGates = Array.isArray(exitGate?.failed_gates) ? exitGate.failed_gates : [];
const exitReportFresh = evidenceFresh(exitGate?.generated_at, 7);
const chunkUpdatedAt = Date.parse(chunkStatus?.updated_at || '');
const exitGeneratedAt = Date.parse(exitGate?.generated_at || '');
const staleChunkStatus = Number.isFinite(chunkUpdatedAt)
  && Number.isFinite(exitGeneratedAt)
  && chunkUpdatedAt < exitGeneratedAt;
const inProgressChunks = Array.isArray(chunkStatus?.chunks)
  ? chunkStatus.chunks.filter((chunk) => !['complete', 'verified'].includes(chunk.status)).map((chunk) => ({
    id: chunk.id,
    status: chunk.status,
    title: chunk.title,
  }))
  : [];

const docsForMarket = [
  'docs/NECESSARY.md',
  'docs/PRD.yaml',
  'docs/ROLE_USER_JOURNEYS.md',
  'main_docs/01_PRD.md',
].filter(fileExists);

const domains = [
  domain(
    'market_fde_operating_model',
    'Market and FDE operating model',
    'upgrade',
    [
      check(docsForMarket.length >= 3, 'warning', 'market_docs', 'Market/role docs exist.', 'Keep the ICP, journey, and buyer proof docs current.'),
      check(fileExists('backend/scripts/enterprise-production-proof.mjs'), 'blocker', 'production_proof_runner', 'Production proof runner exists.', 'Maintain it as the source for live proof.'),
      check(exitGate?.ready === true, 'blocker', 'market_ready_truth', 'Readiness report is not ready=true.', 'Do not sell as enterprise-ready until all gates pass live.'),
    ],
    ['Real buyer/agency workflows and role journeys as the product spine.'],
    ['Vague readiness claims and docs-only readiness.'],
    ['Add per-ICP market proof: paid pilot, onboarding time, first-value time, retained usage, and support burden.'],
  ),
  domain(
    'frontend_ux_workflows',
    'Frontend UX, role paths, and workflow coverage',
    'upgrade',
    [
      check(frontendBuildPresent, 'blocker', 'frontend_package', 'Frontend package exists.', 'Keep buildable Vite app.'),
      check(frontendE2eCount >= 5, 'warning', 'frontend_e2e_depth', `Frontend E2E specs discovered: ${frontendE2eCount}.`, 'Add role-by-role and mobile visual proofs for admin/staff/viewer flows.'),
      check(fileExists('frontend/e2e/invite-user-journey.spec.ts'), 'blocker', 'invite_e2e', 'Invite user journey E2E exists.', 'Keep invite onboarding under E2E.'),
    ],
    ['Role-specific flows and invite journey E2E coverage.'],
    ['Decorative or marketing-first screens that hide the actual CRM workflow.'],
    ['Add Playwright suites for platform admin no-tenant state, tenant-selected state, company admin, sales agent, operations, viewer, mobile.'],
  ),
  domain(
    'backend_domain_integrity',
    'Backend domain integrity and tenant isolation',
    'keep',
    [
      check(backendBuildPresent, 'blocker', 'backend_package', 'Backend package exists.', 'Keep backend build and smoke gates.'),
      check(backendTestCount >= 200, 'warning', 'backend_test_depth', `Backend tests discovered: ${backendTestCount}.`, 'Keep expanding contract and isolation tests.'),
      check(exitFailedGates.includes('tenant_isolation') === false, 'blocker', 'tenant_isolation_gate', 'Tenant isolation gate is passing in current report.', 'Block release on any tenant isolation regression.'),
      check(exitFailedGates.includes('role_matrix') === false, 'blocker', 'role_matrix_gate', 'Role matrix gate is passing in current report.', 'Block release on role matrix regression.'),
    ],
    ['Company-scoped APIs, explicit super-admin target context, and production role proof.'],
    ['Implicit tenant scoping and generic 500s in business workflows.'],
    ['Expand matrix from users into leads, analytics, conversations, visits, billing, notifications, and property imports.'],
  ),
  domain(
    'ai_whatsapp_workflows',
    'AI, WhatsApp, and workflow reliability',
    'upgrade',
    [
      check(fileExists('backend/scripts/physical-handset-scenarios.mjs'), 'warning', 'handset_scenarios', 'Physical handset scenario script exists.', 'Run with real device evidence before pilot claims.'),
      check(fileExists('backend/scripts/e2e-handset-proof.mjs'), 'warning', 'e2e_handset_proof', 'E2E handset proof script exists.', 'Keep buyer/staff WhatsApp proof separate from synthetic tests.'),
      check(smokeScriptPresent, 'blocker', 'smoke_script', 'Critical path smoke script exists.', 'Run it before every release.'),
    ],
    ['Single-reply contract, takeover-safe behavior, and smoke-tested buyer scenarios.'],
    ['Manual-only WhatsApp confidence and hidden delivery failures.'],
    ['Add queue/worker proofs, idempotency dashboards, and per-tenant WhatsApp credential isolation evidence.'],
  ),
  domain(
    'mail_onboarding_delivery',
    'Mail, onboarding, and invite delivery',
    'block',
    [
      check(exitFailedGates.includes('mail_delivery') === false, 'blocker', 'strict_mail_delivery', 'Strict mail delivery gate is not passing.', 'Configure Resend webhook secret or read-capable audit key, then rerun proof.'),
      check(proofScriptPresent, 'blocker', 'invite_proof', 'Invite production proof runner exists.', 'Keep invite create/accept/resend in production proof.'),
      check(fileExists('backend/src/routes/resendWebhook.routes.ts'), 'blocker', 'resend_webhook_route', 'Resend webhook route exists.', 'Register the production webhook and validate Svix signatures live.'),
    ],
    ['Accepted-send tracking, webhook ingestion, resend/retry UI.'],
    ['UI copy that says email sent when provider did not accept the message.'],
    ['Finish delivery-event proof: delivered, bounced, delayed, suppressed, failed, resend retry.'],
  ),
  domain(
    'identity_security_compliance',
    'Identity, security, and compliance',
    'keep',
    [
      check(exitFailedGates.includes('enterprise_identity') === false, 'blocker', 'identity_gate', 'Enterprise identity gate is passing in current report.', 'Keep SSO/MFA/SCIM proof live.'),
      check(fileExists('backend/src/identity/sso/sso.routes.ts'), 'blocker', 'sso_routes', 'SSO routes exist.', 'Do not remove SSO routes while FEATURE_SSO=true.'),
      check(fileExists('backend/src/identity/mfa/mfa.routes.ts'), 'blocker', 'mfa_routes', 'MFA routes exist.', 'Keep MFA route order behind JSON parser.'),
      check(fileExists('backend/src/identity/scim/scim.routes.ts'), 'blocker', 'scim_routes', 'SCIM routes exist.', 'Keep SCIM externalId lookup safe.'),
      check(runbooksPresent, 'warning', 'runbooks', 'Incident, DR, and on-call runbooks exist.', 'Update with latest Railway/Vercel/Keycloak/Resend operating steps.'),
    ],
    ['Keycloak SSO, MFA, SCIM, DR, incident, and on-call runbooks.'],
    ['Production test SSO callback paths and any tokenized secrets in code/remotes.'],
    ['Add security regression tests for IP allowlist, DSR, audit logs, token rotation, and incident drills.'],
  ),
  domain(
    'billing_commercial_ops',
    'Billing and commercial operations',
    'upgrade',
    [
      check(exitFailedGates.includes('billing') === false, 'warning', 'billing_gate', 'No explicit billing failed gate in current report.', 'Add billing proof instead of relying on absence of failure.'),
      check(fileExists('backend/src/routes/billing-admin.routes.ts'), 'warning', 'billing_admin_routes', 'Billing admin routes exist.', 'Prove billing status, past due, suspend/reactivate, and invoice flows.'),
      check(fileExists('frontend/src/pages/admin/AgencyInvitesPage.tsx') || fileExists('frontend/src/pages/admin'), 'warning', 'admin_billing_ui', 'Admin UI area exists.', 'Add billing UI E2E coverage and empty/error states.'),
    ],
    ['Agency invite billing model and platform admin billing surface.'],
    ['Manual spreadsheet billing as the operating system.'],
    ['Add live proof for subscription state transitions, invoices, payment failures, and tenant suspension UX.'],
  ),
  domain(
    'observability_operations',
    'Observability, operations, and reliability',
    'upgrade',
    [
      check(smokeScriptPresent, 'blocker', 'smoke_gate', 'Smoke gate exists.', 'Keep smoke as a release gate.'),
      check(fileExists('backend/scripts/synthetic-monitor.mjs'), 'warning', 'synthetic_monitor', 'Synthetic monitor script exists.', 'Run on schedule and alert on failure.'),
      check(fileExists('docs/enterprise/ON_CALL.md'), 'warning', 'on_call_doc', 'On-call doc exists.', 'Back it with live schedule and escalation proof.'),
      check(exitReportFresh, 'blocker', 'fresh_evidence', 'Exit gate report is fresh within 7 days.', 'Regenerate evidence after every runtime or env change.'),
    ],
    ['Smoke, synthetic monitor, health endpoints, and on-call docs.'],
    ['Readiness reports that drift from live deployments.'],
    ['Add Grafana/status-page/on-call proof, RTO/RPO drills, and SLO alert evidence.'],
  ),
  domain(
    'repo_deploy_hygiene',
    'Repository and deploy hygiene',
    'block',
    [
      check(trackedArtifacts.length === 0, 'blocker', 'tracked_artifacts', `Tracked generated/vendor/env artifacts: ${trackedArtifacts.length}.`, 'Run npm run repo:untrack-generated -- --apply in a git-writable environment, then commit the removals.'),
      check(dirtyArtifacts.length === 0, 'blocker', 'dirty_artifacts', `Dirty generated/vendor/env artifacts: ${dirtyArtifacts.length}.`, 'Do not commit generated artifacts; run npm run repo:untrack-generated -- --apply and keep local artifacts ignored.'),
      check(remoteFindings.length === 0, 'blocker', 'tokenized_remotes', `Tokenized/suspicious remotes: ${remoteFindings.length}.`, 'Use clean remotes only.'),
      check(secretFindings.length === 0, 'blocker', 'tracked_secret_patterns', `Tracked files with secret-like patterns: ${secretFindings.length}.`, 'Rotate leaked credentials and purge tracked secrets.'),
      check(staleChunkStatus === false, 'warning', 'stale_chunk_status', 'CHUNK_STATUS is not older than EXIT_GATE_REPORT.', 'Regenerate or deprecate stale chunk readiness artifacts.'),
    ],
    ['Source, migrations, tests, docs, and environment examples.'],
    ['Tracked .env, build outputs, node_modules, caches, tokenized remotes, and stale readiness artifacts.'],
    ['Add CI job for this audit, dependency install from lockfiles, and clean deploy source checks.'],
  ),
];

const blockers = domains.flatMap((item) => item.checks.filter((row) => row.severity === 'blocker'));
const warnings = domains.flatMap((item) => item.checks.filter((row) => row.severity === 'warning'));
const nextMoves = [...blockers, ...warnings]
  .filter((row) => row.passed === false && row.action)
  .map((row) => ({ severity: row.severity, id: row.id, action: row.action }));

const report = {
  ready: blockers.filter((row) => row.passed === false).length === 0,
  generated_at: new Date().toISOString(),
  summary: 'Big Investo is only enterprise-ready when live proof, repo hygiene, product UX, tenant isolation, mail delivery, identity, billing, workflows, and operations pass together. This audit intentionally blocks readiness on any open P0/P1 full-stack gap.',
  inputs: {
    exit_gate_report: path.relative(repoRoot, exitGatePath).replace(/\\/g, '/'),
    chunk_status: path.relative(repoRoot, chunkStatusPath).replace(/\\/g, '/'),
    exit_gate_ready: exitGate?.ready === true,
    exit_gate_failed_gates: exitFailedGates,
    chunk_status_exit_ready: chunkStatus?.exit_gate?.ready === true,
    in_progress_chunks: inProgressChunks,
    backend_test_count: backendTestCount,
    frontend_e2e_count: frontendE2eCount,
    tracked_generated_artifact_count: trackedArtifacts.length,
    dirty_generated_artifact_count: dirtyArtifacts.length,
    tokenized_remote_count: remoteFindings.length,
    tracked_secret_pattern_count: secretFindings.length,
  },
  domains,
  blockers: blockers.filter((row) => row.passed === false),
  warnings: warnings.filter((row) => row.passed === false),
  next_moves: nextMoves,
  samples: {
    tracked_generated_artifacts: trackedArtifacts.slice(0, 25),
    dirty_generated_artifacts: dirtyArtifacts.slice(0, 25),
    tokenized_remotes: remoteFindings.map((line) => line.replace(/(github_pat_|ghp_|vcp_)[A-Za-z0-9_]+/g, '$1[redacted]')),
    tracked_secret_pattern_files: secretFindings.slice(0, 25),
  },
};

if (writeReport) {
  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outputMarkdownPath, markdown(report));
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (strict && !report.ready) {
  process.exit(1);
}
