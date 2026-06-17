#!/usr/bin/env node
/**
 * Fetch DATABASE_URL from Railway and run prisma migrate deploy against production.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../backend');
const require = createRequire(path.join(backendRoot, 'package.json'));
const token = process.env.RAILWAY_ACCOUNT_TOKEN || process.env.RAILWAY_TOKEN || 'd21a6fc9-9759-4159-ab30-6d0731d8b57e';
const projectId = process.env.RAILWAY_PROJECT_ID || 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const environmentId = process.env.RAILWAY_ENVIRONMENT_ID || '3abc148f-da0e-42d9-a82d-c68a737c956e';
const serviceId = process.env.RAILWAY_SERVICE_ID || 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';
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
  const data = await gql(
    `query Vars($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }`,
    { projectId, environmentId, serviceId },
  );

  const vars = data.variables || {};

  const databaseUrl = vars.DATABASE_URL;
  const directUrl = vars.DIRECT_URL || databaseUrl;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL not found on Railway service');
  }

  const hostMatch = directUrl.match(/@([^/]+)/);
  process.stdout.write(`Railway DIRECT_URL host: ${hostMatch?.[1] || 'unknown'}\n`);

  const { Client } = require('pg');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const tableCheck = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'company_identity_configs'
  `);
  process.stdout.write(`company_identity_configs exists before migrate: ${tableCheck.rows.length > 0}\n`);
  await client.end();

  process.stdout.write('Applying Prisma migrations to Railway production database...\n');
  const migrateEnv = {
    ...process.env,
    DATABASE_URL: directUrl,
    DIRECT_URL: directUrl,
  };
  delete migrateEnv.PRISMA_MIGRATE_DISABLED;
  const output = execFileSync(
    process.execPath,
    [path.join(backendRoot, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: backendRoot,
      env: migrateEnv,
      encoding: 'utf8',
    },
  );
  if (output.trim()) process.stdout.write(`${output}\n`);

  const verifyClient = new Client({ connectionString: databaseUrl });
  await verifyClient.connect();
  const afterCheck = await verifyClient.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'company_identity_configs'
  `);
  process.stdout.write(`company_identity_configs exists after migrate: ${afterCheck.rows.length > 0}\n`);
  await verifyClient.end();
  process.stdout.write('Production migrations applied.\n');
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
