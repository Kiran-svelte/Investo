#!/usr/bin/env node
const token = process.env.RAILWAY_ACCOUNT_TOKEN || 'd21a6fc9-9759-4159-ab30-6d0731d8b57e';
const deployId = process.argv[2] || 'd7e1ea2e-0153-46a9-b7f1-db447083f5ac';

async function gql(query, variables = {}) {
  const res = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const deployment = await gql(
  `query($id: String!) {
    deployment(id: $id) {
      id
      status
      meta
    }
  }`,
  { id: deployId },
);
console.log('Deployment:', JSON.stringify(deployment, null, 2));

const logs = await gql(
  `query($deploymentId: String!) {
    deploymentLogs(deploymentId: $deploymentId, limit: 150) {
      __typename
      ... on Log {
        message
        timestamp
      }
    }
  }`,
  { deploymentId: deployId },
);
if (logs.errors) {
  console.error('Log errors:', JSON.stringify(logs.errors, null, 2));
} else {
  const lines = (logs.data?.deploymentLogs || [])
    .map((l) => l.message)
    .filter(Boolean);
  console.log('\n--- Last log lines ---\n');
  console.log(lines.slice(-50).join('\n'));
}
