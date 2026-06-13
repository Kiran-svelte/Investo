#!/usr/bin/env node
/**
 * Remove legacy Meta WHATSAPP_* Railway env vars after tenant DB credentials are authoritative.
 */
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const SERVICE_ID = process.env.RAILWAY_SERVICE_ID || 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';
const ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || '3abc148f-da0e-42d9-a82d-c68a737c956e';

const LEGACY_VARS = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_APP_SECRET',
];

function resolveAuth() {
  const token = process.env.RAILWAY_ACCOUNT_TOKEN?.trim()
    || process.env.RAILWAY_TOKEN?.trim();
  if (!token) throw new Error('Set RAILWAY_ACCOUNT_TOKEN');
  return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
}

async function gql(auth, query, variables = {}) {
  const res = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}

async function removeVar(auth, name) {
  try {
    await gql(auth, 'mutation($input: VariableDeleteInput!) { variableDelete(input: $input) }', {
      input: {
        projectId: PROJECT_ID,
        environmentId: ENVIRONMENT_ID,
        serviceId: SERVICE_ID,
        name,
      },
    });
    console.log(`Removed ${name}`);
  } catch (err) {
    console.log(`Skip ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  const auth = resolveAuth();
  for (const name of LEGACY_VARS) {
    await removeVar(auth, name);
  }

  await gql(auth, 'mutation($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }', {
    serviceId: SERVICE_ID,
    environmentId: ENVIRONMENT_ID,
  });
  console.log('Legacy Meta/mail Railway vars removed; redeploy triggered.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
