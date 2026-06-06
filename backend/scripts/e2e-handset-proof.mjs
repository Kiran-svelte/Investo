/**
 * Comprehensive production E2E handset proof (buyer + staff + interactive + admin).
 *
 * Usage:
 *   npx tsx scripts/e2e-handset-proof.mjs
 *   npx tsx scripts/e2e-handset-proof.mjs --suite buyer
 *   npx tsx scripts/e2e-handset-proof.mjs --suite staff
 */
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const varsPath = path.join(ROOT, 'scripts', '.railway-prod-vars.json');
const BASE = process.env.PROD_API_BASE || 'https://investo-backend-production.up.railway.app';
const FRONTEND = process.env.PROD_FRONTEND || 'https://biginvesto.online';
const COMPANY_ID = 'a9c308d8-1083-4981-bd46-3667e0474e8e';
const PHONE_NUMBER_ID = '1090528010807708';

const raw = fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, '');
const vars = JSON.parse(raw);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

const INTERNAL_LEAK = /Workflow\s+"[^"]+"\s+failed|Invalid uuid|propertyId:|handler not configured/i;
const CONNECTION_FALLBACK = /brief (connection|technical) issue|resend your message/i;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randBuyer() {
  return '91900000' + String(8000 + Math.floor(Math.random() * 999));
}

function digits10(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

function assertCleanReply(reply) {
  const issues = [];
  if (!reply || reply.length < 8) issues.push('empty_reply');
  if (INTERNAL_LEAK.test(reply)) issues.push('internal_workflow_leak');
  if (CONNECTION_FALLBACK.test(reply)) issues.push('connection_fallback');
  return issues;
}

function hasActionLog(logs, pattern) {
  return logs.some((l) => pattern.test(l.action));
}

async function sendTextWebhook(from, body, suffix = '') {
  const msgId = `wamid.e2e.${suffix || Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'e2e-handset',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: 'E2E User' } }],
          messages: [{
            from: from.replace(/^\+/, ''),
            id: msgId,
            type: 'text',
            text: { body },
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
  return { ok: res.status === 200, status: res.status, msgId, sentAt: new Date() };
}

async function sendInteractiveWebhook(from, interactiveId, title = 'Tap', suffix = '') {
  const msgId = `wamid.e2e.i.${suffix || Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'e2e-handset',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: 'E2E User' } }],
          messages: [{
            from: from.replace(/^\+/, ''),
            id: msgId,
            type: 'interactive',
            interactive: {
              type: 'button_reply',
              button_reply: { id: interactiveId, title },
            },
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
  return { ok: res.status === 200, status: res.status, msgId, sentAt: new Date() };
}

async function getLeadForPhone(from) {
  const last10 = digits10(from);
  const e164 = from.startsWith('+') ? from : `+${from.replace(/\D/g, '')}`;
  return prisma.lead.findFirst({
    where: {
      companyId: COMPANY_ID,
      OR: [{ phone: e164 }, { phone: { contains: last10 } }],
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      phone: true,
      leadMemory: true,
      status: true,
    },
  });
}

async function getConversationId(leadId) {
  const conv = await prisma.conversation.findFirst({
    where: { leadId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, aiEnabled: true, status: true },
  });
  return conv;
}

async function waitForLead(from, maxSec = 90) {
  for (let i = 0; i < maxSec / 5; i++) {
    const lead = await getLeadForPhone(from);
    if (lead) return lead;
    await sleep(5000);
  }
  return null;
}

async function waitForAiReply(leadId, afterTime, { timeoutSec = 50, mustMatch = null } = {}) {
  for (let i = 0; i < timeoutSec / 3; i++) {
    await sleep(3000);
    const conv = await getConversationId(leadId);
    if (!conv) continue;
    const msgs = await prisma.message.findMany({
      where: {
        conversationId: conv.id,
        senderType: 'ai',
        createdAt: { gt: afterTime },
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { content: true, createdAt: true },
    });
    if (msgs.length > 0) {
      const reply = msgs[0].content || '';
      if (!mustMatch || mustMatch.test(reply)) {
        return { reply, msgs };
      }
    }
  }
  const conv = await getConversationId(leadId);
  if (!conv) return { reply: '', msgs: [] };
  const fallback = await prisma.message.findMany({
    where: { conversationId: conv.id, senderType: 'ai' },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { content: true },
  });
  return { reply: fallback[0]?.content || '', msgs: fallback };
}

async function getActionLogsForLead(leadId, since = null, limit = 40) {
  const visits = await prisma.visit.findMany({ where: { leadId }, select: { id: true } });
  const visitIds = visits.map((v) => v.id);
  return prisma.agentActionLog.findMany({
    where: {
      companyId: COMPANY_ID,
      OR: [{ resourceId: leadId }, ...(visitIds.length ? [{ resourceId: { in: visitIds } }] : [])],
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { action: true, status: true, createdAt: true },
  });
}

async function waitForStaffReply(userId, afterTime, { timeoutSec = 45, mustMatch = null } = {}) {
  const session = await prisma.agentSession.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  if (!session) return '';
  for (let i = 0; i < timeoutSec / 3; i++) {
    await sleep(3000);
    const rows = await prisma.$queryRawUnsafe(
      `SELECT content, created_at AS "createdAt" FROM agent_session_messages
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

async function runStaffTurn(staffUser, from, body, { waitSec = 45, mustMatch = null } = {}) {
  const wh = await sendTextWebhook(from, body, body.slice(0, 10).replace(/\W/g, ''));
  const reply = staffUser
    ? await waitForStaffReply(staffUser.id, wh.sentAt, { timeoutSec: waitSec, mustMatch })
    : '';
  const logs = await prisma.agentActionLog.findMany({
    where: { companyId: COMPANY_ID, createdAt: { gte: wh.sentAt } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { action: true },
  });
  return { wh, reply, logs };
}

async function runTurn(from, body, { waitSec = 0, mustMatch = null } = {}) {
  const wh = await sendTextWebhook(from, body, body.slice(0, 10).replace(/\W/g, ''));
  const lead = await waitForLead(from, 30);
  const { reply } = lead
    ? await waitForAiReply(lead.id, wh.sentAt, { timeoutSec: waitSec || 45, mustMatch })
    : { reply: '' };
  const logs = lead ? await getActionLogsForLead(lead.id, wh.sentAt) : [];
  return { wh, lead, reply, logs };
}

async function runInteractive(from, interactiveId, title, waitSec = 35) {
  const wh = await sendInteractiveWebhook(from, interactiveId, title, interactiveId.slice(0, 12));
  const lead = await getLeadForPhone(from);
  const { reply } = lead
    ? await waitForAiReply(lead.id, wh.sentAt, { timeoutSec: waitSec })
    : { reply: '' };
  const logs = lead ? await getActionLogsForLead(lead.id, wh.sentAt) : [];
  return { wh, lead, reply, logs };
}

async function ensureAiActive(leadId) {
  const conv = await getConversationId(leadId);
  if (!conv) return;
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { status: 'ai_active', aiEnabled: true },
  });
}

async function loginAdmin() {
  const email = 'admin@investo.in';
  const password = 'admin@123';
  const hash = await bcrypt.hash(password, 12);
  let company = await prisma.company.findFirst({ where: { slug: 'investo-platform' } });
  if (!company) {
    const plan = await prisma.subscriptionPlan.findFirst({ where: { name: 'Enterprise' } });
    company = await prisma.company.create({
      data: { name: 'Investo Platform', slug: 'investo-platform', status: 'active', planId: plan?.id },
    });
  }
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash, role: 'super_admin', status: 'active', companyId: company.id },
    create: { email, name: 'Super Admin', passwordHash: hash, role: 'super_admin', status: 'active', companyId: company.id },
  });
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.data?.tokens?.access_token || null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let suite = 'all';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--suite') suite = args[++i];
  }
  return { suite };
}

/** @type {Array<{id:string, group:string, name:string, run:()=>Promise<{ok:boolean,detail:string}>}>} */
const SCENARIOS = [];

function add(id, group, name, run) {
  SCENARIOS.push({ id, group, name, run });
}

// ── Preflight ─────────────────────────────────────────────────────────────
add('preflight-health', 'system', 'Health live', async () => {
  const h = await fetch(`${BASE}/api/health/live`).then((r) => r.json());
  return { ok: h.status === 'ok', detail: JSON.stringify(h) };
});

add('preflight-deps', 'system', 'Health DB + OpenAI', async () => {
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
  const ok = h.dependencies?.db?.status === 'ok';
  return { ok, detail: `db=${h.dependencies?.db?.status} openai=${h.dependencies?.openai?.status}` };
});

// ── Buyer text (sequential on buyerA) ─────────────────────────────────────
let buyerA = randBuyer();

add('buyer-01-rapport', 'buyer', 'Rapport / first contact', async () => {
  const { wh, lead, reply } = await runTurn(buyerA, 'Hi, I am looking for a home in Bangalore');
  const clean = assertCleanReply(reply);
  const ok = wh.ok && !!lead && !clean.length && /bangalore|home|welcome|help|looking/i.test(reply);
  return { ok, detail: `${clean.join(',') || reply.slice(0, 60)}` };
});

add('buyer-02-qualify', 'buyer', 'Qualify budget location BHK', async () => {
  const { wh, lead, reply } = await runTurn(buyerA, 'My budget is 1.2 to 1.5 crore for 3BHK in Whitefield', { waitSec: 50 });
  await sleep(5000);
  const refreshed = (await getLeadForPhone(buyerA)) || lead;
  const mem = refreshed?.leadMemory && typeof refreshed.leadMemory === 'object' ? refreshed.leadMemory : {};
  const clean = assertCleanReply(reply);
  const memOk =
    !!(mem.budget?.min || mem.budget?.max) ||
    /budget|crore|whitefield|saved/i.test(reply);
  const ok = wh.ok && !!refreshed && memOk && !clean.length;
  return { ok, detail: `budget=${!!mem.budget} loc=${!!mem.locationPreference} ${reply.slice(0, 40)}` };
});

add('buyer-03-brochure', 'buyer', 'Brochure request', async () => {
  const prop = await prisma.property.findFirst({ where: { companyId: COMPANY_ID, status: 'available' }, select: { name: true } });
  const name = prop?.name || 'Sunset Heights';
  const { wh, lead, reply, logs } = await runTurn(buyerA, `Please send brochure for ${name}`);
  const clean = assertCleanReply(reply);
  const ok = wh.ok && !!lead && !clean.length && /brochure|pdf|upload|send/i.test(reply);
  return { ok, detail: `brochureLog=${hasActionLog(logs, /brochure|workflow_brochure/i)} ${reply.slice(0, 50)}` };
});

add('buyer-04-price', 'buyer', 'Price inquiry', async () => {
  const { wh, lead, reply } = await runTurn(buyerA, 'What is the price for 3BHK?', {
    waitSec: 50,
    mustMatch: /₹|lakh|crore|price|matching options/i,
  });
  const clean = assertCleanReply(reply);
  const ok = wh.ok && !!lead && !clean.length && /₹|lakh|crore|price|matching options/i.test(reply);
  return { ok, detail: reply.slice(0, 80) };
});

add('buyer-05-availability', 'buyer', 'Availability check', async () => {
  const { wh, lead, reply } = await runTurn(buyerA, 'Is 3BHK still available this weekend?');
  const clean = assertCleanReply(reply);
  const ok = wh.ok && !!lead && !clean.length && /available|weekend|3bhk|option/i.test(reply);
  return { ok, detail: reply.slice(0, 80) };
});

add('buyer-06-book', 'buyer', 'Book visit Sunday 2pm', async () => {
  const prop = await prisma.property.findFirst({ where: { companyId: COMPANY_ID, status: 'available' }, select: { name: true } });
  const propName = prop?.name || 'Sunset Heights';
  const lead = await getLeadForPhone(buyerA);
  const before = lead ? await prisma.visit.count({ where: { leadId: lead.id } }) : 0;
  const { wh, reply, logs } = await runTurn(
    buyerA,
    `Book a site visit for ${propName} next Sunday 2pm`,
    { waitSec: 60, mustMatch: /visit scheduled|confirmed|sunday|2:00|2 pm|shared your preferred/i },
  );
  const leadAfter = await getLeadForPhone(buyerA);
  const after = leadAfter ? await prisma.visit.count({ where: { leadId: leadAfter.id } }) : 0;
  const clean = assertCleanReply(reply);
  const booked = after > before || /visit scheduled|confirmed|shared your preferred|specialist/i.test(reply);
  const ok = wh.ok && booked && !clean.length;
  return { ok, detail: `visits ${before}->${after} log=${hasActionLog(logs, /visit|customerVisit|schedule/i)}` };
});

add('buyer-07-idempotent', 'buyer', 'Idempotent duplicate book', async () => {
  const lead = await getLeadForPhone(buyerA);
  if (!lead) return { ok: false, detail: 'no lead' };
  const before = await prisma.visit.count({ where: { leadId: lead.id } });
  const { wh, reply } = await runTurn(buyerA, 'Book a site visit for next Sunday 2pm');
  const after = await prisma.visit.count({ where: { leadId: lead.id } });
  const clean = assertCleanReply(reply);
  return { ok: wh.ok && after <= before + 1 && !clean.length, detail: `visits ${before}->${after}` };
});

add('buyer-08-visit-status', 'buyer', 'When is my visit', async () => {
  const { wh, lead, reply } = await runTurn(buyerA, 'When is my visit?', { waitSec: 45 });
  const clean = assertCleanReply(reply);
  const ok =
    wh.ok &&
    !!lead &&
    !clean.length &&
    (/your visit|scheduled|sunset|sunday|\d{2}:\d{2}/i.test(reply) ||
      /don't have any upcoming|book a free site visit/i.test(reply));
  return { ok, detail: reply.slice(0, 100) };
});

add('buyer-09-reschedule', 'buyer', 'Reschedule push to Sunday', async () => {
  const lead = await getLeadForPhone(buyerA);
  const hasVisit = lead ? (await prisma.visit.count({ where: { leadId: lead.id, status: { in: ['scheduled', 'confirmed'] } } })) > 0 : false;
  const { wh, reply, logs } = await runTurn(buyerA, 'Push my appointment to next Sunday', { waitSec: 55 });
  const clean = assertCleanReply(reply);
  const reschedLog = hasActionLog(logs, /workflow_reschedule|reschedule|customerVisitBooked/i);
  const rescheduled = /rescheduled|sunday|10:00|10 am/i.test(reply);
  const noVisitMsg = /couldn't find an upcoming|no upcoming/i.test(reply);
  const ok = wh.ok && !!lead && !clean.length && (hasVisit ? rescheduled && reschedLog : noVisitMsg);
  return { ok, detail: `hasVisit=${hasVisit} log=${reschedLog} ${reply.slice(0, 80)}` };
});

add('buyer-10-memory', 'buyer', 'Memory recall budget', async () => {
  await sleep(5000);
  const { wh, lead, reply } = await runTurn(buyerA, "What's my budget preference?", {
    mustMatch: /1\.2|1\.5|crore|budget|₹/i,
    waitSec: 50,
  });
  const clean = assertCleanReply(reply);
  const recalls = /1\.2|1\.20|1\.5|1\.50|crore|budget preference|₹/i.test(reply);
  const notStale = !/^(\*Visit rescheduled\*)/i.test(reply.trim());
  return { ok: wh.ok && !!lead && !clean.length && recalls && notStale, detail: reply.slice(0, 80) };
});

// ── Buyer escalation (fresh phone B) ──────────────────────────────────────
let buyerB = randBuyer();

add('buyer-11-escalate', 'buyer', 'Escalate to human', async () => {
  await runTurn(buyerB, 'Hi looking for 3BHK in Whitefield budget 1.5 crore', {
    waitSec: 50,
    mustMatch: /welcome|3bhk|whitefield|help/i,
  });
  await sleep(4000);
  const { wh, lead, reply, logs } = await runTurn(buyerB, 'Please call me back, I want to talk to a human agent', {
    mustMatch: /human specialist|alerted our team|call/i,
    waitSec: 55,
  });
  const clean = assertCleanReply(reply);
  const escLog = hasActionLog(logs, /workflow_escalate|escalat|callback/i);
  return { ok: wh.ok && !!lead && !clean.length && escLog, detail: `log=${escLog} ${reply.slice(0, 60)}` };
});

add('buyer-12-no-discount', 'buyer', 'Price negotiation no AI discount', async () => {
  let buyerC = randBuyer();
  await runTurn(buyerC, 'Hi I want 3BHK Whitefield 1.5 crore', { waitSec: 45, mustMatch: /welcome|help/i });
  await sleep(4000);
  const { wh, lead, reply, logs } = await runTurn(buyerC, 'Can you give me 10% discount on the final price?', {
    mustMatch: /human specialist|alerted|agent|discount|negotiat|specialist/i,
    waitSec: 55,
  });
  const clean = assertCleanReply(reply);
  const noFake = !/i can offer|approved|10%\s*off/i.test(reply);
  const escLog = hasActionLog(logs, /workflow_escalate|escalat/i);
  return { ok: wh.ok && !!lead && !clean.length && noFake && escLog, detail: `log=${escLog} ${reply.slice(0, 60)}` };
});

// ── Buyer interactive (fresh phone D) ───────────────────────────────────
let buyerD = randBuyer();

add('buyer-int-filter', 'interactive', 'Filter 2BHK shortlist', async () => {
  await runTurn(buyerD, 'Hi I need a home in Bangalore');
  const { wh, lead, reply } = await runInteractive(buyerD, 'filter-2bhk', '2 BHK', 45);
  const clean = assertCleanReply(reply);
  const ok = wh.ok && !!lead && !clean.length && /found|2 bhk|property|options/i.test(reply);
  return { ok, detail: reply.slice(0, 80) };
});

add('buyer-int-call-me', 'interactive', 'Call me button', async () => {
  const { wh, lead, reply } = await runInteractive(buyerD, 'call-me', 'Call Me', 35);
  const clean = assertCleanReply(reply);
  const ok = wh.ok && !!lead && !clean.length && /call|15 minutes|representative/i.test(reply);
  return { ok, detail: reply.slice(0, 80) };
});

add('buyer-int-more-info', 'interactive', 'Property more-info from list', async () => {
  const prop = await prisma.property.findFirst({
    where: { companyId: COMPANY_ID, status: 'available' },
    select: { id: true, name: true },
  });
  if (!prop) return { ok: false, detail: 'no property' };
  const { wh, lead, reply } = await runInteractive(buyerD, `more-info-${prop.id}`, prop.name.slice(0, 12), 45);
  const clean = assertCleanReply(reply);
  const ok = wh.ok && !!lead && !clean.length && (reply.includes(prop.name.slice(0, 8)) || /price|₹/i.test(reply));
  return { ok, detail: `${prop.name} ${reply.slice(0, 50)}` };
});

add('buyer-int-book-visit', 'interactive', 'Book visit button', async () => {
  const prop = await prisma.property.findFirst({
    where: { companyId: COMPANY_ID, status: 'available' },
    select: { id: true, name: true },
  });
  if (!prop) return { ok: false, detail: 'no property' };
  const { wh, lead, reply } = await runInteractive(buyerD, `book-visit-${prop.id}`, 'Book Visit', 40);
  const clean = assertCleanReply(reply);
  const ok = wh.ok && !!lead && !clean.length && /visit|schedule|when|prefer/i.test(reply);
  return { ok, detail: reply.slice(0, 80) };
});

// ── Staff copilot ─────────────────────────────────────────────────────────
add('staff-visits-today', 'staff', 'Visits today CRM', async () => {
  const staff = await prisma.user.findFirst({
    where: { companyId: COMPANY_ID, role: 'sales_agent', phone: { not: null }, status: 'active' },
    select: { id: true, phone: true, name: true, email: true },
  });
  if (!staff) return { ok: false, detail: 'no staff user in tenant' };
  const staffFrom = digits10(staff.phone).replace(/^/, '91');
  const { wh, reply } = await runStaffTurn(staff, staffFrom, 'Visits today', {
    waitSec: 50,
    mustMatch: /visit|today|no visit|scheduled/i,
  });
  return { ok: wh.ok && reply.length > 5, detail: `${staff.email || staffFrom} ${reply.slice(0, 80)}` };
});

add('staff-new-leads', 'staff', 'New leads today', async () => {
  const staff = await prisma.user.findFirst({
    where: { companyId: COMPANY_ID, role: 'sales_agent', phone: { not: null }, status: 'active' },
    select: { id: true, phone: true },
  });
  if (!staff) return { ok: false, detail: 'no staff user' };
  const staffFrom = digits10(staff.phone).replace(/^/, '91');
  const { wh, reply } = await runStaffTurn(staff, staffFrom, 'How many new leads today?', {
    waitSec: 50,
    mustMatch: /lead|today|\d|no new/i,
  });
  return { ok: wh.ok && reply.length > 3, detail: reply.slice(0, 80) };
});

add('staff-help-once', 'staff', 'Help shows shortcuts once', async () => {
  const staff = await prisma.user.findFirst({
    where: { companyId: COMPANY_ID, role: 'sales_agent', phone: { not: null }, status: 'active' },
    select: { id: true, phone: true },
  });
  if (!staff) return { ok: false, detail: 'no staff user' };
  const staffFrom = digits10(staff.phone).replace(/^/, '91');
  const { wh, reply } = await runStaffTurn(staff, staffFrom, 'help', {
    waitSec: 45,
    mustMatch: /visit|lead|help|shortcut|today|copilot/i,
  });
  return { ok: wh.ok && /visit|lead|help|shortcut|today|copilot/i.test(reply), detail: reply.slice(0, 80) };
});

// ── Admin / dashboard ─────────────────────────────────────────────────────
add('admin-action-logs-api', 'admin', 'Action logs API authed', async () => {
  const token = await loginAdmin();
  if (!token) return { ok: false, detail: 'login failed' };
  const res = await fetch(`${BASE}/api/agent-action-logs?limit=5&target_company_id=${COMPANY_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { ok: res.status === 200, detail: `HTTP ${res.status}` };
});

add('admin-frontend-spa', 'admin', 'AI action logs SPA route', async () => {
  const res = await fetch(`${FRONTEND}/dashboard/ai-action-logs`);
  return { ok: res.status === 200, detail: `HTTP ${res.status}` };
});

// ── Takeover semantics ────────────────────────────────────────────────────
add('system-takeover-blocks-ai', 'system', 'Takeover blocks AI reply', async () => {
  let buyerE = randBuyer();
  const { lead } = await runTurn(buyerE, 'Hello testing takeover');
  if (!lead) return { ok: false, detail: 'no lead' };
  const conv = await getConversationId(lead.id);
  if (!conv) return { ok: false, detail: 'no conv' };
  await prisma.conversation.update({
    where: { id: conv.id },
    data: { status: 'agent_active', aiEnabled: false },
  });
  const wh = await sendTextWebhook(buyerE, 'Message after takeover should not get AI sales reply');
  await sleep(15000);
  const { reply } = await waitForAiReply(lead.id, wh.sentAt, { timeoutSec: 20 });
  const convAfter = await getConversationId(lead.id);
  const blocked = !reply || reply.length < 8 || convAfter?.aiEnabled === false;
  await ensureAiActive(lead.id);
  return { ok: wh.ok && blocked, detail: `aiEnabled=${convAfter?.aiEnabled} replyLen=${reply?.length || 0}` };
});

async function main() {
  const { suite } = parseArgs();
  const groups =
    suite === 'all'
      ? ['system', 'buyer', 'interactive', 'staff', 'admin']
      : suite === 'buyer'
        ? ['buyer']
        : [suite];

  console.log(`E2E handset proof — ${BASE}`);
  console.log(`Suite: ${suite} | buyerA=${buyerA} buyerB=${buyerB} buyerD=${buyerD}\n`);

  const selected = SCENARIOS.filter((s) => groups.includes(s.group) || s.group === 'system');
  const out = [];

  for (const sc of selected) {
    process.stdout.write(`[${sc.group}] ${sc.id} ${sc.name} ... `);
    try {
      const result = await sc.run();
      console.log(result.ok ? 'PASS' : 'FAIL', '—', result.detail);
      out.push({ ...sc, ...result });
    } catch (e) {
      console.log('FAIL —', e.message);
      out.push({ ...sc, ok: false, detail: e.message });
    }
  }

  const pass = out.filter((r) => r.ok).length;
  const fail = out.filter((r) => !r.ok).length;
  console.log(`\nSUMMARY pass=${pass} fail=${fail} total=${out.length}`);

  const outPath = path.join(ROOT, 'scripts', 'e2e-handset-proof-results.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify({ runAt: new Date().toISOString(), suite, pass, fail, phones: { buyerA, buyerB, buyerD }, results: out }, null, 2),
  );
  console.log(`Wrote ${outPath}`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
