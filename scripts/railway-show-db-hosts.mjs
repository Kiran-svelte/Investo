#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../backend');
const require = createRequire(path.join(backendRoot, 'package.json'));

const token = process.env.RAILWAY_ACCOUNT_TOKEN || 'd21a6fc9-9759-4159-ab30-6d0731d8b57e';
const projectId = 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const environmentId = '3abc148f-da0e-42d9-a82d-c68a737c956e';
const serviceId = 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';

const res = await fetch('https://backboard.railway.com/graphql/v2', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `query($projectId:String!,$environmentId:String!,$serviceId:String!){ variables(projectId:$projectId, environmentId:$environmentId, serviceId:$serviceId) }`,
    variables: { projectId, environmentId, serviceId },
  }),
});
const body = await res.json();
const vars = body.data?.variables || {};
for (const key of ['DATABASE_URL', 'DIRECT_URL', 'DB_AUTO_MIGRATE', 'RUN_BACKGROUND_WORKERS_ON_API']) {
  const val = vars[key];
  if (!val) {
    process.stdout.write(`${key}: <unset>\n`);
    continue;
  }
  const host = val.match(/@([^/?]+)/)?.[1] || 'unknown';
  process.stdout.write(`${key}: host=${host}\n`);
}
