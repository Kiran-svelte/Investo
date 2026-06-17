#!/usr/bin/env node
/** Set FEATURE_ASYNC_WHATSAPP_PIPELINE=false on Railway and redeploy. */
const token = process.env.RAILWAY_ACCOUNT_TOKEN || process.env.RAILWAY_TOKEN || 'd21a6fc9-9759-4159-ab30-6d0731d8b57e';
const projectId = 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const environmentId = '3abc148f-da0e-42d9-a82d-c68a737c956e';
const serviceId = 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';
const GRAPHQL = 'https://backboard.railway.com/graphql/v2';

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

async function main() {
  await gql(
    `mutation Upsert($input: VariableUpsertInput!) { variableUpsert(input: $input) }`,
    {
      input: {
        projectId,
        environmentId,
        serviceId,
        name: 'FEATURE_ASYNC_WHATSAPP_PIPELINE',
        value: 'false',
      },
    },
  );
  process.stdout.write('Set FEATURE_ASYNC_WHATSAPP_PIPELINE=false\n');

  const deployId = (
    await gql(
      `mutation Deploy($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
      }`,
      { serviceId, environmentId },
    )
  ).serviceInstanceDeployV2;
  process.stdout.write(`Deploy id: ${deployId}\n`);

  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 15_000));
    const status = (await gql('query($id: String!) { deployment(id: $id) { status } }', { id: deployId }))
      .deployment?.status;
    process.stdout.write(`status: ${status}\n`);
    if (['SUCCESS', 'SLEEPING', 'ACTIVE'].includes(status)) {
      process.stdout.write('Done. WhatsApp uses inline processing (async pipeline off).\n');
      return;
    }
    if (['FAILED', 'CRASHED', 'CANCELLED', 'REMOVED'].includes(status)) {
      throw new Error(`Deploy failed: ${status}`);
    }
  }
  throw new Error('Deploy timed out');
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
