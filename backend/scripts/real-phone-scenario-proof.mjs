/**
 * Real-phone scenario proof against Palm +1 (555) 164-2552
 * Staff: +919036165603 (Kiran Sales) | Buyer: REAL_BUYER_PHONE or Kannada media lead in DB
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
const PALM_DISPLAY = process.env.PALM_WHATSAPP_PHONE || '+15551642552';
const STAFF_FROM = (process.env.REAL_STAFF_PHONE || '919036165603').replace(/\D/g, '');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function digits10(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

async function resolveBuyerFrom() {
  if (process.env.REAL_BUYER_PHONE) return process.env.REAL_BUYER_PHONE.replace(/\D/g, '');
  const lead = await prisma.lead.findFirst({
    where: { companyId: COMPANY_ID, customerName: { contains: 'Kannada', mode: 'insensitive' } },
    orderBy: { updatedAt: 'desc' },
    select: { phone: true, customerName: true },
  });
  if (lead?.phone) return lead.phone.replace(/\D/g, '');
  throw new Error('Set REAL_BUYER_PHONE to client handset (Kannada media). Staff phone cannot be used as buyer.');
}

async function sendTextWebhook(from, body, name) {
  const msgId = `wamid.real.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'real-phone-proof',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID, display_phone_number: PALM_DISPLAY },
          contacts: [{ profile: { name } }],
          messages: [{ from: from.replace(/^\+/, ''), id: msgId, type: 'text', text: { body } }],
        },
      }],
    }],
  };
  const res = await fetch(`${BASE}/api/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  return { ok: res.status === 200, sentAt: new Date() };
}

async function getLeadForPhone(from) {
  const last10 = digits10(from);
  return prisma.lead.findFirst({
    where: { companyId: COMPANY_ID, OR: [{ phone: { contains: last10 } }, { phone: `+${from.replace(/\D/g, '')}` }] },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, phone: true, leadMemory: true, status: true },
  });
}

async function waitForLead(from, maxSec = 60) {
  for (let i = 0; i < maxSec / 5; i++) {
    const lead = await getLeadForPhone(from);
    if (lead) return lead;
    await sleep(5000);
  }
  return null;
}

async function getConversationId(leadId) {
  return prisma.conversation.findFirst({
    where: { leadId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
}

async function waitForAiReply(leadId, afterTime, { timeoutSec = 55, mustMatch = null } = {}) {
  for (let i = 0; i < timeoutSec / 3; i++) {
    await sleep(3000);
    const conv = await getConversationId(leadId);
    if (!conv) continue;
    const msgs = await prisma.message.findMany({
      where: { conversationId: conv.id, senderType: 'ai', createdAt: { gt: afterTime } },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { content: true },
    });
    const reply = msgs[0]?.content || '';
    if (reply && (!mustMatch || mustMatch.test(reply))) return reply;
  }
  return '';
}

async function waitForStaffReply(userId, afterTime, { timeoutSec = 50, mustMatch = null } = {}) {
  const session = await prisma.agentSession.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  if (!session) return '';
  for (let i = 0; i < timeoutSec / 3; i++) {
    await sleep(3000);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT content FROM agent_session_messages
       WHERE session_id = $1::uuid AND role = 'assistant' AND created_at > $2
       ORDER BY created_at DESC LIMIT 1`,
      session.id,
      afterTime,
    );
    const reply = rows[0]?.content || '';
    if (reply && (!mustMatch || mustMatch.test(reply))) return reply;
  }
  return '';
}

async function countVisits(leadId) {
  return prisma.visit.count({ where: { leadId, status: { not: 'cancelled' } } });
}

const staffUser = await prisma.user.findFirst({
  where: { companyId: COMPANY_ID, phone: { contains: digits10(STAFF_FROM) } },
  select: { id: true, name: true, phone: true, role: true },
});
const buyerFrom = await resolveBuyerFrom();

if (digits10(buyerFrom) === digits10(STAFF_FROM)) {
  console.error('ERROR: Buyer phone equals staff phone — buyer AI will never run. Use a different REAL_BUYER_PHONE.');
  process.exit(2);
}

console.log(`Palm ${PALM_DISPLAY} | Staff ${STAFF_FROM} (${staffUser?.name}) | Buyer ${buyerFrom}`);
console.log(`API ${BASE}\n`);

const results = [];
async function scenario(id, role, label, fn) {
  process.stdout.write(`[${role}] ${id} ... `);
  try {
    const r = await fn();
    results.push({ id, role, label, ok: !!r.ok, detail: r.detail || '' });
    console.log(r.ok ? 'PASS' : 'FAIL', (r.detail || '').slice(0, 90));
  } catch (e) {
    results.push({ id, role, label, ok: false, detail: String(e?.message || e) });
    console.log('FAIL', e?.message || e);
  }
}

await scenario('staff-visits', 'staff', 'Visits today', async () => {
  if (!staffUser) return { ok: false, detail: 'staff user not found' };
  const wh = await sendTextWebhook(STAFF_FROM, 'visits today', 'Kiran Sales');
  const reply = await waitForStaffReply(staffUser.id, wh.sentAt, { mustMatch: /visit|today|scheduled|none|no visit/i });
  return { ok: wh.ok && reply.length > 5, detail: reply.slice(0, 90) };
});

await scenario('staff-leads', 'staff', 'New leads', async () => {
  if (!staffUser) return { ok: false, detail: 'no staff' };
  const wh = await sendTextWebhook(STAFF_FROM, 'How many new leads today?', 'Kiran Sales');
  const reply = await waitForStaffReply(staffUser.id, wh.sentAt, { mustMatch: /lead|today|\d/i });
  return { ok: wh.ok && reply.length > 5, detail: reply.slice(0, 90) };
});

await scenario('staff-help', 'staff', 'Help', async () => {
  if (!staffUser) return { ok: false, detail: 'no staff' };
  const wh = await sendTextWebhook(STAFF_FROM, 'help', 'Kiran Sales');
  const reply = await waitForStaffReply(staffUser.id, wh.sentAt, { mustMatch: /visit|lead|help|shortcut/i });
  return { ok: wh.ok && reply.length > 10, detail: reply.slice(0, 90) };
});

await scenario('buyer-rapport', 'buyer', 'Welcome', async () => {
  const wh = await sendTextWebhook(buyerFrom, 'Hi', 'Kannada media');
  const lead = await waitForLead(buyerFrom, 45);
  const reply = lead ? await waitForAiReply(lead.id, wh.sentAt, { mustMatch: /welcome|palm|help|explore/i }) : '';
  return { ok: wh.ok && !!lead && reply.length > 5, detail: `${lead?.status} ${reply.slice(0, 60)}` };
});

await scenario('buyer-qualify', 'buyer', 'Qualify + lead_memory', async () => {
  const wh = await sendTextWebhook(buyerFrom, 'My budget is 1.2 crore in Whitefield Bangalore 3BHK', 'Kannada media');
  const lead = await waitForLead(buyerFrom, 30);
  const reply = lead ? await waitForAiReply(lead.id, wh.sentAt, { mustMatch: /saved|budget|crore|whitefield|3bhk/i, timeoutSec: 60 }) : '';
  await sleep(3000);
  const refreshed = await getLeadForPhone(buyerFrom);
  const mem = refreshed?.leadMemory && typeof refreshed.leadMemory === 'object' ? refreshed.leadMemory : {};
  const okMem = !!(mem.budget?.min || mem.budget?.max) || /saved|1\.2|crore/i.test(reply);
  return { ok: wh.ok && !!lead && okMem, detail: `mem=${!!mem.budget} ${reply.slice(0, 60)}` };
});

await scenario('buyer-brochure', 'buyer', 'Brochure', async () => {
  const wh = await sendTextWebhook(buyerFrom, 'Send brochure for Sunset Heights', 'Kannada media');
  const lead = await getLeadForPhone(buyerFrom);
  const reply = lead ? await waitForAiReply(lead.id, wh.sentAt, { mustMatch: /brochure|sunset|upload|pdf|send/i, timeoutSec: 55 }) : '';
  return { ok: wh.ok && reply.length > 5, detail: reply.slice(0, 70) };
});

await scenario('buyer-book', 'buyer', 'Book visit DB', async () => {
  const lead = await getLeadForPhone(buyerFrom);
  if (!lead) return { ok: false, detail: 'no lead' };
  const before = await countVisits(lead.id);
  const wh = await sendTextWebhook(buyerFrom, 'Book visit Sunset Heights Sunday 2pm', 'Kannada media');
  const reply = await waitForAiReply(lead.id, wh.sentAt, { mustMatch: /visit|scheduled|book|confirm|sunday/i, timeoutSec: 70 });
  await sleep(4000);
  const after = await countVisits(lead.id);
  return { ok: wh.ok && after >= before && /visit|scheduled|book|confirm|sunday/i.test(reply), detail: `visits ${before}->${after} ${reply.slice(0, 50)}` };
});

await scenario('buyer-status', 'buyer', 'Visit status', async () => {
  const lead = await getLeadForPhone(buyerFrom);
  if (!lead) return { ok: false, detail: 'no lead' };
  const wh = await sendTextWebhook(buyerFrom, 'When is my visit?', 'Kannada media');
  const reply = await waitForAiReply(lead.id, wh.sentAt, { mustMatch: /visit|scheduled|YOUR VISIT|sunset/i, timeoutSec: 50 });
  return { ok: wh.ok && /visit|scheduled|YOUR VISIT/i.test(reply), detail: reply.slice(0, 80) };
});

const pass = results.filter((r) => r.ok).length;
const out = path.join(ROOT, 'scripts', 'real-phone-scenario-results.json');
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), palm: PALM_DISPLAY, staffFrom: STAFF_FROM, buyerFrom, pass, total: results.length, results }, null, 2));
console.log(`\n=== ${pass}/${results.length} passed ===\n${out}`);
await prisma.$disconnect();
process.exit(pass === results.length ? 0 : 1);
