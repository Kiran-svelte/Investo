#!/usr/bin/env node
/**
 * Production proof: phase 2 strict tenant isolation is live.
 */
const BASE = process.env.API_BASE_URL || 'https://investo-backend-production.up.railway.app';

async function main() {
  const live = await fetch(`${BASE}/api/health/live`).then((r) => r.json());
  console.log('Health live:', JSON.stringify(live, null, 2));

  const expectedNote = 'v0.1.11-tenant-isolation-phase2';
  if (live.build?.deploy_note !== expectedNote) {
    throw new Error(`Expected deploy_note ${expectedNote}, got ${live.build?.deploy_note}`);
  }

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'big.investo.sol@gmail.com', password: 'Investo@123' }),
  });
  const loginBody = await loginRes.json();
  const token = loginBody.access_token
    || loginBody.data?.tokens?.access_token
    || loginBody.data?.access_token;
  if (!loginRes.ok || !token) {
    throw new Error(`Login failed: ${JSON.stringify(loginBody)}`);
  }
  const leadsRes = await fetch(`${BASE}/api/leads`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const leadsBody = await leadsRes.json();
  if (leadsRes.status !== 400) {
    throw new Error(`Expected 400 for super_admin without target_company_id, got ${leadsRes.status}: ${JSON.stringify(leadsBody)}`);
  }
  if (!String(leadsBody.error || '').includes('target_company_id')) {
    throw new Error(`Unexpected error body: ${JSON.stringify(leadsBody)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    deploy_note: live.build.deploy_note,
    git_commit: live.build.git_commit,
    strict_tenant_isolation: 'super_admin /api/leads requires target_company_id',
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
