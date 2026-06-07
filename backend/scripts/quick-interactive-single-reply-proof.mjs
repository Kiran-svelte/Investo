/**
 * Quick prod proof: interactive call-me / book-visit must produce exactly 1 AI DB row per inbound.
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const vars = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const BASE = process.env.PROD_API_BASE || 'https://investo-backend-production.up.railway.app';
const COMPANY_ID = 'a9c308d8-1083-4981-bd46-3667e0474e8e';
const PHONE_NUMBER_ID = '1090528010807708';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendInteractive(from, interactiveId, title) {
  const msgId = `wamid.qp.${interactiveId}.${Date.now()}`;
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'quick-proof',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: 'Proof User' } }],
          messages: [{
            from: from.replace(/^\+/, ''),
            id: msgId,
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: interactiveId, title } },
          }],
        },
      }],
    }],
  };
  const res = await fetch(`${BASE}/api/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { ok: res.status === 200, msgId, sentAt: new Date() };
}

async function ensureLead(from) {
  const last10 = from.replace(/\D/g, '').slice(-10);
  for (let i = 0; i < 20; i++) {
    const lead = await prisma.lead.findFirst({
      where: { companyId: COMPANY_ID, OR: [{ phone: { contains: last10 } }] },
      select: { id: true },
    });
    if (lead) return lead;
    await sleep(2000);
  }
  return null;
}

async function countAiSince(leadId, after) {
  const conv = await prisma.conversation.findFirst({ where: { leadId }, select: { id: true } });
  if (!conv) return { count: 0, replies: [] };
  const replies = await prisma.message.findMany({
    where: { conversationId: conv.id, senderType: 'ai', createdAt: { gt: after } },
    orderBy: { createdAt: 'asc' },
    select: { content: true, createdAt: true },
  });
  return { count: replies.length, replies };
}

async function runCase(name, from, interactiveId, title, mustMatch) {
  await prisma.conversation.updateMany({
    where: { lead: { phone: { contains: from.slice(-10) } } },
    data: { status: 'ai_active', aiEnabled: true },
  }).catch(() => undefined);

  const { ok, sentAt } = await sendInteractive(from, interactiveId, title);
  await sleep(35000);
  const lead = await ensureLead(from);
  if (!lead) return { name, ok: false, detail: 'no lead' };
  const { count, replies } = await countAiSince(lead.id, sentAt);
  const text = replies.map((r) => r.content).join(' | ');
  const contentOk = mustMatch.test(text);
  const single = count === 1;
  return {
    name,
    ok: ok && single && contentOk,
    detail: `http=${ok} aiCount=${count} single=${single} preview=${text.slice(0, 120)}`,
  };
}

const buyer = '9196363062930';
const prop = await prisma.property.findFirst({
  where: { companyId: COMPANY_ID },
  orderBy: { updatedAt: 'desc' },
  select: { id: true, name: true },
});

console.log('=== Quick interactive single-reply proof ===');
console.log(`API: ${BASE}`);
console.log(`Buyer: ${buyer} Property: ${prop?.name || 'none'}\n`);

const cases = [
  await runCase('call-me', buyer, 'call-me', 'Call Me', /callback scheduled|call you|specialist/i),
];
if (prop) {
  cases.push(
    await runCase('book-visit', buyer, `book-visit-${prop.id}`, 'Book Visit', /visit|schedule|when|prefer/i),
  );
}

for (const c of cases) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}: ${c.detail}`);
}

const pass = cases.every((c) => c.ok);
process.exit(pass ? 0 : 1);
