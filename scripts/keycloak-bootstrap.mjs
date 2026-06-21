#!/usr/bin/env node
/**
 * Bootstrap Keycloak realm, OIDC client, and sync Investo users.
 *
 * Env:
 *   KEYCLOAK_URL — public base URL (e.g. https://keycloak-xxx.up.railway.app)
 *   KEYCLOAK_ADMIN — admin username (default: admin)
 *   KEYCLOAK_ADMIN_PASSWORD — admin password
 *   KEYCLOAK_REALM — default investo
 *   KEYCLOAK_CLIENT_ID — default investo-app
 *   SSO_CALLBACK_URL — backend OIDC callback
 *   KEYCLOAK_USER_PASSWORD — initial password for synced users (must match Investo for seamless UX)
 *   DATABASE_URL or DIRECT_URL — Investo Postgres for user sync
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getResendSmtpMissingDetail, parseResendSmtpConfig } from './resend-smtp-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../backend');
const require = createRequire(path.join(backendRoot, 'package.json'));

const keycloakUrl = (process.env.KEYCLOAK_URL || '').replace(/\/+$/, '');
const adminUser = process.env.KEYCLOAK_ADMIN || 'admin';
const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD || '';
const realm = process.env.KEYCLOAK_REALM || 'investo';
const clientId = process.env.KEYCLOAK_CLIENT_ID || 'investo-app';
const callbackUrl = process.env.SSO_CALLBACK_URL
  || 'https://investo-backend-production.up.railway.app/api/auth/sso/callback';
const userPassword = process.env.KEYCLOAK_USER_PASSWORD || 'Investo@123';
const frontendUrl = (process.env.FRONTEND_BASE_URL || 'https://biginvesto.online').replace(/\/+$/, '');

if (!keycloakUrl || !adminPassword) {
  console.error('Set KEYCLOAK_URL and KEYCLOAK_ADMIN_PASSWORD');
  process.exit(1);
}

async function waitForKeycloak(maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const res = await fetch(`${keycloakUrl}/realms/master`);
      if (res.ok) {
        process.stderr.write('Keycloak is ready\n');
        return;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Keycloak health check timed out');
}

async function getAdminToken() {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: adminUser,
    password: adminPassword,
  });
  const res = await fetch(`${keycloakUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Keycloak admin token failed (${res.status}): ${await res.text()}`);
  }
  const payload = await res.json();
  return payload.access_token;
}

async function adminFetch(token, method, pathSuffix, body) {
  const res = await fetch(`${keycloakUrl}${pathSuffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

async function ensureRealm(token) {
  const getRes = await adminFetch(token, 'GET', `/admin/realms/${realm}`);
  if (getRes.ok) {
    process.stderr.write(`Realm ${realm} exists\n`);
    return;
  }

  const createRes = await adminFetch(token, 'POST', '/admin/realms', {
    realm,
    enabled: true,
    displayName: 'Investo',
    loginWithEmailAllowed: true,
    registrationAllowed: false,
    resetPasswordAllowed: true,
    editUsernameAllowed: false,
    sslRequired: 'external',
  });
  if (!createRes.ok && createRes.status !== 409) {
    throw new Error(`Create realm failed (${createRes.status}): ${await createRes.text()}`);
  }
  process.stderr.write(`Created realm ${realm}\n`);
}

async function ensureRealmSmtp(token) {
  const smtpConfig = parseResendSmtpConfig();
  if (!smtpConfig) {
    throw new Error(`Keycloak SMTP not configured: ${getResendSmtpMissingDetail()}`);
  }

  const getRes = await adminFetch(token, 'GET', `/admin/realms/${realm}`);
  if (!getRes.ok) {
    throw new Error(`Load realm for SMTP failed (${getRes.status}): ${await getRes.text()}`);
  }

  const realmPayload = await getRes.json();
  realmPayload.smtpServer = smtpConfig.keycloakSmtpServer;

  const putRes = await adminFetch(token, 'PUT', `/admin/realms/${realm}`, realmPayload);
  if (!putRes.ok) {
    throw new Error(`Configure Keycloak SMTP failed (${putRes.status}): ${await putRes.text()}`);
  }

  process.stderr.write(`Configured Keycloak SMTP via Resend (${smtpConfig.mailFrom})\n`);
}

async function ensureClient(token) {
  const listRes = await adminFetch(token, 'GET', `/admin/realms/${realm}/clients?clientId=${clientId}`);
  const clients = await listRes.json();
  let internalId = clients[0]?.id;

  if (!internalId) {
    const createRes = await adminFetch(token, 'POST', `/admin/realms/${realm}/clients`, {
      clientId,
      name: 'Investo App',
      enabled: true,
      protocol: 'openid-connect',
      publicClient: false,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: [callbackUrl],
      webOrigins: [frontendUrl, 'https://biginvesto.online', '+'],
      rootUrl: frontendUrl,
      baseUrl: frontendUrl,
    });
    if (!createRes.ok && createRes.status !== 409) {
      throw new Error(`Create client failed (${createRes.status}): ${await createRes.text()}`);
    }
    const again = await adminFetch(token, 'GET', `/admin/realms/${realm}/clients?clientId=${clientId}`);
    internalId = (await again.json())[0]?.id;
  }

  if (!internalId) {
    throw new Error('Client internal id not found');
  }

  await adminFetch(token, 'PUT', `/admin/realms/${realm}/clients/${internalId}`, {
    clientId,
    enabled: true,
    redirectUris: [callbackUrl],
    webOrigins: [frontendUrl, 'https://biginvesto.online', '+'],
  });

  const secretRes = await adminFetch(token, 'GET', `/admin/realms/${realm}/clients/${internalId}/client-secret`);
  const secretPayload = await secretRes.json();
  return secretPayload.value;
}

async function syncUsers(token) {
  const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    process.stderr.write('Skip user sync — no DATABASE_URL\n');
    return 0;
  }

  const { Client } = require('pg');
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  const users = await client.query(
    `SELECT id, email, name, status FROM users WHERE status = 'active' ORDER BY email`,
  );
  await client.end();

  let synced = 0;
  for (const user of users.rows) {
    const email = String(user.email).trim().toLowerCase();
    if (!email) continue;

    const listRes = await adminFetch(
      token,
      'GET',
      `/admin/realms/${realm}/users?email=${encodeURIComponent(email)}&exact=true`,
    );
    const existing = await listRes.json();

    if (existing.length === 0) {
      const createRes = await adminFetch(token, 'POST', `/admin/realms/${realm}/users`, {
        username: email,
        email,
        emailVerified: true,
        enabled: true,
        firstName: String(user.name || email.split('@')[0]).split(' ')[0],
        lastName: String(user.name || '').split(' ').slice(1).join(' ') || 'User',
        attributes: { investo_user_id: [user.id] },
      });
      if (!createRes.ok && createRes.status !== 409) {
        process.stderr.write(`Skip user ${email}: ${createRes.status}\n`);
        continue;
      }
    }

    const refreshed = await adminFetch(
      token,
      'GET',
      `/admin/realms/${realm}/users?email=${encodeURIComponent(email)}&exact=true`,
    );
    const kcUser = (await refreshed.json())[0];
    if (!kcUser?.id) continue;

    const credRes = await adminFetch(token, 'PUT', `/admin/realms/${realm}/users/${kcUser.id}/reset-password`, {
      type: 'password',
      value: userPassword,
      temporary: false,
    });
    if (!credRes.ok) {
      process.stderr.write(`Password sync failed for ${email}: ${credRes.status}\n`);
      continue;
    }

    synced += 1;
  }

  return synced;
}

async function syncInvestoIdentityConfigs() {
  const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!dbUrl) return;

  const { Client } = require('pg');
  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  const issuer = `${keycloakUrl}/realms/${realm}`;
  const companies = await client.query(`SELECT id, name FROM companies WHERE status = 'active'`);

  for (const company of companies.rows) {
    const admins = await client.query(
      `SELECT email FROM users WHERE company_id = $1 AND status = 'active' LIMIT 20`,
      [company.id],
    );
    const domains = [...new Set(
      admins.rows
        .map((row) => String(row.email).split('@')[1]?.toLowerCase())
        .filter(Boolean),
    )];

    await client.query(
      `INSERT INTO company_identity_configs (
        company_id, sso_enabled, sso_provider, sso_oidc_issuer, sso_oidc_client_id,
        scim_enabled, mfa_required, allowed_domains, ip_allowlist_enabled, ip_allowlist, mfa_methods
      ) VALUES ($1, true, 'keycloak', $2, $3, false, false, $4::jsonb, false, '[]'::jsonb, '["totp"]'::jsonb)
      ON CONFLICT (company_id) DO UPDATE SET
        sso_enabled = true,
        sso_provider = 'keycloak',
        sso_oidc_issuer = EXCLUDED.sso_oidc_issuer,
        sso_oidc_client_id = EXCLUDED.sso_oidc_client_id,
        allowed_domains = EXCLUDED.allowed_domains,
        updated_at = CURRENT_TIMESTAMP`,
      [company.id, issuer, clientId, JSON.stringify(domains)],
    );
    process.stderr.write(`SSO enabled for ${company.name} domains=${domains.join(',') || 'none'}\n`);
  }

  await client.end();
}

async function main() {
  await waitForKeycloak();
  const token = await getAdminToken();
  await ensureRealm(token);
  await ensureRealmSmtp(token);
  const clientSecret = await ensureClient(token);
  const synced = await syncUsers(token);
  await syncInvestoIdentityConfigs();

  const output = {
    keycloak_url: keycloakUrl,
    realm,
    client_id: clientId,
    client_secret: clientSecret,
    issuer: `${keycloakUrl}/realms/${realm}`,
    callback_url: callbackUrl,
    users_synced: synced,
    smtp_configured: true,
  };

  console.error(`Bootstrap complete: ${synced} users synced`);
  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
