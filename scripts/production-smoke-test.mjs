#!/usr/bin/env node
/**
 * Production smoke test — logs in and hits critical API endpoints.
 * Usage: node scripts/production-smoke-test.mjs [--base-url URL] [--email E] [--password P]
 */

const DEFAULT_BASE = 'https://investo-backend-production.up.railway.app/api';
const DEFAULT_EMAIL = process.env.SMOKE_EMAIL || 'big.investo.sol@gmail.com';
const DEFAULT_PASSWORD = process.env.SMOKE_PASSWORD || 'Investo@123';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    baseUrl: DEFAULT_BASE,
    email: DEFAULT_EMAIL,
    password: DEFAULT_PASSWORD,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base-url' && args[i + 1]) opts.baseUrl = args[++i].replace(/\/$/, '');
    if (args[i] === '--email' && args[i + 1]) opts.email = args[++i];
    if (args[i] === '--password' && args[i + 1]) opts.password = args[++i];
  }
  return opts;
}

async function request(baseUrl, path, { method = 'GET', token, body, companyId } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  let url = `${baseUrl}${path}`;
  if (companyId) {
    const joiner = url.includes('?') ? '&' : '?';
    url += `${joiner}target_company_id=${encodeURIComponent(companyId)}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }

  return { status: res.status, ok: res.ok, json };
}

function pass(label, detail = '') {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  return true;
}

function fail(label, detail = '') {
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

async function main() {
  const { baseUrl, email, password } = parseArgs();
  console.log(`\nInvesto production smoke test`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`User: ${email}\n`);

  const results = [];

  // Health (no auth)
  const health = await request(baseUrl, '/health');
  results.push(
    health.ok && health.json?.status
      ? pass('GET /health', health.json.status)
      : fail('GET /health', `status ${health.status}`),
  );

  // Login
  const login = await request(baseUrl, '/auth/login', {
    method: 'POST',
    body: { email, password },
  });

  const token =
    login.json?.data?.tokens?.access_token ??
    login.json?.data?.accessToken ??
    login.json?.accessToken ??
    login.json?.token;

  if (!token) {
    fail('POST /auth/login', `status ${login.status}`);
    console.log('\nCannot continue without auth token.\n');
    process.exit(1);
  }
  pass('POST /auth/login', `status ${login.status}`);

  const user = login.json?.data?.user;
  const role = user?.role;
  const tenantCompanyId = user?.company_id || user?.companyId || null;
  const scopedCompanyId = role === 'super_admin' ? tenantCompanyId : null;

  const endpoints = [
    { label: 'GET /auth/me', path: '/auth/me' },
    { label: 'GET /notifications', path: '/notifications?page=1&limit=5', scoped: true },
    { label: 'GET /leads', path: '/leads?page=1&limit=5', scoped: true },
    { label: 'GET /properties', path: '/properties?page=1&limit=5', scoped: true },
    { label: 'GET /visits', path: '/visits?page=1&limit=5', scoped: true },
    { label: 'GET /conversations', path: '/conversations?page=1&limit=5', scoped: true },
    { label: 'GET /users', path: '/users', scoped: true },
    { label: 'GET /analytics/dashboard', path: '/analytics/dashboard', scoped: true },
    { label: 'GET /ai-settings', path: '/ai-settings', scoped: true },
    { label: 'GET /features', path: '/features', scoped: true },
    { label: 'GET /onboarding/status', path: '/onboarding/status' },
    { label: 'GET /assignment-settings', path: '/assignment-settings', scoped: true },
    { label: 'GET /conversion-settings', path: '/conversion-settings', scoped: true },
    { label: 'GET /property-imports/drafts', path: '/property-imports/drafts', scoped: true },
    { label: 'GET /property-projects', path: '/property-projects', scoped: true },
    { label: 'GET /error-logs', path: '/error-logs?page=1&limit=5', scoped: true },
    { label: 'GET /subscriptions/plans', path: '/subscriptions/plans' },
    { label: 'POST /calculate-emi', path: '/calculate-emi', method: 'POST', body: { principal: 5000000, down_payment: 500000, interest_rate: 8.5, tenure_months: 240 } },
  ];

  for (const ep of endpoints) {
    const res = await request(baseUrl, ep.path, {
      method: ep.method || 'GET',
      token,
      body: ep.body,
      companyId: ep.scoped ? scopedCompanyId : null,
    });

    // 200/201 = pass; 403 = role/feature gate; 423 = property completeness gate (expected on demo tenant)
    const ok = res.status >= 200 && res.status < 300;
    const gated = res.status === 403;
    const completenessBlocked = res.status === 423;
    const notFound = res.status === 404;

    if (ok) {
      results.push(pass(ep.label, `status ${res.status}`));

      // Validate notification shape when present
      if (ep.path.startsWith('/notifications') && res.json?.data?.notifications?.[0]) {
        const n = res.json.data.notifications[0];
        const hasCreatedAt = typeof n.createdAt === 'string';
        results.push(
          hasCreatedAt
            ? pass('  notification.createdAt present (camelCase)')
            : fail('  notification.createdAt missing', JSON.stringify(Object.keys(n))),
        );
      }
    } else if (gated) {
      results.push(pass(ep.label, `status 403 (role/feature gated)`));
    } else if (completenessBlocked) {
      results.push(pass(ep.label, `status 423 (property completeness gate)`));
    } else if (notFound) {
      results.push(fail(ep.label, `status 404`));
    } else {
      results.push(fail(ep.label, `status ${res.status}`));
    }
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n${passed}/${total} checks passed\n`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
