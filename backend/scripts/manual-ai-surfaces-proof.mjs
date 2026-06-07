/**
 * Manual AI Surfaces proof: phone send (tap Send) + prod DB verification.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const vars = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const COMPANY = 'a9c308d8-1083-4981-bd46-3667e0474e8e';
const STAFF_PKG = 'com.whatsapp';
const BUYER_PKG = 'com.whatsapp.w4b';
const WAIT_SEC = Number(process.env.MANUAL_WAIT_SEC || 42);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

function sleep(sec) {
  execSync(`powershell -Command "Start-Sleep -Seconds ${sec}"`, { stdio: 'ignore' });
}

function sendStaff(msg) {
  const r = execSync(`node "${path.join(ROOT, 'scripts', 'wa-adb-send.mjs')}" ${STAFF_PKG} "${msg.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const m = r.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : { sent: false };
}

/** Buyer uses webhook — same SIM on staff phone routes to copilot, not buyer AI. */
async function sendBuyer(msg, name = 'Kannada media') {
  const msgId = `wamid.manual.buyer.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'manual-surfaces',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: '1090528010807708', display_phone_number: '+15551642552' },
          contacts: [{ profile: { name } }],
          messages: [{ from: '916363062930', id: msgId, type: 'text', text: { body: msg } }],
        },
      }],
    }],
  };
  const res = await fetch('https://investo-backend-production.up.railway.app/api/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { sent: res.status === 200, channel: 'webhook', msgId };
}

async function staffSessionSince(since) {
  const staff = await prisma.user.findFirst({ where: { phone: { contains: '9036165603' } }, select: { id: true } });
  const session = staff ? await prisma.agentSession.findFirst({ where: { userId: staff.id }, orderBy: { updatedAt: 'desc' } }) : null;
  if (!session) return [];
  return prisma.$queryRawUnsafe(
    `SELECT role, content, created_at AS at FROM agent_session_messages WHERE session_id = $1::uuid AND created_at > $2 ORDER BY created_at DESC LIMIT 4`,
    session.id,
    since,
  );
}

async function buyerState() {
  const lead = await prisma.lead.findFirst({
    where: { companyId: COMPANY, phone: { contains: '6363062930' } },
    select: { id: true, leadMemory: true, status: true },
  });
  const conv = lead
    ? await prisma.conversation.findFirst({ where: { leadId: lead.id }, orderBy: { updatedAt: 'desc' }, select: { status: true, aiEnabled: true, stage: true } })
    : null;
  return { lead, conv };
}

async function buyerAiReplySince(since) {
  const lead = await prisma.lead.findFirst({ where: { companyId: COMPANY, phone: { contains: '6363062930' } }, select: { id: true } });
  if (!lead) return null;
  return prisma.message.findFirst({
    where: { conversation: { leadId: lead.id }, senderType: 'ai', createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { content: true },
  });
}

const scenarios = [
  { id: 'staff-visits', role: 'staff', pkg: STAFF_PKG, msg: 'visits today', expect: /visit|today|scheduled|No visits/i },
  { id: 'staff-leads', role: 'staff', pkg: STAFF_PKG, msg: 'new leads today', expect: /lead|today|No new leads/i },
  { id: 'staff-help', role: 'staff', pkg: STAFF_PKG, msg: 'help', expect: /Copilot|visit|lead|help/i },
  { id: 'buyer-hi', role: 'buyer', channel: 'webhook', msg: 'Hi', expect: /welcome|palm|help|explore/i, reject: /Thanks for your message.*Our team/i },
  { id: 'buyer-qualify', role: 'buyer', channel: 'webhook', msg: 'My budget is 1.2 crore Whitefield Bangalore 3BHK', expect: /saved|budget|crore|whitefield|3bhk|matching/i, reject: /Thanks for your message.*Our team/i },
  { id: 'buyer-brochure', role: 'buyer', channel: 'webhook', msg: 'Send brochure for Sunset Heights', expect: /brochure|sunset|upload|pdf|send/i, reject: /Thanks for your message.*Our team/i },
  { id: 'buyer-book', role: 'buyer', channel: 'webhook', msg: 'Book visit Sunset Heights Sunday 2pm', expect: /visit|scheduled|book|confirm|sunday|which property/i, reject: /Thanks for your message.*Our team/i },
  { id: 'buyer-status', role: 'buyer', channel: 'webhook', msg: 'When is my visit?', expect: /visit|scheduled|YOUR VISIT|sunset|date/i, reject: /Thanks for your message.*Our team/i },
];

const results = [];
console.log(`\n=== Manual AI Surfaces proof (${scenarios.length} scenarios) ===\n`);

for (const sc of scenarios) {
  const since = new Date(Date.now() - 2000);
  process.stdout.write(`[${sc.role}] ${sc.id} ... `);
  const sendResult = sc.role === 'staff' ? sendStaff(sc.msg) : await sendBuyer(sc.msg);
  if (!sendResult.sent) {
    results.push({ id: sc.id, ok: false, reason: 'phone_send_failed' });
    console.log('FAIL send');
    continue;
  }
  sleep(WAIT_SEC);

  let ok = false;
  let detail = '';
  if (sc.role === 'staff') {
    const msgs = await staffSessionSince(since);
    const assistant = msgs.find((m) => m.role === 'assistant');
    detail = assistant?.content?.slice(0, 120) || '(no DB reply)';
    ok = !!assistant && sc.expect.test(assistant.content);
  } else {
    const reply = await buyerAiReplySince(since);
    const state = await buyerState();
    detail = reply?.content?.slice(0, 120) || '(no DB reply)';
    const handoff = sc.reject && reply && sc.reject.test(reply.content);
    ok = !!reply && sc.expect.test(reply.content) && !handoff && state.conv?.aiEnabled === true;
    if (handoff) detail = 'BLOCKED: human takeover';
  }
  results.push({ id: sc.id, role: sc.role, msg: sc.msg, ok, detail });
  console.log(ok ? 'PASS' : 'FAIL', detail.slice(0, 70));
  sleep(10);
}

const pass = results.filter((r) => r.ok).length;
const out = path.join(ROOT, 'scripts', 'manual-ai-surfaces-results.json');
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
console.log(`\n=== ${pass}/${results.length} passed ===\n`);
await prisma.$disconnect();
process.exit(pass === results.length ? 0 : 1);
