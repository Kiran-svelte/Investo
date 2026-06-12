#!/usr/bin/env node
/**
 * Set Resend mail env on Railway Investo backend.
 *
 * Usage:
 *   $env:RAILWAY_ACCOUNT_TOKEN='...'
 *   $env:RESEND_API_KEY='re_...'
 *   $env:MAIL_FROM='Investo <onboarding@resend.dev>'
 *   node scripts/update-railway-mail-env.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const SERVICE_ID = process.env.RAILWAY_SERVICE_ID || 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';
const ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || '3abc148f-da0e-42d9-a82d-c68a737c956e';

function resolveRailwayAuth() {
  const fromEnv = process.env.RAILWAY_TOKEN?.trim()
    || process.env.RAILWAY_ACCOUNT_TOKEN?.trim()
    || process.env.RAILWAY_API_TOKEN?.trim();
  if (fromEnv) return fromEnv.startsWith('Bearer ') ? fromEnv : `Bearer ${fromEnv}`;
  const mcpPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.cursor', 'mcp.json');
  if (fs.existsSync(mcpPath)) {
    const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    const fromMcp = mcp.mcpServers?.render?.headers?.Authorization;
    if (fromMcp) return fromMcp;
  }
  throw new Error('Set RAILWAY_TOKEN or RAILWAY_ACCOUNT_TOKEN');
}

async function gql(auth, query, variables = {}) {
  const res = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }
  return body.data;
}

async function upsert(auth, name, value) {
  await gql(auth, 'mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }', {
    input: {
      projectId: PROJECT_ID,
      environmentId: ENVIRONMENT_ID,
      serviceId: SERVICE_ID,
      name,
      value: String(value),
    },
  });
  console.log(`Updated ${name}`);
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
    console.log(`Skip remove ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  const auth = resolveRailwayAuth();
  const mailFrom = process.env.MAIL_FROM || 'Investo <onboarding@resend.dev>';
  const resendApiKey = process.env.RESEND_API_KEY?.trim();

  if (!resendApiKey) {
    throw new Error('Set RESEND_API_KEY before running this script');
  }

  await upsert(auth, 'RESEND_API_KEY', resendApiKey);
  await upsert(auth, 'MAIL_FROM', mailFrom);
  await upsert(auth, 'MAIL_TRANSPORT', 'resend');

  await removeVar(auth, 'MAIL_AWS_REGION');

  await gql(auth, 'mutation($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }', {
    serviceId: SERVICE_ID,
    environmentId: ENVIRONMENT_ID,
  });
  console.log('Resend mail env updated; Railway redeploy triggered.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
