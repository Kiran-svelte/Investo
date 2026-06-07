#!/usr/bin/env node
import crypto from 'crypto';

const token = process.env.RAILWAY_ACCOUNT_TOKEN || process.env.RAILWAY_TOKEN || '2a351ccb-820e-485d-94a5-69f79b75ea7c';
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const SERVICE_ID = process.env.RAILWAY_SERVICE_ID || 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';
const ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || '3abc148f-da0e-42d9-a82d-c68a737c956e';

async function gql(query, variables = {}) {
  const res = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}

async function upsert(name, value) {
  await gql('mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }', {
    input: { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, serviceId: SERVICE_ID, name, value: String(value) },
  });
  console.log(`Updated ${name}`);
}

await upsert('RUN_BACKGROUND_WORKERS_ON_API', 'true');
await upsert('SKIP_IP_WHITELIST', 'false');
await upsert('BYPASS_WHATSAPP_SIGNATURE', 'false');

const vars = await gql(
  'query($projectId:String!,$environmentId:String!,$serviceId:String!){ variables(projectId:$projectId, environmentId:$environmentId, serviceId:$serviceId) }',
  { projectId: PROJECT_ID, environmentId: ENVIRONMENT_ID, serviceId: SERVICE_ID },
);
if (!vars.variables?.METRICS_BEARER_TOKEN) {
  await upsert('METRICS_BEARER_TOKEN', crypto.randomBytes(32).toString('hex'));
  console.log('METRICS_BEARER_TOKEN created');
} else {
  console.log('METRICS_BEARER_TOKEN already set');
}

if (!vars.variables?.SENTRY_DSN) {
  console.log('SENTRY_DSN not set — add in Railway dashboard for error tracking');
}

await gql('mutation($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }', {
  serviceId: SERVICE_ID,
  environmentId: ENVIRONMENT_ID,
});
console.log('Env hardened; redeploy triggered');
