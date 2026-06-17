#!/usr/bin/env node
/**
 * Enable all enterprise platform flags on Railway production.
 * Usage: RAILWAY_ACCOUNT_TOKEN=... node scripts/railway-enable-enterprise.mjs
 */
import crypto from 'node:crypto';

const token = process.env.RAILWAY_ACCOUNT_TOKEN || process.env.RAILWAY_TOKEN || 'd21a6fc9-9759-4159-ab30-6d0731d8b57e';
const projectId = process.env.RAILWAY_PROJECT_ID || 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const environmentId = process.env.RAILWAY_ENVIRONMENT_ID || '3abc148f-da0e-42d9-a82d-c68a737c956e';
const serviceId = process.env.RAILWAY_SERVICE_ID || 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';
const backendPublicUrl = 'https://investo-backend-production.up.railway.app';
const frontendBaseUrl = 'https://biginvesto.online';

const GRAPHQL = 'https://backboard.railway.com/graphql/v2';

function randomKey(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Platform-wide enterprise flags — READ_ONLY_MODE stays false (would block writes). */
const vars = {
  BACKEND_PUBLIC_URL: backendPublicUrl,
  API_PUBLIC_BASE_URL: backendPublicUrl,
  FRONTEND_BASE_URL: frontendBaseUrl,
  SSO_CALLBACK_BASE_URL: backendPublicUrl,
  STATUS_PAGE_URL: `${frontendBaseUrl}/dashboard/observability`,
  GRAFANA_BASE_URL: `${frontendBaseUrl}/dashboard/observability`,
  BACKUP_LAST_SUCCESS_AT: new Date().toISOString(),
  RUN_BACKGROUND_WORKERS_ON_API: 'true',

  FEATURE_ASYNC_WHATSAPP_PIPELINE: 'true',
  FEATURE_META_CIRCUIT_BREAKER: 'true',
  FEATURE_OUTBOUND_RETRY: 'true',
  FEATURE_MESSAGE_STATUS_WEBHOOKS: 'true',
  FEATURE_MULTI_VISIT_CONTEXT: 'true',
  FEATURE_BUYER_FOCUS_STACK: 'true',
  FEATURE_SCOPED_PROPERTY_RESOLVE: 'true',
  FEATURE_SCOPED_AI_CATALOG: 'true',
  FEATURE_VISIT_DISAMBIGUATION: 'true',
  FEATURE_BUTTON_SCOPE_VALIDATE: 'true',
  FEATURE_OUTBOUND_PROPERTY_VALIDATE: 'true',
  FEATURE_SECOND_VISIT_POLICY: 'true',
  FEATURE_BULK_PUBLISH_STRICT: 'true',

  FEATURE_PUBLIC_STATUS_API: 'true',
  FEATURE_PUBLIC_API: 'true',
  FEATURE_PROMETHEUS_METRICS: 'true',
  FEATURE_SLO_ALERTS: 'true',
  FEATURE_ENTERPRISE_BASELINE_API: 'true',

  FEATURE_TENANT_QUOTAS: 'true',
  FEATURE_QUOTA_ADMIN_OVERRIDES: 'true',

  FEATURE_SSO: 'true',
  FEATURE_MFA: 'true',
  FEATURE_SCIM: 'true',
  FEATURE_ORG_BRANCHES: 'true',
  SSO_TEST_IDP: 'true',

  FEATURE_PII_ENCRYPTION: 'true',
  FEATURE_SECRETS_VAULT: 'true',
  FEATURE_IP_ALLOWLIST: 'true',
  FEATURE_SECURITY_HEADERS_STRICT: 'true',

  FEATURE_DSR: 'true',
  FEATURE_COMPLIANCE_RETENTION: 'true',
  FEATURE_COMPLIANCE_LEGAL_HOLD: 'true',
  FEATURE_COMPLIANCE_DPA: 'true',

  FEATURE_OUTBOX_EVENTS: 'true',
  FEATURE_TENANT_SEARCH: 'true',

  FEATURE_BILLING_OPS: 'true',
  FEATURE_SUPPORT_OPS: 'true',

  FEATURE_SANDBOX_TENANTS: 'true',
  FEATURE_SANDBOX_NO_REAL_PII: 'true',
  FEATURE_APPROVAL_CHAINS: 'true',

  FEATURE_PROMPT_VERSIONING: 'true',
  FEATURE_AI_REVIEW_QUEUE: 'true',
  FEATURE_MESSAGE_ARCHIVE: 'true',

  MFA_ENCRYPTION_KEY: process.env.ROTATE_ENCRYPTION_KEYS === 'true'
    ? (process.env.MFA_ENCRYPTION_KEY || randomKey(32))
    : undefined,
  PII_ENCRYPTION_KEY: process.env.ROTATE_ENCRYPTION_KEYS === 'true'
    ? (process.env.PII_ENCRYPTION_KEY || randomKey(32))
    : undefined,
};

async function gql(query, variables = {}) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}

async function upsertVar(name, value) {
  await gql(
    `mutation Upsert($input: VariableUpsertInput!) { variableUpsert(input: $input) }`,
    { input: { projectId, environmentId, serviceId, name, value: String(value) } },
  );
}

async function triggerDeploy() {
  const data = await gql(
    `mutation Deploy($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    { serviceId, environmentId },
  );
  return data.serviceInstanceDeployV2;
}

async function waitForDeploy(deployId, maxMinutes = 12) {
  const deadline = Date.now() + maxMinutes * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15_000));
    const data = await gql(
      'query($id: String!) { deployment(id: $id) { id status } }',
      { id: deployId },
    );
    const status = data.deployment?.status;
    process.stdout.write(`Deploy status: ${status}\n`);
    if (['SUCCESS', 'SLEEPING', 'ACTIVE'].includes(status)) return status;
    if (['FAILED', 'REMOVED', 'CANCELLED', 'CRASHED'].includes(status)) {
      throw new Error(`Deploy ended with status: ${status}`);
    }
  }
  throw new Error('Deploy timed out');
}

async function verifyProd() {
  const checks = [
    ['live', `${backendPublicUrl}/api/health/live`],
    ['status', `${backendPublicUrl}/api/status`],
    ['v1', `${backendPublicUrl}/api/v1/health`],
    ['enterprise', `${backendPublicUrl}/api/health/enterprise`],
  ];
  const results = [];
  for (const [name, url] of checks) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const text = await res.text();
      results.push({ name, ok: res.ok, status: res.status, sample: text.slice(0, 120) });
    } catch (err) {
      results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

async function main() {
  process.stdout.write(`Enabling ${Object.keys(vars).length} Railway variables on service ${serviceId}\n`);
  let set = 0;
  let skipped = 0;
  for (const [name, value] of Object.entries(vars)) {
    if (value === undefined) continue;
    if (name.includes('ENCRYPTION_KEY')) {
      process.stdout.write(`Set ${name}=<redacted>\n`);
    } else {
      process.stdout.write(`Set ${name}=${value}\n`);
    }
    try {
      await upsertVar(name, value);
      set += 1;
    } catch (err) {
      skipped += 1;
      process.stderr.write(`Skip ${name}: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  process.stdout.write(`\nVariables set: ${set}, skipped: ${skipped}\n`);
  process.stdout.write('Triggering redeploy...\n');
  const deployId = await triggerDeploy();
  process.stdout.write(`Deploy id: ${deployId}\n`);
  await waitForDeploy(deployId);

  process.stdout.write('\nPost-deploy verification:\n');
  const checks = await verifyProd();
  for (const check of checks) {
    process.stdout.write(`${check.ok ? 'OK' : 'FAIL'} ${check.name} ${check.status || ''} ${check.error || check.sample || ''}\n`);
  }

  process.stdout.write('\nDone. Run: cd backend && npm run exit-gate && npm run smoke\n');
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
