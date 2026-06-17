#!/usr/bin/env node
const BASE = process.env.API_BASE_URL || 'https://investo-backend-production.up.railway.app';

async function main() {
  const live = await fetch(`${BASE}/api/health/live`).then((r) => r.json());
  if (live.build?.deploy_note !== 'v0.1.12-invite-admin-tenant-body-fix') {
    throw new Error(`Unexpected deploy: ${live.build?.deploy_note}`);
  }

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'big.investo.sol@gmail.com', password: 'Investo@123' }),
  });
  const loginBody = await loginRes.json();
  const token = loginBody.data?.tokens?.access_token;
  if (!token) throw new Error(`Login failed: ${JSON.stringify(loginBody)}`);

  const companiesRes = await fetch(`${BASE}/api/companies?limit=20`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const companiesBody = await companiesRes.json();
  const tenant = (companiesBody.data || []).find((c) => c.slug !== 'investo-platform');
  if (!tenant) throw new Error('No tenant company to test invite against');

  const inviteRes = await fetch(`${BASE}/api/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: 'Body Scope Test',
      email: `body-scope-${Date.now()}@example.com`,
      password: 'TempPass123!',
      role: 'company_admin',
      target_company_id: tenant.id,
      must_change_password: true,
    }),
  });
  const inviteBody = await inviteRes.json();
  if (inviteRes.status === 400 && String(inviteBody.error || '').includes('target_company_id')) {
    throw new Error(`Still blocked by middleware: ${JSON.stringify(inviteBody)}`);
  }
  if (!inviteRes.ok && inviteRes.status !== 409) {
    throw new Error(`Invite failed ${inviteRes.status}: ${JSON.stringify(inviteBody)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    deploy_note: live.build.deploy_note,
    tenant: tenant.name,
    invite_status: inviteRes.status,
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
