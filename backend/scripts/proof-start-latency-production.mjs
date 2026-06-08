/**
 * Production proof: /start command responds with low orchestration latency.
 *
 * Usage:
 *   cd backend && npx tsx scripts/proof-start-latency-production.mjs
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const varsPath = path.join(ROOT, 'scripts', '.railway-prod-vars.json');
const vars = JSON.parse(fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, ''));

const BASE = process.env.PROD_API_BASE || 'https://investo-backend-production.up.railway.app';
const E2E_TOKEN = process.env.E2E_WEBHOOK_PROOF_TOKEN || vars.E2E_WEBHOOK_PROOF_TOKEN || 'investo-handset-e2e-v1';
const COMPANY_ID = 'a9c308d8-1083-4981-bd46-3667e0474e8e';
const PHONE_NUMBER_ID = vars.WHATSAPP_PHONE_NUMBER_ID || '1090528010807708';
const MAX_ORCHESTRATION_MS = 8000;
const MAX_TOTAL_MS = 15000;

const { PrismaClient } = await import('@prisma/client');
const { PrismaPg } = await import('@prisma/adapter-pg');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randPhone() {
  return '91900000' + String(6000 + Math.floor(Math.random() * 999));
}

async function sendStartWebhook(from) {
  const msgId = `wamid.start.latency.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'start-latency-proof',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: 'Latency Proof' } }],
          messages: [{ from: from.replace(/^\+/, ''), id: msgId, type: 'text', text: { body: '/start' } }],
        },
      }],
    }],
  };
  const sentAt = Date.now();
  const res = await fetch(`${BASE}/api/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_TOKEN ? { 'X-Investo-E2E-Token': E2E_TOKEN } : {}),
    },
    body: JSON.stringify(payload),
  });
  return { ok: res.status === 200, msgId, sentAt, status: res.status };
}

async function waitForStartReply(phone, sentAt, timeoutSec = 20) {
  const last10 = phone.replace(/\D/g, '').slice(-10);
  for (let i = 0; i < timeoutSec; i++) {
    await sleep(1000);
    const lead = await prisma.lead.findFirst({
      where: { companyId: COMPANY_ID, phone: { contains: last10 } },
      select: { id: true },
    });
    if (!lead) continue;
    const conv = await prisma.conversation.findFirst({
      where: { leadId: lead.id },
      select: { id: true },
    });
    if (!conv) continue;
    const reply = await prisma.message.findFirst({
      where: {
        conversationId: conv.id,
        senderType: 'ai',
        createdAt: { gte: new Date(sentAt - 2000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { content: true, createdAt: true },
    });
    if (reply?.content) {
      return {
        content: reply.content,
        latencyMs: reply.createdAt.getTime() - sentAt,
      };
    }
  }
  return null;
}

const phone = randPhone();
console.log(`Proof /start latency — phone ${phone}`);

const webhook = await sendStartWebhook(phone);
if (!webhook.ok) {
  console.error(JSON.stringify({ ok: false, reason: 'webhook_failed', status: webhook.status }, null, 2));
  process.exit(1);
}

const reply = await waitForStartReply(phone, webhook.sentAt);
await prisma.$disconnect();

const result = {
  ok: Boolean(reply),
  phone,
  webhookStatus: webhook.status,
  msgId: webhook.msgId,
  replyPreview: reply?.content?.slice(0, 120) ?? null,
  latencyMs: reply?.latencyMs ?? null,
  orchestrationWithinBudget: reply ? reply.latencyMs <= MAX_ORCHESTRATION_MS : false,
  totalWithinBudget: reply ? reply.latencyMs <= MAX_TOTAL_MS : false,
  maxOrchestrationMs: MAX_ORCHESTRATION_MS,
  maxTotalMs: MAX_TOTAL_MS,
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok && result.orchestrationWithinBudget ? 0 : 1);
