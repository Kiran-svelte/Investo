#!/usr/bin/env node
/**
 * End-to-end Keycloak on Railway + Investo backend wiring.
 *
 * Usage:
 *   RAILWAY_ACCOUNT_TOKEN=... node scripts/railway-keycloak-setup.mjs
 *
 * Creates Keycloak service (if missing), sets env, deploys, bootstraps realm,
 * syncs users, and configures investo-backend for platform Keycloak SSO.
 */
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../backend');
const require = createRequire(path.join(backendRoot, 'package.json'));

const token = process.env.RAILWAY_ACCOUNT_TOKEN || process.env.RAILWAY_TOKEN;
const projectId = process.env.RAILWAY_PROJECT_ID || 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const environmentId = process.env.RAILWAY_ENVIRONMENT_ID || '3abc148f-da0e-42d9-a82d-c68a737c956e';
const backendServiceId = process.env.RAILWAY_BACKEND_SERVICE_ID || 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';
const GRAPHQL = 'https://backboard.railway.com/graphql/v2';

const BACKEND_PUBLIC_URL = 'https://investo-backend-production.up.railway.app';
const FRONTEND_BASE_URL = 'https://biginvesto.online';
const KEYCLOAK_USER_PASSWORD = process.env.KEYCLOAK_USER_PASSWORD || 'Investo@123';

if (!token) {
  console.error('Set RAILWAY_ACCOUNT_TOKEN');
  process.exit(1);
}

async function gql(query, variables = {}) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }
  return body.data;
}

function parsePg(urlString) {
  const normalized = urlString.replace(/^postgresql:\/\//, 'postgres://');
  const url = new URL(normalized);
  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, '').split('?')[0] || 'postgres',
  };
}

async function upsertVar(serviceId, name, value) {
  await gql(
    `mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }`,
    {
      input: { projectId, environmentId, serviceId, name, value: String(value) },
    },
  );
  process.stdout.write(`  set ${name} on ${serviceId.slice(0, 8)}…\n`);
}

async function waitForDeploy(deployId, label) {
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20_000));
    const data = await gql('query($id: String!) { deployment(id: $id) { status } }', { id: deployId });
    const status = data.deployment?.status;
    process.stdout.write(`${label} deploy: ${status}\n`);
    if (['SUCCESS', 'SLEEPING', 'ACTIVE'].includes(status)) return status;
    if (['FAILED', 'REMOVED', 'CANCELLED', 'CRASHED'].includes(status)) {
      throw new Error(`${label} deploy failed: ${status}`);
    }
  }
  throw new Error(`${label} deploy timed out`);
}

async function ensureKeycloakSchema(directUrl) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: directUrl });
  await client.connect();
  await client.query('CREATE SCHEMA IF NOT EXISTS keycloak');
  await client.end();
  process.stdout.write('Ensured Postgres schema: keycloak\n');
}

async function findOrCreateKeycloakService(services) {
  const existing = services.find((s) => /keycloak/i.test(s.name));
  if (existing) {
    process.stdout.write(`Using existing Keycloak service: ${existing.name} (${existing.id})\n`);
    return existing.id;
  }

  const created = await gql(
    `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }`,
    {
      input: {
        projectId,
        environmentId,
        name: 'keycloak',
        source: { image: 'quay.io/keycloak/keycloak:26.0.5' },
      },
    },
  );

  const serviceId = created.serviceCreate.id;
  process.stdout.write(`Created Keycloak service: ${serviceId}\n`);
  return serviceId;
}

async function ensureRailwayDomain(serviceId) {
  const data = await gql(
    `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
        domain
      }
    }`,
    { projectId, environmentId, serviceId },
  ).catch(() => null);

  const existing = data?.domains?.[0]?.domain;
  if (existing) {
    return `https://${existing}`;
  }

  try {
    const created = await gql(
      `mutation($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) { domain }
      }`,
      {
        input: {
          serviceId,
          environmentId,
          targetPort: 8080,
        },
      },
    );
    const domain = created.serviceDomainCreate?.domain;
    if (domain) return `https://${domain}`;
  } catch (err) {
    process.stdout.write(`Domain create skipped: ${err.message}\n`);
  }

  return process.env.KEYCLOAK_URL || '';
}

async function main() {
  const project = await gql(
    `query($id: String!) {
      project(id: $id) {
        services { edges { node { id name } } }
      }
    }`,
    { id: projectId },
  );
  const services = project.project.services.edges.map((e) => e.node);

  const backendVars = await gql(
    `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }`,
    { projectId, environmentId, serviceId: backendServiceId },
  );
  const vars = backendVars.variables || {};
  const directUrl = vars.DIRECT_URL || vars.DATABASE_URL;
  if (!directUrl) throw new Error('Backend DATABASE_URL not found on Railway');

  await ensureKeycloakSchema(directUrl);
  const pg = parsePg(directUrl);

  const keycloakServiceId = await findOrCreateKeycloakService(services);
  const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');

  const jdbcUrl = `jdbc:postgresql://${pg.host}:${pg.port}/${pg.database}?currentSchema=keycloak&sslmode=require`;

  await upsertVar(keycloakServiceId, 'KC_DB', 'postgres');
  await upsertVar(keycloakServiceId, 'KC_DB_URL', jdbcUrl);
  await upsertVar(keycloakServiceId, 'KC_DB_USERNAME', pg.user);
  await upsertVar(keycloakServiceId, 'KC_DB_PASSWORD', pg.password);
  await upsertVar(keycloakServiceId, 'KC_BOOTSTRAP_ADMIN_USERNAME', 'admin');
  await upsertVar(keycloakServiceId, 'KC_BOOTSTRAP_ADMIN_PASSWORD', adminPassword);
  await upsertVar(keycloakServiceId, 'KC_PROXY_HEADERS', 'xforwarded');
  await upsertVar(keycloakServiceId, 'KC_HTTP_ENABLED', 'true');
  await upsertVar(keycloakServiceId, 'KC_HOSTNAME_STRICT', 'false');
  await upsertVar(keycloakServiceId, 'KC_HEALTH_ENABLED', 'true');
  await upsertVar(keycloakServiceId, 'KC_METRICS_ENABLED', 'true');

  process.stdout.write('Deploying Keycloak service…\n');
  const kcDeploy = await gql(
    `mutation($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    { serviceId: keycloakServiceId, environmentId },
  );
  await waitForDeploy(kcDeploy.serviceInstanceDeployV2, 'Keycloak');

  let keycloakUrl = await ensureRailwayDomain(keycloakServiceId);
  if (!keycloakUrl) {
    keycloakUrl = process.env.KEYCLOAK_URL || '';
  }
  if (!keycloakUrl) {
    throw new Error('Could not resolve Keycloak public URL — set KEYCLOAK_URL and re-run bootstrap');
  }
  keycloakUrl = keycloakUrl.replace(/\/+$/, '');
  process.stdout.write(`Keycloak URL: ${keycloakUrl}\n`);

  await upsertVar(keycloakServiceId, 'KC_HOSTNAME', keycloakUrl.replace(/^https:\/\//, ''));

  process.stdout.write('Running Keycloak bootstrap (realm, client, users)…\n');
  const bootstrapEnv = {
    ...process.env,
    KEYCLOAK_URL: keycloakUrl,
    KEYCLOAK_ADMIN: 'admin',
    KEYCLOAK_ADMIN_PASSWORD: adminPassword,
    KEYCLOAK_REALM: 'investo',
    KEYCLOAK_CLIENT_ID: 'investo-app',
    SSO_CALLBACK_URL: `${BACKEND_PUBLIC_URL}/api/auth/sso/callback`,
    KEYCLOAK_USER_PASSWORD,
    DIRECT_URL: directUrl,
    DATABASE_URL: vars.DATABASE_URL || directUrl,
    FRONTEND_BASE_URL,
  };

  const bootstrapOut = execFileSync(process.execPath, [path.join(__dirname, 'keycloak-bootstrap.mjs')], {
    env: bootstrapEnv,
    encoding: 'utf8',
  });
  const bootstrapJson = JSON.parse(bootstrapOut.trim());
  const clientSecret = bootstrapJson.client_secret;
  if (!clientSecret) throw new Error('Bootstrap did not return client_secret');

  await upsertVar(backendServiceId, 'KEYCLOAK_ENABLED', 'true');
  await upsertVar(backendServiceId, 'KEYCLOAK_URL', keycloakUrl);
  await upsertVar(backendServiceId, 'KEYCLOAK_REALM', 'investo');
  await upsertVar(backendServiceId, 'KEYCLOAK_CLIENT_ID', 'investo-app');
  await upsertVar(backendServiceId, 'KEYCLOAK_CLIENT_SECRET', clientSecret);
  await upsertVar(backendServiceId, 'KEYCLOAK_SSO_ALL_TENANTS', 'true');
  await upsertVar(backendServiceId, 'SSO_TEST_IDP', 'false');
  await upsertVar(backendServiceId, 'FEATURE_SSO', 'true');

  process.stdout.write('Deploying investo-backend…\n');
  const beDeploy = await gql(
    `mutation($serviceId: String!, $environmentId: String!) {
      serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
    }`,
    { serviceId: backendServiceId, environmentId },
  );
  await waitForDeploy(beDeploy.serviceInstanceDeployV2, 'Backend');

  process.stdout.write('\nKeycloak SSO setup complete.\n');
  process.stdout.write(`Keycloak admin: ${keycloakUrl}/admin (admin / ${adminPassword})\n`);
  process.stdout.write(`SSO login: ${FRONTEND_BASE_URL}/auth/sso\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
