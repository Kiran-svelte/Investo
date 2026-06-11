#!/usr/bin/env node
/**
 * Trigger Railway redeploy via GraphQL (git-connected service).
 * Usage:
 *   node scripts/deploy-railway-graphql.mjs
 *   RAILWAY_PROJECT_ID=d21a6fc9-... node scripts/deploy-railway-graphql.mjs
 */

const token =
  process.env.RAILWAY_ACCOUNT_TOKEN
  || process.env.RAILWAY_TOKEN;

if (!token) {
  console.error('Set RAILWAY_ACCOUNT_TOKEN or RAILWAY_TOKEN');
  process.exit(1);
}

const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const GRAPHQL = 'https://backboard.railway.com/graphql/v2';

async function gql(query, variables = {}) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }
  return body.data;
}

function pickBackendService(services) {
  const list = services.map((edge) => edge.node);
  return (
    list.find((s) => /investo-backend|backend|api/i.test(s.name))
    ?? list[0]
  );
}

function pickProductionEnv(environments) {
  const list = environments.map((edge) => edge.node);
  return (
    list.find((e) => /^production$/i.test(e.name))
    ?? list[0]
  );
}

async function waitForDeploy(deployId, maxMinutes = 15) {
  const deadline = Date.now() + maxMinutes * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20_000));
    const data = await gql(
      'query($id: String!) { deployment(id: $id) { id status } }',
      { id: deployId },
    );
    const status = data.deployment?.status;
    console.log(`Deploy status: ${status}`);
    if (['SUCCESS', 'SLEEPING', 'ACTIVE'].includes(status)) return status;
    if (['FAILED', 'REMOVED', 'CANCELLED', 'CRASHED'].includes(status)) {
      throw new Error(`Deploy ended with status: ${status}`);
    }
  }
  throw new Error('Deploy timed out');
}

async function main() {
  console.log(`Project: ${PROJECT_ID}`);

  const project = await gql(
    `query($id: String!) {
      project(id: $id) {
        id
        name
        environments { edges { node { id name } } }
        services { edges { node { id name } } }
      }
    }`,
    { id: PROJECT_ID },
  );

  const { project: p } = project;
  if (!p) throw new Error(`Project not found: ${PROJECT_ID}`);

  console.log(`Resolved project: ${p.name} (${p.id})`);

  const service = pickBackendService(p.services.edges);
  const environment = pickProductionEnv(p.environments.edges);
  if (!service) throw new Error('No services in project');
  if (!environment) throw new Error('No environments in project');

  console.log(`Service: ${service.name} (${service.id})`);
  console.log(`Environment: ${environment.name} (${environment.id})`);

  const deployData = await gql(
    'mutation($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }',
    { serviceId: service.id, environmentId: environment.id },
  );

  const deployId = deployData.serviceInstanceDeployV2;
  console.log(`Deploy triggered: ${deployId}`);

  const finalStatus = await waitForDeploy(deployId);
  console.log(`Deploy complete: ${finalStatus}`);

  const healthUrl = 'https://investo-backend-production.up.railway.app/api/health/live';
  const healthRes = await fetch(healthUrl);
  const health = await healthRes.text();
  console.log(`Health: ${health}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
