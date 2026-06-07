/**
 * Physical handset scenario runner — sends via ADB (tap Send), verifies prod DB.
 * Asserts exactly one AI outbound row per inbound (enterprise single-reply contract).
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const vars = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
let prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const COMPANY = 'a9c308d8-1083-4981-bd46-3667e0474e8e';
const BUYER_LAST10 = '6363062930';
const STAFF_LAST10 = '9036165603';
const WAIT_MS = Number(process.env.HANDSET_WAIT_MS || 45000);
const BUYER_GAP_MS = Number(process.env.HANDSET_BUYER_GAP_MS || 8000);

process.env.ADB_PATH = process.env.ADB_PATH || String.raw`C:\Users\kiran\Downloads\platform-tools-latest-windows (1)\platform-tools\adb.exe`;
process.env.ANDROID_SERIAL = process.env.ANDROID_SERIAL || 'RZGL31RFPAV';

function sleep(ms) {
  execSync(`powershell -Command "Start-Sleep -Milliseconds ${ms}"`, { stdio: 'ignore' });
}

async function withPrisma(fn) {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/connection terminated|Connection terminated|ECONNRESET|Client has encountered/i.test(msg)) {
      throw err;
    }
    await prisma.$disconnect().catch(() => undefined);
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
    return fn();
  }
}

function send(pkg, msg) {
  try {
    const r = execSync(`node scripts/wa-adb-send.mjs ${pkg} "${msg.replace(/"/g, '')}"`, {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env },
    });
    const j = JSON.parse(r.match(/\{[\s\S]*\}/)?.[0] || '{}');
    return j.sent === true;
  } catch {
    return false;
  }
}

async function staffMsgsSince(since) {
  return withPrisma(async () => {
    const staff = await prisma.user.findFirst({ where: { phone: { contains: STAFF_LAST10 } }, select: { id: true } });
    const session = staff ? await prisma.agentSession.findFirst({ where: { userId: staff.id }, orderBy: { updatedAt: 'desc' } }) : null;
    if (!session) return [];
    return prisma.$queryRawUnsafe(
      `SELECT role, content, created_at AS at FROM agent_session_messages WHERE session_id = $1::uuid AND created_at > $2 ORDER BY created_at DESC LIMIT 6`,
      session.id,
      since,
    );
  });
}

const BANNED_GREETING = /dream property|how can i help you find your dream/i;

async function buyerAiSinceCustomer(since, customerText) {
  return withPrisma(async () => {
    const lead = await prisma.lead.findFirst({
      where: { companyId: COMPANY, phone: { contains: BUYER_LAST10 } },
      select: { id: true, leadMemory: true, status: true },
    });
    const conv = lead ? await prisma.conversation.findFirst({ where: { leadId: lead.id }, orderBy: { updatedAt: 'desc' } }) : null;
    const visits = lead ? await prisma.visit.count({ where: { leadId: lead.id, status: { not: 'cancelled' } } }) : 0;
    if (!lead || !conv) {
      return { lead, conv, visits, aiMsgs: [], aiCount: 0, reply: '', bannedGreeting: false };
    }

    const trimmed = customerText.trim();
    const customerAnchor = await prisma.message.findFirst({
      where: {
        conversationId: conv.id,
        senderType: 'customer',
        createdAt: { gt: since },
        ...(trimmed ? { content: trimmed } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const anchor = customerAnchor?.createdAt ?? since;

    const aiMsgs = await prisma.message.findMany({
      where: { conversationId: conv.id, senderType: 'ai', createdAt: { gt: anchor } },
      orderBy: { createdAt: 'asc' },
      select: { content: true, createdAt: true },
    });

    const bannedGreeting = aiMsgs.some((m) => BANNED_GREETING.test(m.content));
    return {
      lead,
      conv,
      visits,
      aiMsgs,
      aiCount: aiMsgs.length,
      reply: aiMsgs[0]?.content || '',
      bannedGreeting,
    };
  });
}

const results = [];

async function run(id, role, pkg, msg, verify) {
  const since = new Date();
  process.stdout.write(`[${role}] ${id} send "${msg}" ... `);
  const okSend = send(pkg, msg);
  if (!okSend) {
    results.push({ id, role, ok: false, detail: 'adb send failed', singleReply: false });
    console.log('FAIL send');
    return;
  }
  sleep(WAIT_MS);
  const detail = await verify(since, msg);
  const ok = !!detail.ok;
  results.push({
    id,
    role,
    ok,
    singleReply: detail.singleReply !== false,
    aiCount: detail.aiCount ?? null,
    detail: detail.note || '',
  });
  console.log(ok ? 'PASS' : 'FAIL', detail.note || '', detail.aiCount != null ? `(ai=${detail.aiCount})` : '');
  sleep(role === 'buyer' ? BUYER_GAP_MS : 4000);
}

// Ensure buyer on AI
await withPrisma(async () => {
  const lead = await prisma.lead.findFirst({ where: { companyId: COMPANY, phone: { contains: BUYER_LAST10 } } });
  const conv = lead ? await prisma.conversation.findFirst({ where: { leadId: lead.id }, orderBy: { updatedAt: 'desc' } }) : null;
  if (conv && (!conv.aiEnabled || conv.status !== 'ai_active')) {
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { aiEnabled: true, status: 'ai_active', stage: 'qualify', escalationReason: null, escalatedAt: null },
    });
  }
});

console.log('\n=== PHYSICAL HANDSET SCENARIOS (Palm +15551642552) ===');
console.log(`Device: ${process.env.ANDROID_SERIAL} Wait: ${WAIT_MS}ms\n`);

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

await run('buyer-hi', 'buyer', 'com.whatsapp.w4b', 'Hi', async (since, sentMsg) => {
  const s = await buyerAiSinceCustomer(since, sentMsg);
  const ok =
    s.conv?.aiEnabled
    && s.aiCount === 1
    && !s.bannedGreeting
    && /welcome|palm|help|explore|back|visit|noticed|experience/i.test(s.reply);
  return {
    ok,
    aiCount: s.aiCount,
    singleReply: s.aiCount === 1,
    note: `${s.conv?.status} ${s.reply.slice(0, 60)}${s.bannedGreeting ? ' [BANNED]' : ''}`,
  };
});

await run('buyer-call-me', 'buyer', 'com.whatsapp.w4b', 'Please call me back tomorrow 6pm', async (since, sentMsg) => {
  const s = await buyerAiSinceCustomer(since, sentMsg);
  const ok = s.aiCount === 1 && /callback|call|scheduled|specialist|noted your request/i.test(s.reply);
  return { ok, aiCount: s.aiCount, singleReply: s.aiCount === 1, note: s.reply.slice(0, 80) };
});

await run('buyer-qualify', 'buyer', 'com.whatsapp.w4b', 'My budget is 1.2 crore Whitefield Bangalore 3BHK', async (since, sentMsg) => {
  const s = await buyerAiSinceCustomer(since, sentMsg);
  const mem = s.lead?.leadMemory && typeof s.lead.leadMemory === 'object' ? s.lead.leadMemory : {};
  const ok = s.aiCount === 1 && (/saved|budget|crore|whitefield|matching/i.test(s.reply) || !!(mem.budget?.min || mem.budget?.max));
  return { ok, aiCount: s.aiCount, singleReply: s.aiCount === 1, note: s.reply.slice(0, 70) };
});

await run('buyer-brochure', 'buyer', 'com.whatsapp.w4b', 'Send brochure for Green Acres', async (since, sentMsg) => {
  const s = await buyerAiSinceCustomer(since, sentMsg);
  const ok = s.aiCount === 1 && /brochure|green|upload|pdf|send|acres/i.test(s.reply);
  return { ok, aiCount: s.aiCount, singleReply: s.aiCount === 1, note: s.reply.slice(0, 70) };
});

await run('buyer-book', 'buyer', 'com.whatsapp.w4b', 'Book visit Green Acres Sunday 2pm', async (since, sentMsg) => {
  const before = (await buyerAiSinceCustomer(new Date(0), sentMsg)).visits;
  sleep(5000);
  const s = await buyerAiSinceCustomer(since, sentMsg);
  const ok = s.aiCount === 1 && (/visit|scheduled|book|confirm|sunday/i.test(s.reply) || s.visits > before);
  return { ok, aiCount: s.aiCount, singleReply: s.aiCount === 1, note: `visits ${before}->${s.visits} ${s.reply.slice(0, 50)}` };
});

await run('buyer-status', 'buyer', 'com.whatsapp.w4b', 'When is my visit?', async (since, sentMsg) => {
  const s = await buyerAiSinceCustomer(since, sentMsg);
  const ok = s.aiCount === 1 && /visit|scheduled|green|acres/i.test(s.reply);
  return { ok, aiCount: s.aiCount, singleReply: s.aiCount === 1, note: s.reply.slice(0, 80) };
});

const pass = results.filter((r) => r.ok).length;
const singleOk = results.filter((r) => r.singleReply !== false).length;
const out = path.join(ROOT, 'scripts', 'physical-handset-results.json');
const report = {
  at: new Date().toISOString(),
  device: process.env.ANDROID_SERIAL,
  pass,
  total: results.length,
  singleReplyPass: singleOk,
  results,
};
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\n=== PHYSICAL ${pass}/${results.length} passed | single-reply ${singleOk}/${results.length} ===`);
console.log(out);
await prisma.$disconnect();
process.exit(pass === results.length ? 0 : 1);
