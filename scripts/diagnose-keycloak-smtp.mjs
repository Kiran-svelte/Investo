#!/usr/bin/env node
/**
 * Inspect Keycloak realm SMTP + test connection (no secrets printed).
 */
import { execFileSync } from 'node:child_process';
import { parseResendSmtpConfig } from './resend-smtp-config.mjs';

const KEYCLOAK_URL = (process.env.KEYCLOAK_URL || 'https://keycloak-production-0a87.up.railway.app').replace(/\/+$/, '');
const REALM = process.env.KEYCLOAK_REALM || 'investo';

function loadRailwayVars(service) {
  const raw = execFileSync('railway', ['variables', '--service', service, '--json'], { encoding: 'utf8' });
  return JSON.parse(raw);
}

async function getAdminToken(adminUser, adminPassword) {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: adminUser,
    password: adminPassword,
  });
  const res = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Admin token failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

async function main() {
  const backendVars = loadRailwayVars('investo-backend');
  const kcVars = loadRailwayVars('keycloak');
  const adminPassword = kcVars.KC_BOOTSTRAP_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error('Missing KC_BOOTSTRAP_ADMIN_PASSWORD');

  const smtpEnv = {
    RESEND_API_KEY: backendVars.RESEND_API_KEY,
    MAIL_FROM: backendVars.MAIL_FROM,
  };
  const expected = parseResendSmtpConfig(smtpEnv);

  const token = await getAdminToken('admin', adminPassword);
  const realmRes = await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!realmRes.ok) throw new Error(`Load realm failed (${realmRes.status})`);
  const realm = await realmRes.json();
  const smtp = realm.smtpServer || {};

  console.log('Realm:', REALM);
  console.log('Backend MAIL_FROM:', backendVars.MAIL_FROM);
  console.log('Keycloak smtpServer configured:', Boolean(smtp.host));
  console.log('Keycloak SMTP host:', smtp.host || '(none)');
  console.log('Keycloak SMTP port:', smtp.port || '(none)');
  console.log('Keycloak SMTP from:', smtp.from || '(none)');
  console.log('Keycloak SMTP auth:', smtp.auth || '(none)');
  console.log('Keycloak SMTP ssl:', smtp.ssl || '(none)');
  console.log('Keycloak SMTP user set:', Boolean(smtp.user));
  console.log('Keycloak SMTP password set:', Boolean(smtp.password));

  if (expected) {
    console.log('Expected from (backend):', expected.keycloakSmtpServer.from);
    console.log('From matches backend:', smtp.from === expected.keycloakSmtpServer.from);
  }

  if (!smtp.host) {
    console.log('\nDIAGNOSIS: Keycloak realm has NO SMTP — forgot-password UI lies with success banner.');
    process.exitCode = 2;
    return;
  }

  const testRes = await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}/testSMTPConnection`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...smtp,
      to: process.argv[2] || 'kiranlighter11@gmail.com',
    }),
  });
  const testBody = await testRes.text();
  console.log('\nTest SMTP connection:', testRes.status, testBody.slice(0, 500));
  if (!testRes.ok) {
    console.log('\nDIAGNOSIS: Keycloak SMTP test failed — emails will not send.');
    process.exitCode = 3;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
