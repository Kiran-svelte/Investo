/**
 * Physical handset scenario runner — sends via ADB (tap Send), verifies prod DB.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '..');
const vars = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const COMPANY = 'a9c308d8-1083-4981-bd46-3667e0474e8e';

function sleep(ms) {
  execSync(`powershell -Command "Start-Sleep -Milliseconds ${ms}"`, { stdio: 'ignore' });
}

function send(pkg, msg) {
  const r = execSync(`node scripts/wa-adb-send.mjs ${pkg} "${msg.replace(/"/g, '')}"`, {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const j = JSON.parse(r.match(/\{[\s\S]*\}/)?.[0] || '{}');
  return j.sent === true;
}

async function staffMsgsSince(since) {
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
  const conv = lead ? await prisma.conversation.findFirst({ where: { leadId: lead.id }, orderBy: { updatedAt: 'desc' } }) : null;
  const visits = lead ? await prisma.visit.count({ where: { leadId: lead.id, status: { not: 'cancelled' } } }) : 0;
  const msgs = lead
    ? await prisma.message.findMany({
        where: { conversation: { leadId: lead.id }, createdAt: { gte: new Date(Date.now() - 120000) } },
        orderBy: { createdAt: 'desc' },
        take: 2,
        select: { senderType: true, content: true },
      })
    : [];
  return { lead, conv, visits, msgs };
}

const results = [];

async function run(id, role, pkg, msg, verify) {
  const since = new Date();
  process.stdout.write(`[${role}] ${id} send "${msg}" ... `);
  const okSend = send(pkg, msg);
  if (!okSend) {
    results.push({ id, role, ok: false, detail: 'adb send failed' });
    console.log('FAIL send');
    return;
  }
  sleep(40000);
  const detail = await verify(since);
  const ok = !!detail.ok;
  results.push({ id, role, ok, detail: detail.note || '' });
  console.log(ok ? 'PASS' : 'FAIL', detail.note || '');
  sleep(5000);
}

// Ensure buyer on AI
const lead = await prisma.lead.findFirst({ where: { companyId: COMPANY, phone: { contains: '6363062930' } } });
const conv = lead ? await prisma.conversation.findFirst({ where: { leadId: lead.id }, orderBy: { updatedAt: 'desc' } }) : null;
if (conv && (!conv.aiEnabled || conv.status !== 'ai_active')) {
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { aiEnabled: true, status: 'ai_active', stage: 'qualify', escalationReason: null, escalatedAt: null },
  });
}

console.log('\n=== PHYSICAL HANDSET SCENARIOS (Palm +15551642552) ===\n');

await run('staff-visits', 'staff', 'com.whatsapp', 'visits today', async (since) => {
  const msgs = await staffMsgsSince(since);
  const reply = msgs.find((m) => m.role === 'assistant')?.content || '';
  const ok = /visit|today|scheduled|No visits/i.test(reply);
  return { ok, note: reply.slice(0, 80) };
});

await run('staff-leads', 'staff', 'com.whatsapp', 'new leads today', async (since) => {
  const msgs = await staffMsgsSince(since);
  const reply = msgs.find((m) => m.role === 'assistant')?.content || '';
  const ok = /lead|today|No new leads/i.test(reply);
  return { ok, note: reply.slice(0, 80) };
});

await run('staff-help', 'staff', 'com.whatsapp', 'help', async (since) => {
  const msgs = await staffMsgsSince(since);
  const reply = msgs.find((m) => m.role === 'assistant')?.content || '';
  const ok = /Copilot|visit|lead|help/i.test(reply) && reply.length > 40;
  return { ok, note: reply.slice(0, 80) };
});

await run('buyer-hi', 'buyer', 'com.whatsapp.w4b', 'Hi', async () => {
  const s = await buyerState();
  const reply = s.msgs.find((m) => m.senderType === 'ai')?.content || '';
  const ok = s.conv?.aiEnabled && /welcome|palm|help|explore/i.test(reply);
  return { ok, note: `${s.conv?.status} ${reply.slice(0, 60)}` };
});

await run('buyer-qualify', 'buyer', 'com.whatsapp.w4b', 'My budget is 1.2 crore Whitefield Bangalore 3BHK', async () => {
  const s = await buyerState();
  const reply = s.msgs.find((m) => m.senderType === 'ai')?.content || '';
  const mem = s.lead?.leadMemory && typeof s.lead.leadMemory === 'object' ? s.lead.leadMemory : {};
  const ok = /saved|budget|crore|whitefield|matching/i.test(reply) || !!(mem.budget?.min || mem.budget?.max);
  return { ok, note: reply.slice(0, 70) };
});

await run('buyer-brochure', 'buyer', 'com.whatsapp.w4b', 'Send brochure for Sunset Heights', async () => {
  const s = await buyerState();
  const reply = s.msgs.find((m) => m.senderType === 'ai')?.content || '';
  const ok = /brochure|sunset|upload|pdf|send/i.test(reply);
  return { ok, note: reply.slice(0, 70) };
});

await run('buyer-book', 'buyer', 'com.whatsapp.w4b', 'Book visit Sunset Heights Sunday 2pm', async () => {
  const before = (await buyerState()).visits;
  sleep(5000);
  const s = await buyerState();
  const reply = s.msgs.find((m) => m.senderType === 'ai')?.content || '';
  const ok = /visit|scheduled|book|confirm|sunday/i.test(reply) || s.visits > before;
  return { ok, note: `visits ${before}->${s.visits} ${reply.slice(0, 50)}` };
});

await run('buyer-status', 'buyer', 'com.whatsapp.w4b', 'When is my visit?', async () => {
  const s = await buyerState();
  const reply = s.msgs.find((m) => m.senderType === 'ai')?.content || '';
  const ok = /visit|scheduled|YOUR VISIT|sunset/i.test(reply);
  return { ok, note: reply.slice(0, 80) };
});

const pass = results.filter((r) => r.ok).length;
const out = path.join(ROOT, 'scripts', 'physical-handset-results.json');
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
console.log(`\n=== PHYSICAL ${pass}/${results.length} passed ===\n${out}`);
await prisma.$disconnect();
process.exit(pass === results.length ? 0 : 1);
