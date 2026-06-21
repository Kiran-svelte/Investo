#!/usr/bin/env node
/**
 * Global platform email fix: Resend health + Keycloak SMTP + forgot-password smoke.
 *
 * Usage (production):
 *   RAILWAY_ACCOUNT_TOKEN=... node scripts/configure-platform-email.mjs [test-email]
 *
 * Requires backend Railway vars RESEND_API_KEY + MAIL_FROM (read from API or env).
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getResendSmtpMissingDetail, parseResendSmtpConfig } from './resend-smtp-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const token = process.env.RAILWAY_ACCOUNT_TOKEN || process.env.RAILWAY_TOKEN;
const projectId = process.env.RAILWAY_PROJECT_ID || 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const environmentId = process.env.RAILWAY_ENVIRONMENT_ID || '3abc148f-da0e-42d9-a82d-c68a737c956e';
const backendServiceId = process.env.RAILWAY_BACKEND_SERVICE_ID || 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';
const keycloakServiceId = process.env.RAILWAY_KEYCLOAK_SERVICE_ID || '1376178d-8cdb-4caa-83f2-b8f2f053af33';
const KEYCLOAK_URL = (process.env.KEYCLOAK_URL || 'https://keycloak-production-0a87.up.railway.app').replace(/\/+$/, '');
const API_BASE = process.env.API_BASE_URL || 'https://investo-backend-production.up.railway.app';
const TEST_EMAIL = process.argv[2] || process.env.TEST_EMAIL_TO || 'big.investo.sol@gmail.com';
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

async function loadBackendVars() {
  if (!token) {
    try {
      const dotenvPath = path.join(__dirname, '../backend/.env');
      if (process.env.RESEND_API_KEY?.trim() && process.env.MAIL_FROM?.trim()) {
        return {
          RESEND_API_KEY: process.env.RESEND_API_KEY,
          MAIL_FROM: process.env.MAIL_FROM,
          DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
          DATABASE_URL: process.env.DATABASE_URL || '',
        };
      }
      const fs = await import('node:fs');
      if (fs.existsSync(dotenvPath)) {
        const raw = fs.readFileSync(dotenvPath, 'utf8');
        for (const line of raw.split('\n')) {
          const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
          if (!m) continue;
          if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
        }
      }
    } catch {
      // ignore
    }
    return {
      RESEND_API_KEY: process.env.RESEND_API_KEY || '',
      MAIL_FROM: process.env.MAIL_FROM || '',
      DIRECT_URL: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
      DATABASE_URL: process.env.DATABASE_URL || '',
    };
  }

  const data = await gql(
    `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }`,
    { projectId, environmentId, serviceId: backendServiceId },
  );
  return data.variables || {};
}

async function loadKeycloakAdminPassword() {
  if (!token) return process.env.KEYCLOAK_ADMIN_PASSWORD || '';
  const data = await gql(
    `query($projectId: String!, $environmentId: String!, $serviceId: String!) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }`,
    { projectId, environmentId, serviceId: keycloakServiceId },
  );
  return data.variables?.KC_BOOTSTRAP_ADMIN_PASSWORD || process.env.KEYCLOAK_ADMIN_PASSWORD || '';
}

async function checkBackendMailHealth() {
  const res = await fetch(`${API_BASE}/api/health`);
  const body = await res.json();
  const mail = body.dependencies?.mail;
  console.log('Backend mail health:', mail);
  if (mail?.status !== 'ok') {
    throw new Error(`Backend mail health not ok: ${JSON.stringify(mail)}`);
  }
}

async function configureKeycloakSmtp(env) {
  const adminPassword = await loadKeycloakAdminPassword();
  if (!adminPassword) throw new Error('Missing KEYCLOAK_ADMIN_PASSWORD');

  await syncKeycloakServiceEmailEnv(env, adminPassword);

  const bootstrapOut = execFileSync(process.execPath, [path.join(__dirname, 'keycloak-bootstrap.mjs')], {
    env: {
      ...process.env,
      ...env,
      KEYCLOAK_URL,
      KEYCLOAK_ADMIN: 'admin',
      KEYCLOAK_ADMIN_PASSWORD: adminPassword,
      KEYCLOAK_REALM: 'investo',
      KEYCLOAK_CLIENT_ID: 'investo-app',
      SSO_CALLBACK_URL: `${API_BASE}/api/auth/sso/callback`,
      FRONTEND_BASE_URL: 'https://biginvesto.online',
    },
    encoding: 'utf8',
  });

  const result = JSON.parse(bootstrapOut.trim());
  if (!result.smtp_configured) {
    throw new Error('Keycloak bootstrap did not report smtp_configured=true');
  }
  console.log('Keycloak SMTP configured:', result.smtp_configured);
}

async function syncKeycloakServiceEmailEnv(env, adminPassword) {
  if (!token) return;
  await gql(`mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }`, {
    input: { projectId, environmentId, serviceId: keycloakServiceId, name: 'RESEND_API_KEY', value: String(env.RESEND_API_KEY) },
  });
  await gql(`mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }`, {
    input: { projectId, environmentId, serviceId: keycloakServiceId, name: 'MAIL_FROM', value: String(env.MAIL_FROM) },
  });
  await gql(`mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }`, {
    input: { projectId, environmentId, serviceId: backendServiceId, name: 'KEYCLOAK_ADMIN_PASSWORD', value: String(adminPassword) },
  });
  console.log('Synced RESEND/MAIL_FROM to Keycloak service and admin password to backend');
}

async function testKeycloakEmail(adminPassword, env, toEmail) {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: 'admin',
    password: adminPassword,
  });
  const tokenRes = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!tokenRes.ok) throw new Error(`Keycloak admin token failed (${tokenRes.status})`);
  const adminToken = (await tokenRes.json()).access_token;

  const testRes = await fetch(`${KEYCLOAK_URL}/admin/realms/investo/testSMTPConnection`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...parseResendSmtpConfig(env).keycloakSmtpServer,
      to: toEmail,
    }),
  });
  const text = await testRes.text();
  console.log('Keycloak email test:', testRes.status, text.slice(0, 200));
  if (!testRes.ok) {
    throw new Error(`Keycloak email test failed (${testRes.status})`);
  }
}

async function runMailVerificationScript(env) {
  execFileSync(process.execPath, [path.join(__dirname, '../backend/scripts/verify-production-mail-and-webhook.mjs'), TEST_EMAIL], {
    stdio: 'inherit',
    env: { ...process.env, ...env, API_BASE_URL: API_BASE },
  });
}

async function main() {
  const backendVars = await loadBackendVars();
  const env = {
    RESEND_API_KEY: backendVars.RESEND_API_KEY || process.env.RESEND_API_KEY,
    MAIL_FROM: backendVars.MAIL_FROM || process.env.MAIL_FROM,
    DIRECT_URL: backendVars.DIRECT_URL || backendVars.DATABASE_URL,
    DATABASE_URL: backendVars.DATABASE_URL || backendVars.DIRECT_URL,
  };

  if (!parseResendSmtpConfig(env)) {
    throw new Error(getResendSmtpMissingDetail(env));
  }

  console.log('Step 1: backend mail health');
  await checkBackendMailHealth();

  console.log('Step 2: configure Keycloak SMTP (Resend) + sync users');
  await configureKeycloakSmtp(env);

  const adminPassword = await loadKeycloakAdminPassword();
  console.log('Step 3: verify Keycloak email delivery');
  await testKeycloakEmail(adminPassword, env, TEST_EMAIL);

  console.log('Step 4: direct Resend + forgot-password smoke');
  await runMailVerificationScript(env);

  console.log(`SUCCESS: platform email configured. Test messages queued for ${TEST_EMAIL}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
