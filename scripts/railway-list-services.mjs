#!/usr/bin/env node
const token = process.env.RAILWAY_ACCOUNT_TOKEN || process.env.RAILWAY_TOKEN;
const projectId = process.env.RAILWAY_PROJECT_ID || 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
if (!token) {
  console.error('Set RAILWAY_ACCOUNT_TOKEN');
  process.exit(1);
}
const res = await fetch('https://backboard.railway.com/graphql/v2', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `query List($id: String!) {
      project(id: $id) {
        id name
        environments { edges { node { id name } } }
        services { edges { node { id name } } }
      }
    }`,
    variables: { id: projectId },
  }),
});
const body = await res.json();
console.log(JSON.stringify(body, null, 2));
