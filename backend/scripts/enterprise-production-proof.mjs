#!/usr/bin/env node
/**
 * Production enterprise proof runner.
 *
 * Run from backend with Railway production variables:
 *   railway run --service investo-backend --environment production --no-local -- npm run proof:enterprise-production
 *
 * Uses Resend delivered+label@resend.dev recipients so mail delivery can be
 * proved without sending to a real mailbox or harming deliverability.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');

const jwt = require('jsonwebtoken');
const prisma = require('../src/config/prisma.ts').default;
const { deleteCompanyPermanently } = require('../src/services/resourceDelete.service.ts');

const API_BASE_URL = (process.env.PROOF_BASE_URL || 'https://investo-backend-production.up.railway.app').replace(/\/+$/, '');
const RUN_ID = (process.env.PROOF_RUN_ID || `proof-${Date.now().toString(36)}`).toLowerCase();
const CLEANUP = process.env.PROOF_CLEANUP !== 'false';
const RESEND_SEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_READ_API_KEY =
  process.env.RESEND_READ_API_KEY || process.env.RESEND_AUDIT_API_KEY || process.env.RESEND_API_KEY || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const REQUEST_TIMEOUT_MS = 30_000;
const RESEND_POLL_ATTEMPTS = Number.parseInt(process.env.PROOF_RESEND_POLL_ATTEMPTS || '12', 10);
const RESEND_POLL_DELAY_MS = Number.parseInt(process.env.PROOF_RESEND_POLL_DELAY_MS || '5000', 10);
const REQUIRE_RESEND_DELIVERY = process.env.PROOF_REQUIRE_RESEND_DELIVERY !== 'false';

const createdCompanyIds = new Set();
const proofEmails = new Set();
const checks = [];

function record(id, detail, extra = {}) {
  checks.push({ id, passed: true, detail, ...extra });
  process.stdout.write(`PASS ${id}: ${detail}\n`);
}

function fail(id, detail, extra = {}) {
  const err = new Error(`${id}: ${detail}`);
  err.proof = { id, detail, ...extra };
  throw err;
}

function assert(condition, id, detail, extra = {}) {
  if (!condition) fail(id, detail, extra);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeJwt(user) {
  return jwt.sign(
    {
      userId: user.id,
      companyId: user.companyId,
      role: user.role,
      email: user.email,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: '20m' },
  );
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  };

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    return { status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

async function expectApi(path, options, expectedStatuses, checkId) {
  const res = await api(path, options);
  const statuses = Array.isArray(expectedStatuses) ? expectedStatuses : [expectedStatuses];
  if (!statuses.includes(res.status)) {
    fail(checkId, `expected HTTP ${statuses.join('/')} but got ${res.status}`, {
      response: redactBody(res.body),
    });
  }
  return res;
}

function redactBody(body) {
  if (!body || typeof body !== 'object') return body;
  const json = JSON.parse(JSON.stringify(body));
  if (json?.data?.token) json.data.token = '[redacted]';
  if (json?.data?.tokens) json.data.tokens = '[redacted]';
  if (json?.data?.inviteUrl) json.data.inviteUrl = '[redacted]';
  return json;
}

async function resendGet(path) {
  const res = await fetch(`https://api.resend.com${path}`, {
    headers: {
      Authorization: `Bearer ${RESEND_READ_API_KEY}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (res.status === 401 && String(body?.name || '').includes('restricted_api_key')) {
    fail(
      'resend_read_permission',
      'Resend read API permission is required for delivery proof. Configure RESEND_READ_API_KEY or replace RESEND_API_KEY with a key that can retrieve emails.',
      { response: redactBody(body) },
    );
  }
  if (!res.ok) {
    fail('resend_api', `Resend API ${path} failed with HTTP ${res.status}`, { response: redactBody(body) });
  }
  return body;
}

async function verifyResendReadAccess() {
  if (!REQUIRE_RESEND_DELIVERY) {
    record('resend_read_permission', 'Resend read permission check skipped by PROOF_REQUIRE_RESEND_DELIVERY=false', {
      deliveryVerified: false,
    });
    return;
  }

  await resendGet('/emails?limit=1');
  record('resend_read_permission', 'Resend email retrieval API is available for delivery proof');
}

async function waitForResendEmailById(id, checkId) {
  if (!REQUIRE_RESEND_DELIVERY) {
    record(checkId, 'Resend delivery event verification skipped; email was accepted by send API', {
      resendEmailId: id,
      deliveryVerified: false,
    });
    return null;
  }

  for (let attempt = 1; attempt <= RESEND_POLL_ATTEMPTS; attempt += 1) {
    const email = await resendGet(`/emails/${encodeURIComponent(id)}`);
    if (email.last_event === 'delivered') {
      record(checkId, `Resend last_event=delivered for ${id}`, {
        resendEmailId: id,
        lastEvent: email.last_event,
      });
      return email;
    }
    if (['bounced', 'complained', 'suppressed', 'failed'].includes(email.last_event)) {
      fail(checkId, `Resend terminal event ${email.last_event} for ${id}`, { resendEmailId: id });
    }
    await sleep(RESEND_POLL_DELAY_MS);
  }
  fail(checkId, `Resend email ${id} was not delivered after polling`, { resendEmailId: id });
}

async function waitForResendEmailByRecipient(toEmail, subjectIncludes, checkId) {
  if (!REQUIRE_RESEND_DELIVERY) {
    record(checkId, 'Resend delivery event verification skipped for recipient lookup', {
      toEmail,
      subjectIncludes,
      deliveryVerified: false,
    });
    return null;
  }

  for (let attempt = 1; attempt <= RESEND_POLL_ATTEMPTS; attempt += 1) {
    const list = await resendGet('/emails?limit=100');
    const rows = Array.isArray(list.data)
      ? list.data
      : Array.isArray(list.data?.data)
        ? list.data.data
        : [];
    const match = rows.find((email) => {
      const recipients = Array.isArray(email.to) ? email.to.map(String) : [];
      return recipients.includes(toEmail) && String(email.subject || '').includes(subjectIncludes);
    });
    if (match?.id) {
      return waitForResendEmailById(match.id, checkId);
    }
    await sleep(RESEND_POLL_DELAY_MS);
  }
  fail(checkId, `No recent Resend email found for ${toEmail} subject ${subjectIncludes}`);
}

async function nextUniquePhone(seedOffset) {
  const seed = Number.parseInt(RUN_ID.replace(/\D/g, '').slice(-6) || String(Date.now()).slice(-6), 10);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const n = (seed + seedOffset + attempt) % 1_000_000_000;
    const phone = `+919${String(n).padStart(9, '0')}`;
    const [user, company] = await Promise.all([
      prisma.user.findFirst({ where: { phone, status: 'active' }, select: { id: true } }),
      prisma.company.findUnique({ where: { whatsappPhone: phone }, select: { id: true } }).catch(() => null),
    ]);
    if (!user && !company) return phone;
  }
  fail('unique_phone', 'could not allocate a unique synthetic phone');
}

function proofEmail(label) {
  const email = `delivered+${RUN_ID}-${label}@resend.dev`;
  proofEmails.add(email);
  return email;
}

async function createTenantProofUser({ index, adminToken, companyId, role, label, seedOffset }) {
  const email = proofEmail(`${label}-${index}`);
  const password = `Proof-${label}-${RUN_ID}-${index}-Aa1!`.slice(0, 60);
  const phone = await nextUniquePhone(index * 10 + seedOffset);
  const res = await expectApi(
    '/api/users',
    {
      method: 'POST',
      token: adminToken,
      body: {
        name: `Codex Proof ${label} ${index}`,
        email,
        password,
        phone,
        role,
      },
    },
    201,
    `company_${index}_${label}_create`,
  );
  const userId = res.body.data?.id || res.body.id;
  assert(userId, `company_${index}_${label}_shape`, `${role} creation returned user id`);
  record(`company_${index}_${label}_create`, `${role} user created by company admin`, {
    companyId,
    userId,
  });

  const loginRes = await expectApi(
    '/api/auth/login',
    {
      method: 'POST',
      body: { email, password },
    },
    200,
    `company_${index}_${label}_login`,
  );
  assert(
    loginRes.body.data?.tokens?.access_token,
    `company_${index}_${label}_login_token`,
    `${role} login returned access token`,
  );
  record(`company_${index}_${label}_login`, `${role} user can log in`, { companyId, userId });

  return { email, phone, userId };
}

async function createAndAcceptCompany(index, superToken) {
  const agencyName = `Codex Proof ${RUN_ID} Company ${index}`;
  const adminEmail = proofEmail(`admin-${index}`);
  const adminPassword = `Proof-${RUN_ID}-${index}-Aa1!`.slice(0, 60);
  const adminPhone = await nextUniquePhone(index * 10);

  const inviteRes = await expectApi(
    '/api/agency-invites',
    {
      method: 'POST',
      token: superToken,
      body: {
        agency_name: agencyName,
        admin_email: adminEmail,
        negotiated_monthly_price: 3,
        notes: `Enterprise production proof ${RUN_ID}`,
      },
    },
    201,
    `company_${index}_invite_create`,
  );

  const invite = inviteRes.body.data;
  assert(invite?.id && invite?.token, `company_${index}_invite_shape`, 'invite response contains id and token');
  assert(
    invite.emailDelivery?.sent === true && invite.emailDelivery?.messageId,
    `company_${index}_invite_email_accepted`,
    'invite email accepted by Resend and message id recorded',
    { inviteId: invite.id },
  );
  record(`company_${index}_invite_email_accepted`, 'invite email accepted by Resend', {
    inviteId: invite.id,
    resendEmailId: invite.emailDelivery.messageId,
  });
  await waitForResendEmailById(invite.emailDelivery.messageId, `company_${index}_invite_email_delivered`);

  const started = Date.now();
  const acceptRes = await expectApi(
    `/api/agency-invites/${invite.token}/accept`,
    {
      method: 'POST',
      body: {
        admin_name: `Codex Proof Admin ${index}`,
        password: adminPassword,
        whatsapp_phone: adminPhone,
      },
      timeoutMs: 45_000,
    },
    201,
    `company_${index}_invite_accept`,
  );
  const acceptMs = Date.now() - started;
  const companyId = acceptRes.body.data?.companyId;
  const userId = acceptRes.body.data?.userId;
  assert(companyId && userId, `company_${index}_accept_shape`, 'accept response contains companyId and userId');
  createdCompanyIds.add(companyId);
  record(`company_${index}_invite_accept`, `public invite accept completed in ${acceptMs}ms`, {
    companyId,
    userId,
    durationMs: acceptMs,
  });

  const loginRes = await expectApi(
    '/api/auth/login',
    {
      method: 'POST',
      body: { email: adminEmail, password: adminPassword },
    },
    200,
    `company_${index}_admin_login`,
  );
  const adminToken = loginRes.body.data?.tokens?.access_token;
  assert(adminToken, `company_${index}_admin_login_token`, 'login returned access token');
  record(`company_${index}_admin_login`, 'company admin can log in after invite acceptance', { companyId, userId });

  const staff = await createTenantProofUser({
    index,
    adminToken,
    companyId,
    role: 'sales_agent',
    label: 'staff',
    seedOffset: 1,
  });
  const operations = await createTenantProofUser({
    index,
    adminToken,
    companyId,
    role: 'operations',
    label: 'operations',
    seedOffset: 2,
  });
  const viewer = await createTenantProofUser({
    index,
    adminToken,
    companyId,
    role: 'viewer',
    label: 'viewer',
    seedOffset: 3,
  });

  return {
    index,
    agencyName,
    companyId,
    adminEmail,
    adminToken,
    adminUserId: userId,
    adminPhone,
    staffEmail: staff.email,
    staffPhone: staff.phone,
    staffId: staff.userId,
    operationsUserId: operations.userId,
    viewerUserId: viewer.userId,
  };
}

async function cleanupProofData() {
  if (!CLEANUP) {
    process.stdout.write('SKIP cleanup because PROOF_CLEANUP=false\n');
    return;
  }

  const companiesByPrefix = await prisma.company.findMany({
    where: { name: { startsWith: `Codex Proof ${RUN_ID}` } },
    select: { id: true, name: true },
  });
  for (const company of companiesByPrefix) {
    createdCompanyIds.add(company.id);
  }

  for (const companyId of Array.from(createdCompanyIds).reverse()) {
    try {
      await deleteCompanyPermanently(companyId);
      process.stdout.write(`CLEANUP company ${companyId}\n`);
    } catch (err) {
      process.stderr.write(`WARN cleanup company ${companyId} failed: ${err?.message || err}\n`);
    }
  }

  const deleteInvites = await prisma.agencyInvite.deleteMany({
    where: {
      OR: [
        { agencyName: { startsWith: `Codex Proof ${RUN_ID}` } },
        { adminEmail: { in: Array.from(proofEmails) } },
      ],
    },
  });
  process.stdout.write(`CLEANUP invites ${deleteInvites.count}\n`);
}

async function main() {
  if (!JWT_SECRET) fail('config', 'JWT_SECRET is required');
  if (!RESEND_SEND_API_KEY) fail('config', 'RESEND_API_KEY is required so production can send invite/reset emails');
  if (!RESEND_READ_API_KEY) {
    fail(
      'config',
      'RESEND_READ_API_KEY or a read-capable RESEND_API_KEY is required to verify delivery events',
    );
  }

  const health = await expectApi('/api/health/live', {}, 200, 'health_live');
  assert(health.body.status === 'ok', 'health_live', 'live health returned ok');
  record('health_live', 'Railway live health returned ok');
  await verifyResendReadAccess();

  const superAdmin = await prisma.user.findFirst({
    where: { role: 'super_admin', status: 'active' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, companyId: true, email: true, role: true, name: true },
  });
  assert(superAdmin, 'super_admin_available', 'active super_admin user exists for API proof');
  const superToken = makeJwt(superAdmin);
  record('super_admin_available', 'active super_admin user found for API proof');

  const companyA = await createAndAcceptCompany(1, superToken);
  const companyB = await createAndAcceptCompany(2, superToken);

  const duplicateEmailRes = await expectApi(
    '/api/users',
    {
      method: 'POST',
      token: companyA.adminToken,
      body: {
        name: 'Codex Duplicate Email',
        email: companyA.staffEmail,
        password: `Duplicate-${RUN_ID}-Aa1!`,
        phone: await nextUniquePhone(90),
        role: 'sales_agent',
      },
    },
    409,
    'duplicate_email_conflict',
  );
  assert(
    /email/i.test(duplicateEmailRes.body.error || duplicateEmailRes.body.message || ''),
    'duplicate_email_conflict_message',
    'duplicate email returns a clear conflict message',
  );
  record('duplicate_email_conflict', 'same email is rejected with HTTP 409');

  const duplicatePhoneRes = await expectApi(
    '/api/users',
    {
      method: 'POST',
      token: companyB.adminToken,
      body: {
        name: 'Codex Duplicate Phone',
        email: proofEmail('duplicate-phone'),
        password: `DuplicatePhone-${RUN_ID}-Aa1!`,
        phone: companyA.staffPhone,
        role: 'sales_agent',
      },
    },
    409,
    'duplicate_phone_conflict',
  );
  assert(
    /mobile|phone|number/i.test(duplicatePhoneRes.body.error || duplicatePhoneRes.body.message || ''),
    'duplicate_phone_conflict_message',
    'duplicate phone returns a clear conflict message',
  );
  record('duplicate_phone_conflict', 'same staff phone is rejected with HTTP 409');

  await expectApi(`/api/users/${companyB.staffId}`, { token: companyA.adminToken }, [403, 404], 'cross_company_user_blocked');
  record('cross_company_user_blocked', 'company A admin cannot read company B staff user');

  const scopedList = await expectApi(
    `/api/users?target_company_id=${encodeURIComponent(companyB.companyId)}`,
    { token: companyA.adminToken },
    200,
    'non_super_target_ignored',
  );
  const leaked = Array.isArray(scopedList.body.data)
    ? scopedList.body.data.some((u) => u.id === companyB.staffId)
    : false;
  assert(!leaked, 'non_super_target_ignored', 'non-super-admin target_company_id did not leak another company users');
  record('non_super_target_ignored', 'non-super-admin target_company_id override did not leak cross-company data');

  await expectApi('/api/users', { token: superToken }, 400, 'super_admin_requires_target');
  record('super_admin_requires_target', 'super_admin tenant route is blocked without target_company_id');

  const superScoped = await expectApi(
    `/api/users?target_company_id=${encodeURIComponent(companyB.companyId)}`,
    { token: superToken },
    200,
    'super_admin_target_allowed',
  );
  const containsCompanyBStaff = Array.isArray(superScoped.body.data)
    ? superScoped.body.data.some((u) => u.id === companyB.staffId)
    : false;
  assert(containsCompanyBStaff, 'super_admin_target_allowed', 'super_admin with target can read selected tenant users');
  record('super_admin_target_allowed', 'super_admin can read tenant users only with explicit target_company_id');

  await expectApi(
    '/api/auth/forgot-password',
    {
      method: 'POST',
      body: { email: companyA.adminEmail },
    },
    200,
    'forgot_password_request',
  );
  record('forgot_password_request', 'forgot-password endpoint accepted request for active user');
  await waitForResendEmailByRecipient(companyA.adminEmail, 'Reset your Investo password', 'forgot_password_email_delivered');

  const summary = {
    proofPassed: true,
    enterpriseReady: false,
    enterpriseReadyReason: REQUIRE_RESEND_DELIVERY
      ? 'Production onboarding, mail delivery, tenant isolation, and role checks passed; SSO/MFA/SCIM remain outside this proof runner.'
      : 'Production onboarding, tenant isolation, and role checks passed with send-accepted mail only; Resend delivery-event proof was explicitly skipped.',
    resendDeliveryVerified: REQUIRE_RESEND_DELIVERY,
    runId: RUN_ID,
    cleanup: CLEANUP,
    apiBaseUrl: API_BASE_URL,
    companiesCreated: [companyA.companyId, companyB.companyId],
    checks,
  };

  process.stdout.write(`\nPROOF_SUMMARY ${JSON.stringify(summary, null, 2)}\n`);
}

try {
  await main();
} finally {
  await cleanupProofData().catch((err) => {
    process.stderr.write(`WARN cleanup failed: ${err?.message || err}\n`);
  });
  await prisma.$disconnect().catch(() => undefined);
}
