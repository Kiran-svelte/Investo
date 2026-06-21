#!/usr/bin/env node
/** Finish Keycloak SSO: redeploy Keycloak, bootstrap realm, wire backend. */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.RAILWAY_ACCOUNT_TOKEN || process.env.RAILWAY_TOKEN;
const projectId = process.env.RAILWAY_PROJECT_ID || 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const environmentId = process.env.RAILWAY_ENVIRONMENT_ID || '3abc148f-da0e-42d9-a82d-c68a737c956e';
const backendServiceId = process.env.RAILWAY_BACKEND_SERVICE_ID || 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';
const keycloakServiceId = process.env.RAILWAY_KEYCLOAK_SERVICE_ID || '1376178d-8cdb-4caa-83f2-b8f2f053af33';
const KEYCLOAK_URL = (process.env.KEYCLOAK_URL || 'https://keycloak-production-0a87.up.railway.app').replace(/\/+$/, '');
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

async function upsertVar(serviceId, name, value) {
  await gql(`mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }`, {
    input: { projectId, environmentId, serviceId, name, value: String(value) },
  });
  await new Promise((r) => setTimeout(r, 1500));
}

async function waitHealthy(url, maxMinutes = 25) {
  const deadline = Date.now() + maxMinutes * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/realms/master`);
      if (res.ok) {
        process.stdout.write(`Keycloak ready: ${url}\n`);
        return;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 15_000));
    process.stdout.write('waiting for Keycloak…\n');
  }
  throw new Error('Keycloak did not become healthy in time');
}

async function isHealthy(url) {
  try {
    const res = await fetch(`${url}/realms/master`);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await isHealthy(KEYCLOAK_URL))) {
    process.stdout.write('Step 1: fix Keycloak start + healthcheck\n');
    execFileSync(process.execPath, [path.join(__dirname, 'railway-keycloak-fix-start.mjs')], {
      stdio: 'inherit',
      env: process.env,
    });
    await waitHealthy(KEYCLOAK_URL);
  } else {
    process.stdout.write(`Keycloak already healthy at ${KEYCLOAK_URL}\n`);
  }

  process.stdout.write('Step 2: bootstrap realm + sync users\n');
  const backendVars = await gql(
    `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }`,
    { projectId, environmentId, serviceId: backendServiceId },
  );
  const vars = backendVars.variables || {};
  const kcVars = await gql(
    `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }`,
    { projectId, environmentId, serviceId: keycloakServiceId },
  );
  const adminPassword = kcVars.variables?.KC_BOOTSTRAP_ADMIN_PASSWORD || process.env.KEYCLOAK_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error('Missing KC_BOOTSTRAP_ADMIN_PASSWORD on Keycloak service');

  const bootstrapOut = execFileSync(process.execPath, [path.join(__dirname, 'keycloak-bootstrap.mjs')], {
    env: {
      ...process.env,
      KEYCLOAK_URL,
      KEYCLOAK_ADMIN: 'admin',
      KEYCLOAK_ADMIN_PASSWORD: adminPassword,
      KEYCLOAK_REALM: 'investo',
      KEYCLOAK_CLIENT_ID: 'investo-app',
      SSO_CALLBACK_URL: 'https://investo-backend-production.up.railway.app/api/auth/sso/callback',
      KEYCLOAK_USER_PASSWORD: process.env.KEYCLOAK_USER_PASSWORD || 'Investo@123',
      DIRECT_URL: vars.DIRECT_URL || vars.DATABASE_URL,
      DATABASE_URL: vars.DATABASE_URL,
      FRONTEND_BASE_URL: 'https://biginvesto.online',
      RESEND_API_KEY: vars.RESEND_API_KEY,
      MAIL_FROM: vars.MAIL_FROM,
    },
    encoding: 'utf8',
  });
  const bootstrapJson = JSON.parse(bootstrapOut.trim());

  if (token) {
    await upsertVar(keycloakServiceId, 'RESEND_API_KEY', vars.RESEND_API_KEY || '');
    await upsertVar(keycloakServiceId, 'MAIL_FROM', vars.MAIL_FROM || '');
    await upsertVar(backendServiceId, 'KEYCLOAK_ADMIN_PASSWORD', adminPassword);
  }

  process.stdout.write('Step 3: wire backend env\n');
  await upsertVar(backendServiceId, 'KEYCLOAK_ENABLED', 'true');
  await upsertVar(backendServiceId, 'KEYCLOAK_URL', KEYCLOAK_URL);
  await upsertVar(backendServiceId, 'KEYCLOAK_REALM', 'investo');
  await upsertVar(backendServiceId, 'KEYCLOAK_CLIENT_ID', 'investo-app');
  await upsertVar(backendServiceId, 'KEYCLOAK_CLIENT_SECRET', bootstrapJson.client_secret);
  await upsertVar(backendServiceId, 'KEYCLOAK_ADMIN_PASSWORD', adminPassword);
  await upsertVar(backendServiceId, 'KEYCLOAK_SSO_ALL_TENANTS', 'true');
  await upsertVar(backendServiceId, 'SSO_TEST_IDP', 'false');
  await upsertVar(backendServiceId, 'FEATURE_SSO', 'true');

  process.stdout.write('Step 4: redeploy backend\n');
  execFileSync(process.execPath, [path.join(__dirname, 'deploy-railway-graphql.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, RAILWAY_PROJECT_ID: projectId },
  });

  process.stdout.write('Step 5: SSO smoke test\n');
  execFileSync(process.execPath, [path.join(__dirname, 'production-keycloak-sso-smoke.mjs')], {
    stdio: 'inherit',
    env: process.env,
  });

  process.stdout.write('\nKeycloak enterprise SSO is live.\n');
  process.stdout.write(`Keycloak: ${KEYCLOAK_URL}\n`);
  process.stdout.write(`SSO login: https://biginvesto.online/auth/sso\n`);
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
