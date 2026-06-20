#!/usr/bin/env node
/**
 * Production smoke test for Keycloak SSO flow.
 */
const API = process.env.API_BASE_URL || 'https://investo-backend-production.up.railway.app/api';
const EMAIL = process.env.SMOKE_EMAIL || 'big.investo.sol@gmail.com';
const PASSWORD = process.env.SMOKE_PASSWORD || 'Investo@123';

const checks = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    checks.push({ name, ok: false, error: err.message });
    process.stdout.write(`  ✗ ${name}: ${err.message}\n`);
  }
}

async function main() {
  process.stdout.write(`\nKeycloak SSO production smoke\nAPI: ${API}\nEmail: ${EMAIL}\n\n`);

  await check('GET /auth/sso/config', async () => {
    const res = await fetch(`${API}/auth/sso/config`);
    const body = await res.json();
    if (!res.ok) throw new Error(`status ${res.status}`);
    if (!body.data?.keycloak_enabled) throw new Error('keycloak_enabled is false');
    if (!body.data?.keycloak_url) throw new Error('missing keycloak_url');
  });

  await check('POST /auth/sso/start redirects to Keycloak', async () => {
    const res = await fetch(`${API}/auth/sso/start?email=${encodeURIComponent(EMAIL)}`, {
      headers: { Accept: 'application/json' },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `status ${res.status}`);
    const url = body.data?.redirect_url || '';
    if (!url.includes('/realms/')) throw new Error(`not a Keycloak URL: ${url.slice(0, 120)}`);
    if (!url.includes('client_id=')) throw new Error('missing client_id in authorize URL');
  });

  await check('Keycloak OIDC discovery', async () => {
    const cfgRes = await fetch(`${API}/auth/sso/config`);
    const cfg = await cfgRes.json();
    const issuer = `${cfg.data.keycloak_url}/realms/${cfg.data.realm || 'investo'}`;
    const discRes = await fetch(`${issuer}/.well-known/openid-configuration`);
    if (!discRes.ok) throw new Error(`discovery ${discRes.status}`);
    const disc = await discRes.json();
    if (!disc.authorization_endpoint) throw new Error('no authorization_endpoint');
  });

  await check('Password login still works', async () => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
  });

  const passed = checks.filter((c) => c.ok).length;
  process.stdout.write(`\n${passed}/${checks.length} checks passed\n`);
  if (passed !== checks.length) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err}\n`);
  process.exit(1);
});
