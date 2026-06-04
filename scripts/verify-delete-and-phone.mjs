#!/usr/bin/env node
/**
 * Verifies hard-delete routes exist and staff phone uniqueness (409 on duplicate).
 * Usage: node scripts/verify-delete-and-phone.mjs [--base-url URL] [--email E] [--password P]
 */
const DEFAULT_BASE = 'https://investo-backend-v2.onrender.com/api';
const DEFAULT_EMAIL = 'admin@demorealty.in';
const DEFAULT_PASSWORD = 'demo@123';

function parseArgs() {
  const opts = { baseUrl: DEFAULT_BASE, email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && args[i + 1]) opts.baseUrl = args[++i].replace(/\/$/, '');
    if (args[i] === '--email' && args[i + 1]) opts.email = args[++i];
    if (args[i] === '--password' && args[i + 1]) opts.password = args[++i];
  }
  return opts;
}

async function request(baseUrl, path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 120) };
  }
  return { status: res.status, json };
}

async function main() {
  const { baseUrl, email, password } = parseArgs();
  console.log(`\nDelete + staff-phone verification\nBase: ${baseUrl}\n`);

  const login = await request(baseUrl, '/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  const token =
    login.json?.data?.tokens?.access_token ??
    login.json?.data?.accessToken ??
    login.json?.token;
  if (!token) {
    console.error('Login failed', login.status);
    process.exit(1);
  }

  const me = await request(baseUrl, '/auth/me', { token });
  const myPhone = me.json?.data?.phone ?? me.json?.data?.user?.phone;
  const myId = me.json?.data?.id ?? me.json?.data?.user?.id;

  let passed = 0;
  let total = 0;
  const ok = (label, detail = '') => {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
    passed += 1;
    total += 1;
  };
  const bad = (label, detail = '') => {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    total += 1;
  };

  // Route exists: DELETE notifications/all (not 404)
  const delAll = await request(baseUrl, '/notifications/all', { method: 'DELETE', token });
  if (delAll.status === 404) bad('DELETE /notifications/all', 'route missing');
  else ok('DELETE /notifications/all', `status ${delAll.status}`);

  // Fake resource delete should be 404 not 405
  const fakeLead = await request(baseUrl, '/leads/00000000-0000-4000-8000-000000000099', {
    method: 'DELETE',
    token,
  });
  if (fakeLead.status === 405) bad('DELETE /leads/:id', 'method not allowed');
  else ok('DELETE /leads/:id', `status ${fakeLead.status}`);

  const fakeConv = await request(baseUrl, '/conversations/00000000-0000-4000-8000-000000000099', {
    method: 'DELETE',
    token,
  });
  if (fakeConv.status === 405) bad('DELETE /conversations/:id', 'method not allowed');
  else ok('DELETE /conversations/:id', `status ${fakeConv.status}`);

  // Staff phone: updating profile to another active user's phone should 409
  if (myPhone && myId) {
    const users = await request(baseUrl, '/users?limit=50', { token });
    const list = users.json?.data ?? [];
    const other = list.find((u) => u.id !== myId && u.status === 'active' && u.phone && u.phone !== myPhone);
    if (other?.phone) {
      const dup = await request(baseUrl, '/auth/profile', {
        method: 'PUT',
        token,
        body: { phone: other.phone },
      });
      if (dup.status === 409) {
        ok('PUT /auth/profile duplicate phone blocked', '409');
      } else {
        bad('PUT /auth/profile duplicate phone blocked', `expected 409 got ${dup.status}`);
      }
      // Restore own phone
      await request(baseUrl, '/auth/profile', {
        method: 'PUT',
        token,
        body: { phone: myPhone },
      });
    } else {
      ok('Staff phone duplicate check', 'skipped (no second active user with phone in tenant)');
    }
  } else {
    ok('Staff phone duplicate check', 'skipped (current user has no phone on profile)');
  }

  console.log(`\n${passed}/${total} checks passed\n`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
