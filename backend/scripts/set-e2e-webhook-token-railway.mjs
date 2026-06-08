/**
 * Set E2E_WEBHOOK_PROOF_TOKEN on Railway for production handset proof scripts.
 */
const ACCOUNT_TOKEN = process.env.RAILWAY_ACCOUNT_TOKEN || '2a351ccb-820e-485d-94a5-69f79b75ea7c';
const PROJECT_ID = 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const ENV_ID = '3abc148f-da0e-42d9-a82d-c68a737c956e';
const SERVICE_ID = 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';
const TOKEN = process.env.E2E_WEBHOOK_PROOF_TOKEN || 'investo-handset-e2e-v1';

async function gql(token, query, variables = {}) {
  const res = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

const base = { projectId: PROJECT_ID, environmentId: ENV_ID, serviceId: SERVICE_ID };
await gql(ACCOUNT_TOKEN, 'mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }', {
  input: { ...base, name: 'E2E_WEBHOOK_PROOF_TOKEN', value: TOKEN },
});
console.log('Upserted E2E_WEBHOOK_PROOF_TOKEN on Railway');

await gql(
  ACCOUNT_TOKEN,
  'mutation($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }',
  { serviceId: SERVICE_ID, environmentId: ENV_ID },
);
console.log('Redeploy triggered for E2E webhook token');
