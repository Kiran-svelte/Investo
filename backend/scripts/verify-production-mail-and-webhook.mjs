#!/usr/bin/env node
/**
 * End-to-end production checks for Resend mail + DB-backed Meta webhook readiness.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.API_BASE_URL || 'https://investo-backend-production.up.railway.app';
const TEST_EMAIL = process.argv[2] || process.env.TEST_EMAIL_TO || 'big.investo.sol@gmail.com';
const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim();
const MAIL_FROM = process.env.MAIL_FROM || 'Investo <onboarding@resend.dev>';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  const varsPath = path.join(__dirname, '..', '..', 'scripts', '.railway-prod-vars.json');
  if (fs.existsSync(varsPath)) {
    const vars = JSON.parse(fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, ''));
    if (vars.DATABASE_URL) return vars.DATABASE_URL;
  }
  return '';
}

async function loadTenantWebhookSecrets() {
  const connectionString = loadDatabaseUrl();
  if (!connectionString) return { appSecret: '', phoneNumberId: '' };

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const companies = await prisma.company.findMany({
      where: { status: 'active' },
      select: { settings: true },
    });

    for (const company of companies) {
      const settings = (company.settings && typeof company.settings === 'object')
        ? company.settings
        : {};
      const whatsapp = (settings.whatsapp && typeof settings.whatsapp === 'object')
        ? settings.whatsapp
        : {};
      const meta = (whatsapp.meta && typeof whatsapp.meta === 'object') ? whatsapp.meta : whatsapp;
      const appSecret = String(meta.appSecret || meta.app_secret || whatsapp.appSecret || '').trim();
      const phoneNumberId = String(
        meta.phoneNumberId || meta.phone_number_id || whatsapp.phoneNumberId || '',
      ).trim();
      if (appSecret && phoneNumberId) {
        return { appSecret, phoneNumberId };
      }
    }
    return { appSecret: '', phoneNumberId: '' };
  } finally {
    await prisma.$disconnect();
  }
}

async function checkHealth() {
  const res = await fetch(`${BASE}/api/health`);
  const body = await res.json();
  console.log('Health mail:', body.dependencies?.mail);
  console.log('Health whatsapp_inbound:', body.dependencies?.whatsapp_inbound);
  if (body.dependencies?.mail?.status !== 'ok') {
    throw new Error(`Mail health not ok: ${JSON.stringify(body.dependencies?.mail)}`);
  }
  if (body.dependencies?.whatsapp_inbound?.status === 'blocked') {
    throw new Error(`WhatsApp inbound blocked: ${body.dependencies?.whatsapp_inbound?.reason}`);
  }
}

async function sendResendDirect() {
  if (!RESEND_API_KEY) {
    throw new Error('Set RESEND_API_KEY for direct Resend send test');
  }
  const { Resend } = await import('resend');
  const resend = new Resend(RESEND_API_KEY);
  const { data, error } = await resend.emails.send({
    from: MAIL_FROM,
    to: TEST_EMAIL,
    subject: 'Investo production email verification',
    text: 'Production Resend email verification succeeded.',
    html: '<p><strong>Production Resend email verification succeeded.</strong></p>',
  });
  if (error) throw new Error(error.message);
  console.log(`Direct Resend queued: ${data?.id}`);
}

async function triggerForgotPassword() {
  const res = await fetch(`${BASE}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL }),
  });
  const body = await res.json();
  console.log('Forgot password:', res.status, body.message || body);
  if (!res.ok) throw new Error(`Forgot password failed: ${res.status}`);
}

async function verifySignedWebhook(appSecret, phoneNumberId) {
  if (!appSecret) {
    console.log('Skip signed webhook test: no APP_SECRET provided');
    return;
  }
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: phoneNumberId },
          messages: [],
        },
      }],
    }],
  };
  const body = JSON.stringify(payload);
  const sig = `sha256=${crypto.createHmac('sha256', appSecret).update(body).digest('hex')}`;
  const res = await fetch(`${BASE}/api/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': sig,
      'X-Forwarded-For': '173.252.96.1',
    },
    body,
  });
  console.log(`Signed webhook: ${res.status} ${(await res.text()).slice(0, 80)}`);
  if (res.status !== 200) throw new Error('Signed webhook rejected');
}

async function main() {
  const tenant = await loadTenantWebhookSecrets();
  await checkHealth();
  await sendResendDirect();
  await triggerForgotPassword();
  await verifySignedWebhook(
    process.env.WHATSAPP_APP_SECRET?.trim() || tenant.appSecret,
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || tenant.phoneNumberId,
  );
  console.log('SUCCESS: production mail + webhook checks passed');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
