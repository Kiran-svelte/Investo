#!/usr/bin/env node
/**
 * Set OPENAI_MODEL + AGENT_AI_MODEL on Railway production and redeploy.
 * Usage: node scripts/set-openai-model-mini.mjs
 */
const token = process.env.RAILWAY_ACCOUNT_TOKEN || process.env.RAILWAY_TOKEN;
if (!token) {
  console.error('Set RAILWAY_ACCOUNT_TOKEN or RAILWAY_TOKEN');
  process.exit(1);
}

const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const ENV_ID = process.env.RAILWAY_ENVIRONMENT_ID || '3abc148f-da0e-42d9-a82d-c68a737c956e';
const SERVICE_ID = process.env.RAILWAY_SERVICE_ID || 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';
const MODEL = process.env.OPENAI_MODEL_TARGET || 'gpt-4o-mini';
const API_BASE = process.env.PROD_API_BASE || 'https://investo-backend-production.up.railway.app';

async function gql(query, variables = {}) {
  const res = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }
  return body.data;
}

async function upsert(name, value) {
  await gql(
    'mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }',
    { input: { projectId: PROJECT_ID, environmentId: ENV_ID, serviceId: SERVICE_ID, name, value } },
  );
  console.log(`Set ${name}=${value}`);
}

async function waitDeploy(deployId, maxMinutes = 12) {
  const deadline = Date.now() + maxMinutes * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15_000));
    const data = await gql('query($id: String!) { deployment(id: $id) { status } }', { id: deployId });
    const status = data.deployment?.status;
    console.log(`Deploy status: ${status}`);
    if (['SUCCESS', 'SLEEPING', 'ACTIVE'].includes(status)) return status;
    if (['FAILED', 'REMOVED', 'CANCELLED', 'CRASHED'].includes(status)) {
      throw new Error(`Deploy failed: ${status}`);
    }
  }
  throw new Error('Deploy timed out');
}

async function main() {
  await upsert('OPENAI_MODEL', MODEL);
  await upsert('AGENT_AI_MODEL', MODEL);

  const deploy = await gql(
    'mutation($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }',
    { serviceId: SERVICE_ID, environmentId: ENV_ID },
  );
  const deployId = deploy.serviceInstanceDeployV2;
  console.log(`Redeploy started: ${deployId}`);
  await waitDeploy(deployId);

  const healthRes = await fetch(`${API_BASE}/api/health/internal`);
  const health = await healthRes.json();
  console.log(JSON.stringify({
    ok: health.agent_ai?.model === MODEL,
    agent_ai_model: health.agent_ai?.model,
    openai: health.dependencies?.openai?.status,
    build_version: health.build?.version,
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
