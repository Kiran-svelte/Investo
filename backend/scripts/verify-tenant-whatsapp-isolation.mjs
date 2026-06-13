#!/usr/bin/env node
/**
 * Production proof: WhatsApp only works per-tenant Meta creds in DB; platform shell excluded.
 *
 * Usage:
 *   node scripts/verify-tenant-whatsapp-isolation.mjs
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.API_BASE_URL || 'https://investo-backend-production.up.railway.app';
const varsPath = path.join(__dirname, '..', '..', 'scripts', '.railway-prod-vars.json');
const vars = JSON.parse(fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, ''));

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

const PLATFORM_SLUG = 'investo-platform';

function tenantMetaFromSettings(settings) {
  const root = settings && typeof settings === 'object' ? settings : {};
  const whatsapp = root.whatsapp && typeof root.whatsapp === 'object' ? root.whatsapp : {};
  const meta = whatsapp.meta && typeof whatsapp.meta === 'object' ? whatsapp.meta : whatsapp;
  return {
    phoneNumberId: String(meta.phoneNumberId || meta.phone_number_id || whatsapp.phoneNumberId || '').trim(),
    accessToken: String(meta.accessToken || whatsapp.accessToken || '').trim(),
    appSecret: String(meta.appSecret || meta.app_secret || whatsapp.appSecret || '').trim(),
    verifyToken: String(meta.verifyToken || whatsapp.verifyToken || '').trim(),
  };
}

async function checkDatabaseIsolation() {
  const companies = await prisma.company.findMany({
    where: { status: 'active' },
    select: { id: true, name: true, slug: true, settings: true },
  });

  const platform = companies.find((c) => c.slug === PLATFORM_SLUG);
  if (!platform) throw new Error('Platform company missing');

  const platformMeta = tenantMetaFromSettings(platform.settings);
  if (platformMeta.phoneNumberId || platformMeta.accessToken || platformMeta.appSecret) {
    throw new Error(`Platform company must not store Meta creds: ${JSON.stringify(platformMeta)}`);
  }

  const tenants = companies.filter((c) => c.slug !== PLATFORM_SLUG);
  const configuredTenants = tenants
    .map((tenant) => ({ tenant, meta: tenantMetaFromSettings(tenant.settings) }))
    .filter(({ meta }) => meta.phoneNumberId && meta.accessToken);

  const phoneIds = configuredTenants.map(({ meta }) => meta.phoneNumberId);
  const uniquePhoneIds = new Set(phoneIds);
  if (phoneIds.length !== uniquePhoneIds.size) {
    throw new Error('Duplicate phoneNumberId across tenants — isolation broken');
  }

  return {
    tenantCount: tenants.length,
    configuredTenantCount: configuredTenants.length,
    configuredTenants: configuredTenants.map(({ tenant, meta }) => ({
      id: tenant.id,
      name: tenant.name,
      phoneNumberId: meta.phoneNumberId,
      hasAppSecret: Boolean(meta.appSecret),
    })),
  };
}

async function checkHealthEndpoint() {
  const res = await fetch(`${BASE}/api/health`);
  const body = await res.json();
  const inbound = body.dependencies?.whatsapp_inbound;
  if (!inbound) throw new Error('Health missing whatsapp_inbound');

  const dbState = await checkDatabaseIsolation();
  if (dbState.configuredTenantCount === 0) {
    if (inbound.status !== 'warn') {
      throw new Error(`Expected whatsapp_inbound warn with zero tenants, got ${JSON.stringify(inbound)}`);
    }
  } else if (inbound.status === 'blocked') {
    throw new Error(`WhatsApp inbound blocked: ${inbound.reason}`);
  }

  return { inbound, dbState };
}

function signPayload(body, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function postWebhook(payload, secret) {
  const body = JSON.stringify(payload);
  const res = await fetch(`${BASE}/api/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signPayload(body, secret),
      'X-Forwarded-For': '173.252.96.1',
    },
    body,
  });
  return { status: res.status, text: await res.text() };
}

async function checkWebhookWithoutTenant() {
  const legacySecret = String(vars.WHATSAPP_APP_SECRET || '').trim();
  const legacyPhoneId = String(vars.WHATSAPP_PHONE_NUMBER_ID || '').trim();

  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'entry-test',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: legacyPhoneId || 'unmapped-phone-id' },
          contacts: [{ profile: { name: 'Isolation Test' } }],
          messages: [{
            id: `wamid.isolation.${Date.now()}`,
            from: '919999999999',
            type: 'text',
            text: { body: 'ghi toit isolation test' },
          }],
        },
      }],
    }],
  };

  if (legacySecret) {
    const legacy = await postWebhook(payload, legacySecret);
    if (legacy.status === 200) {
      throw new Error('Legacy Railway app secret still accepts buyer webhooks without tenant DB creds');
    }
  }

  const dbState = await checkDatabaseIsolation();
  for (const tenant of dbState.configuredTenants) {
    const tenantRow = await prisma.company.findUnique({
      where: { id: tenant.id },
      select: { settings: true },
    });
    const meta = tenantMetaFromSettings(tenantRow?.settings);
    if (!meta.appSecret) continue;

    const tenantPayload = {
      ...payload,
      entry: [{
        ...payload.entry[0],
        changes: [{
          ...payload.entry[0].changes[0],
          value: {
            ...payload.entry[0].changes[0].value,
            metadata: { phone_number_id: tenant.phoneNumberId },
            messages: [{
              ...payload.entry[0].changes[0].value.messages[0],
              id: `wamid.tenant.${tenant.id}.${Date.now()}`,
            }],
          },
        }],
      }],
    };

    const accepted = await postWebhook(tenantPayload, meta.appSecret);
    if (accepted.status !== 200) {
      throw new Error(`Tenant webhook rejected for ${tenant.name}: ${accepted.status} ${accepted.text}`);
    }

    await new Promise((r) => setTimeout(r, 2500));

    const lead = await prisma.lead.findFirst({
      where: { companyId: tenant.id, phone: { contains: '9999999999' } },
      orderBy: { createdAt: 'desc' },
    });
    if (!lead) {
      throw new Error(`Tenant ${tenant.name} accepted webhook but did not create scoped lead`);
    }

    const otherTenantLead = await prisma.lead.findFirst({
      where: {
        phone: { contains: '9999999999' },
        companyId: { not: tenant.id },
      },
    });
    if (otherTenantLead) {
      throw new Error('Lead leaked across tenants — isolation broken');
    }

    await prisma.message.deleteMany({ where: { conversation: { leadId: lead.id } } }).catch(() => {});
    await prisma.conversation.deleteMany({ where: { leadId: lead.id } }).catch(() => {});
    await prisma.lead.delete({ where: { id: lead.id } }).catch(() => {});
  }

  return {
    legacySecretStillWorks: false,
    legacyWebhookStatus: legacySecret ? 'rejected' : 'skipped',
    tenantWebhookTests: dbState.configuredTenants.length,
  };
}

async function main() {
  const health = await checkHealthEndpoint();
  const webhook = await checkWebhookWithoutTenant();

  console.log(JSON.stringify({
    ok: true,
    base: BASE,
    health: health.inbound,
    tenants: health.dbState,
    webhook,
    message: health.dbState.configuredTenantCount === 0
      ? 'No tenant Meta creds — WhatsApp buyer AI correctly idle until a company configures AI Settings'
      : 'Tenant Meta creds present — per-tenant webhook routing verified',
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message || String(err) }, null, 2));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
