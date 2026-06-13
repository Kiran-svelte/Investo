#!/usr/bin/env node
/**
 * Wipe all tenant CRM data and recreate a single super admin.
 * Usage:
 *   node scripts/production-fresh-reset.mjs --confirm
 *   node scripts/production-fresh-reset.mjs --confirm --prod
 *   SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... node scripts/production-fresh-reset.mjs --confirm
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import { neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { Redis } from '@upstash/redis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

if (process.argv.includes('--prod')) {
  const varsPath = path.join(ROOT, 'scripts', '.railway-prod-vars.json');
  const vars = JSON.parse(fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, ''));
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === 'string' && !process.env[key]) process.env[key] = value;
  }
} else {
  dotenv.config({ path: path.join(__dirname, '..', '.env') });
}

neonConfig.webSocketConstructor = ws;

const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'big.investo.sol@gmail.com').trim().toLowerCase();
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'Investo@123';
const SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME || 'Investo Super Admin';

const confirm = process.argv.includes('--confirm');
const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL or DIRECT_URL required');
  process.exit(1);
}

if (!confirm) {
  console.error('Refusing to run without --confirm');
  process.exit(1);
}

function createPrismaClient(connectionString) {
  const isNeon = /neon\.tech/i.test(connectionString);
  const adapter = isNeon
    ? new PrismaNeon({ connectionString })
    : new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const dbHost = (() => {
  try {
    return new URL(databaseUrl.replace(/^postgresql:/, 'postgres:')).hostname;
  } catch {
    return 'unknown';
  }
})();

console.log(`Target database: ${dbHost}`);

const prisma = createPrismaClient(databaseUrl);

async function wipeKnowledgeChunks() {
  try {
    await prisma.$executeRawUnsafe('DELETE FROM property_knowledge_chunks');
  } catch {
    // Table may not exist on older DBs
  }
}

async function safeDelete(label, fn) {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('does not exist') || err?.code === 'P2021') {
      console.warn(`Skip ${label} (table missing)`);
      return;
    }
    throw err;
  }
}

async function flushRedisCache() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn('Skip Redis flush (UPSTASH_REDIS_REST_URL/TOKEN not set)');
    return;
  }
  try {
    const redis = new Redis({ url, token });
    await redis.flushdb();
    console.log('Redis cache flushed');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Redis flush failed: ${message}`);
  }
}

async function wipeAllBusinessData() {
  await wipeKnowledgeChunks();

  const steps = [
    ['messages', () => prisma.message.deleteMany()],
    ['inbound_whatsapp_dedup', () => prisma.inboundWhatsappDedup.deleteMany()],
    ['agent_action_logs', () => prisma.agentActionLog.deleteMany()],
    ['workflow_run_records', () => prisma.workflowRunRecord.deleteMany()],
    ['workflow_idempotency_keys', () => prisma.workflowIdempotencyKey.deleteMany()],
    ['booking_approval_requests', () => prisma.bookingApprovalRequest.deleteMany()],
    ['pending_actions', () => prisma.pendingAction.deleteMany()],
    ['agent_sessions', () => prisma.agentSession.deleteMany()],
    ['property_import_media_blobs', () => prisma.propertyImportMediaBlob.deleteMany()],
    ['property_import_jobs', () => prisma.propertyImportJob.deleteMany()],
    ['property_import_media', () => prisma.propertyImportMedia.deleteMany()],
    ['property_import_units', () => prisma.propertyImportUnit.deleteMany()],
    ['property_import_drafts', () => prisma.propertyImportDraft.deleteMany()],
    ['property_project_files', () => prisma.propertyProjectFile.deleteMany()],
    ['notifications', () => prisma.notification.deleteMany()],
    ['visits', () => prisma.visit.deleteMany()],
    ['conversations', () => prisma.conversation.deleteMany()],
    ['leads', () => prisma.lead.deleteMany()],
    ['properties', () => prisma.property.deleteMany()],
    ['property_projects', () => prisma.propertyProject.deleteMany()],
    ['analytics', () => prisma.analytics.deleteMany()],
    ['audit_logs', () => prisma.auditLog.deleteMany()],
    ['invoices', () => prisma.invoice.deleteMany()],
    ['company_features', () => prisma.companyFeature.deleteMany()],
    ['company_onboarding', () => prisma.companyOnboarding.deleteMany()],
    ['company_roles', () => prisma.companyRole.deleteMany()],
    ['ai_settings', () => prisma.aiSetting.deleteMany()],
    ['password_reset_tokens', () => prisma.passwordResetToken.deleteMany()],
    ['refresh_tokens', () => prisma.refreshToken.deleteMany()],
    ['users', () => prisma.user.deleteMany()],
    ['companies', () => prisma.company.deleteMany()],
  ];

  for (const [label, fn] of steps) {
    await safeDelete(label, fn);
  }
}

async function ensurePlans() {
  const plans = [
    { name: 'Starter', maxAgents: 3, maxLeads: 500, maxProperties: 50, priceMonthly: 4999, priceYearly: 49990, features: ['whatsapp_ai', 'basic_crm', 'calendar'] },
    { name: 'Growth', maxAgents: 10, maxLeads: 2000, maxProperties: 200, priceMonthly: 14999, priceYearly: 149990, features: ['whatsapp_ai', 'advanced_crm', 'calendar', 'analytics', 'automation'] },
    { name: 'Enterprise', maxAgents: 999, maxLeads: null, maxProperties: null, priceMonthly: 49999, priceYearly: 499990, features: ['whatsapp_ai', 'advanced_crm', 'calendar', 'analytics', 'automation', 'api_access', 'priority_support'] },
  ];

  let enterpriseId = null;
  for (const plan of plans) {
    const existing = await prisma.subscriptionPlan.findFirst({ where: { name: plan.name }, select: { id: true } });
    const row = existing
      ? await prisma.subscriptionPlan.update({ where: { id: existing.id }, data: { ...plan, status: 'active' } })
      : await prisma.subscriptionPlan.create({ data: { ...plan, status: 'active' } });
    if (plan.name === 'Enterprise') enterpriseId = row.id;
  }
  return enterpriseId;
}

async function createSuperAdmin(enterprisePlanId) {
  const platformCompany = await prisma.company.create({
    data: {
      name: 'Investo Platform',
      slug: 'investo-platform',
      status: 'active',
      planId: enterprisePlanId,
      settings: {},
    },
  });

  const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);
  await prisma.user.create({
    data: {
      companyId: platformCompany.id,
      name: SUPER_ADMIN_NAME,
      email: SUPER_ADMIN_EMAIL,
      passwordHash,
      role: 'super_admin',
      status: 'active',
    },
  });

  return platformCompany.id;
}

async function main() {
  console.log('Wiping all companies, users, leads, properties, conversations…');
  await wipeAllBusinessData();
  await flushRedisCache();

  const enterprisePlanId = await ensurePlans();
  await createSuperAdmin(enterprisePlanId);

  const counts = {
    companies: await prisma.company.count(),
    users: await prisma.user.count(),
    leads: await prisma.lead.count(),
    properties: await prisma.property.count(),
    conversations: await prisma.conversation.count(),
  };

  console.log('Fresh platform ready:', counts);
  console.log(`Super admin: ${SUPER_ADMIN_EMAIL}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
