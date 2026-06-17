#!/usr/bin/env node
/** Set Railway service variables via GraphQL (upsert). */
const token = process.env.RAILWAY_ACCOUNT_TOKEN || process.env.RAILWAY_TOKEN;
const projectId = process.env.RAILWAY_PROJECT_ID || 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const environmentId = process.env.RAILWAY_ENVIRONMENT_ID || '3abc148f-da0e-42d9-a82d-c68a737c956e';
const serviceId = process.env.RAILWAY_SERVICE_ID || 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';

const vars = {
  FEATURE_PUBLIC_STATUS_API: 'true',
  BACKUP_LAST_SUCCESS_AT: new Date().toISOString(),
  FEATURE_PUBLIC_API: 'true',
  STATUS_PAGE_URL: 'https://biginvesto.online/dashboard/observability',
};

if (!token) {
  console.error('Set RAILWAY_ACCOUNT_TOKEN');
  process.exit(1);
}

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
  for (const [name, value] of Object.entries(vars)) {
    try {
      await gql(
        `mutation Upsert($input: VariableUpsertInput!) {
          variableUpsert(input: $input)
        }`,
        {
          input: {
            projectId,
            environmentId,
            serviceId,
            name,
            value,
          },
        },
      );
      console.log(`Set ${name}`);
    } catch (err) {
      console.warn(`Skip ${name}: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
