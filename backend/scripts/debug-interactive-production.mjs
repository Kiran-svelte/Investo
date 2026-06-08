/**
 * Trace interactive webhook → DB AI message on production.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const vars = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''),
);

const BASE = 'https://investo-backend-production.up.railway.app';
const E2E_TOKEN = vars.E2E_WEBHOOK_PROOF_TOKEN || 'investo-handset-e2e-v1';
const COMPANY_ID = 'a9c308d8-1083-4981-bd46-3667e0474e8e';
const PHONE_NUMBER_ID = vars.WHATSAPP_PHONE_NUMBER_ID || '1090528010807708';

const { PrismaClient } = await import('@prisma/client');
const { PrismaPg } = await import('@prisma/adapter-pg');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randPhone() {
  return '91900000' + String(8000 + Math.floor(Math.random() * 999));
}

async function postWebhook(payload) {
  const res = await fetch(`${BASE}/api/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Investo-E2E-Token': E2E_TOKEN,
    },
    body: JSON.stringify(payload),
  });
  return { status: res.status, ok: res.status === 200 };
}

async function sendText(from, body) {
  const msgId = `wamid.dbg.t.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  return postWebhook({
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: 'Dbg' } }],
          messages: [{ from: from.replace(/^\+/, ''), id: msgId, type: 'text', text: { body } }],
        },
      }],
    }],
  });
}

async function sendInteractive(from, interactiveId, title) {
  const msgId = `wamid.dbg.i.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const sentAt = new Date();
  const wh = await postWebhook({
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: 'Dbg' } }],
          messages: [{
            from: from.replace(/^\+/, ''),
            id: msgId,
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: interactiveId, title } },
          }],
        },
      }],
    }],
  });
  return { ...wh, msgId, sentAt };
}

const phone = randPhone();
console.log('=== Interactive production trace ===');
console.log('phone', phone);

const hi = await sendText(phone, 'Hi');
console.log('Hi webhook', hi.status);

let leadId = null;
for (let i = 0; i < 40; i++) {
  await sleep(2000);
  const lead = await prisma.lead.findFirst({
    where: { companyId: COMPANY_ID, phone: { contains: phone.slice(-10) } },
    select: { id: true },
  });
  if (!lead) continue;
  leadId = lead.id;
  const conv = await prisma.conversation.findFirst({
    where: { leadId: lead.id },
    select: { id: true, status: true, aiEnabled: true },
  });
  const aiCount = conv
    ? await prisma.message.count({ where: { conversationId: conv.id, senderType: 'ai' } })
    : 0;
  if (aiCount > 0) {
    console.log(`Hi reply at t+${(i + 1) * 2}s conv=${conv?.status} ai=${conv?.aiEnabled}`);
    break;
  }
}

await sleep(5000);
const filter = await sendInteractive(phone, 'filter-2bhk', '2 BHK');
console.log('Filter webhook', filter.status, filter.msgId);

for (let i = 0; i < 45; i++) {
  await sleep(2000);
  if (!leadId) {
    const lead = await prisma.lead.findFirst({
      where: { companyId: COMPANY_ID, phone: { contains: phone.slice(-10) } },
      select: { id: true },
    });
    leadId = lead?.id ?? null;
  }
  if (!leadId) continue;

  const conv = await prisma.conversation.findFirst({
    where: { leadId },
    select: { id: true, status: true, aiEnabled: true, stage: true },
  });
  const custAfter = conv
    ? await prisma.message.findMany({
        where: { conversationId: conv.id, senderType: 'customer', createdAt: { gt: filter.sentAt } },
        orderBy: { createdAt: 'asc' },
        select: { content: true, whatsappMessageId: true },
      })
    : [];
  const aiAfter = conv
    ? await prisma.message.findMany({
        where: { conversationId: conv.id, senderType: 'ai', createdAt: { gt: filter.sentAt } },
        orderBy: { createdAt: 'desc' },
        select: { content: true, status: true },
      })
    : [];
  const logs = await prisma.agentActionLog.findMany({
    where: {
      companyId: COMPANY_ID,
      resourceId: conv?.id ?? leadId,
      createdAt: { gt: filter.sentAt },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { action: true, status: true, inputs: true },
  });
  console.log(
    `t+${(i + 1) * 2}s cust=${custAfter.length} ai=${aiAfter.length}`,
    `conv=${conv?.status}/${conv?.aiEnabled}/${conv?.stage}`,
    aiAfter[0]?.content?.slice(0, 50) || '(no ai)',
    'logs=',
    logs.map((l) => l.action).join(',') || '(none)',
  );
  if (aiAfter.length > 0) break;
}

const call = await sendInteractive(phone, 'call-me', 'Call Me');
console.log('Call-me webhook', call.status);
await sleep(20000);
if (leadId) {
  const conv = await prisma.conversation.findFirst({ where: { leadId }, select: { id: true } });
  const aiCall = conv
    ? await prisma.message.count({
        where: { conversationId: conv.id, senderType: 'ai', createdAt: { gt: call.sentAt } },
      })
    : 0;
  console.log('call-me ai messages after tap:', aiCall);
}

await prisma.$disconnect();
