/**
 * Sequential buyer scenario tests against Railway prod.
 * Usage:
 *   npx tsx scripts/buyer-scenario-runner.mjs --scenario 1
 *   npx tsx scripts/buyer-scenario-runner.mjs --from 1 --to 5
 *   npx tsx scripts/buyer-scenario-runner.mjs --all
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const varsPath = path.join(ROOT, 'scripts', '.railway-prod-vars.json');
const BASE = process.env.PROD_API_BASE || 'https://investo-backend-production.up.railway.app';
const COMPANY_ID = 'a9c308d8-1083-4981-bd46-3667e0474e8e';
const PHONE_NUMBER_ID = '1090528010807708';

const raw = fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, '');
const vars = JSON.parse(raw);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

const BUYER_FROM = process.env.BUYER_PHONE?.replace(/\D/g, '')
  || ('91900000' + String(8000 + Math.floor(Math.random() * 999)));
const BUYER_E164 = BUYER_FROM.startsWith('+') ? BUYER_FROM : `+${BUYER_FROM}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendWebhook(body, suffix = '') {
  const msgId = `wamid.scenario.${suffix || Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'buyer-scenario',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: 'Scenario Buyer' } }],
          messages: [{
            from: BUYER_FROM.replace(/^\+/, ''),
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
  return { ok: res.status === 200, status: res.status, msgId };
}

async function getLead() {
  const last10 = BUYER_FROM.replace(/\D/g, '').slice(-10);
  return prisma.lead.findFirst({
    where: {
      companyId: COMPANY_ID,
      OR: [{ phone: BUYER_E164 }, { phone: { contains: last10 } }],
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      phone: true,
      leadMemory: true,
      status: true,
      conversations: { select: { id: true }, take: 1 },
    },
  });
}

async function waitForLead(maxSec = 90) {
  for (let i = 0; i < maxSec / 5; i++) {
    const lead = await getLead();
    if (lead) return lead;
    await sleep(5000);
  }
  return null;
}

async function getLatestAiMessages(leadId, count = 3) {
  const conv = await prisma.conversation.findFirst({
    where: { leadId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  if (!conv) return [];
  return prisma.message.findMany({
    where: { conversationId: conv.id, senderType: 'ai' },
    orderBy: { createdAt: 'desc' },
    take: count,
    select: { content: true, createdAt: true },
  });
}

async function getActionLogs(leadId, limit = 20) {
  return prisma.agentActionLog.findMany({
    where: { companyId: COMPANY_ID, resourceId: leadId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { action: true, status: true, inputs: true, createdAt: true },
  });
}

const INTERNAL_LEAK = /Workflow\s+"[^"]+"\s+failed|Invalid uuid|propertyId:|handler not configured/i;
const CONNECTION_FALLBACK = /brief (connection|technical) issue|resend your message/i;

function assertCleanReply(reply, label) {
  const issues = [];
  if (!reply || reply.length < 8) issues.push('empty_reply');
  if (INTERNAL_LEAK.test(reply)) issues.push('internal_workflow_leak');
  if (CONNECTION_FALLBACK.test(reply)) issues.push('connection_fallback');
  return issues.length ? `${label}:${issues.join(',')}` : null;
}

async function getVisitCount(leadId) {
  return prisma.visit.count({ where: { leadId } });
}

async function runTurn(body, waitSec = 18) {
  const wh = await sendWebhook(body, body.slice(0, 12).replace(/\W/g, ''));
  await sleep(waitSec * 1000);
  const lead = await getLead();
  const aiMsgs = lead ? await getLatestAiMessages(lead.id, 2) : [];
  const logs = lead ? await getActionLogs(lead.id, 5) : [];
  return { wh, lead, aiMsgs, logs, reply: aiMsgs[0]?.content || '' };
}

/** @type {Array<{id:number,name:string,setup?:()=>Promise<void>,run:()=>Promise<{ok:boolean,detail:string}>}>} */
const SCENARIOS = [
  {
    id: 1,
    name: 'Rapport / first contact',
    run: async () => {
      const { wh, lead, reply } = await runTurn('Hi, I am looking for a home in Bangalore');
      const clean = assertCleanReply(reply, 'reply');
      const rapport = /bangalore|home|help|looking|welcome|glad|assist/i.test(reply);
      const ok = wh.ok && !!lead && !clean && rapport;
      return { ok, detail: `lead=${!!lead} rapport=${rapport} ${clean || reply.slice(0, 60)}` };
    },
  },
  {
    id: 2,
    name: 'Qualify — budget location BHK',
    run: async () => {
      const { wh, lead, reply } = await runTurn(
        'My budget is 1.2 to 1.5 crore for 3BHK in Whitefield',
      );
      const mem = lead?.leadMemory && typeof lead.leadMemory === 'object' ? lead.leadMemory : {};
      const hasBudget = !!(mem.budget?.min || mem.budget?.max);
      const hasLoc = !!mem.locationPreference;
      const clean = assertCleanReply(reply, 'reply');
      const notCatalogDump = !/^Here are the matching options/i.test(reply);
      const ok = wh.ok && !!lead && hasBudget && hasLoc && !clean && notCatalogDump;
      return {
        ok,
        detail: `budget=${hasBudget} loc=${hasLoc} catalogDump=${!notCatalogDump} ${clean || reply.slice(0, 60)}`,
      };
    },
  },
  {
    id: 3,
    name: 'Brochure request',
    run: async () => {
      const props = await prisma.property.findFirst({
        where: { companyId: COMPANY_ID, status: 'available' },
        select: { name: true },
      });
      const name = props?.name || 'Palmvilla';
      const { wh, lead, logs, reply } = await runTurn(`Please send brochure for ${name}`);
      const brochureLog = logs.some((l) => /workflow_brochure|brochure/i.test(l.action));
      const clean = assertCleanReply(reply, 'reply');
      const mentionsBrochure = /brochure|pdf|upload|send/i.test(reply);
      const ok = wh.ok && !!lead && !clean && mentionsBrochure && (brochureLog || /no brochure|upload one/i.test(reply));
      return {
        ok,
        detail: `log=${brochureLog} ${clean || reply.slice(0, 80)}`,
      };
    },
  },
  {
    id: 4,
    name: 'Price inquiry (grounded)',
    run: async () => {
      const { wh, lead, logs, reply } = await runTurn('What is the price for 3BHK?');
      const priceLog = logs.some((l) => /workflow_price|price_inquiry/i.test(l.action));
      const clean = assertCleanReply(reply, 'reply');
      const grounded = /₹|lakh|crore|\d/i.test(reply);
      const noFakeDiscount = !/i can offer|\d+%\s*off/i.test(reply);
      const ok = wh.ok && !!lead && !clean && grounded && noFakeDiscount;
      return {
        ok,
        detail: `wfLog=${priceLog} ${clean || reply.slice(0, 80)}`,
      };
    },
  },
  {
    id: 5,
    name: 'Availability check',
    run: async () => {
      const { wh, lead, logs, reply } = await runTurn('Is 3BHK still available this weekend?');
      const clean = assertCleanReply(reply, 'reply');
      const avail = /available|status|weekend|3bhk|sunset|option/i.test(reply);
      const wfLog = logs.some((l) => /workflow_availability|availability/i.test(l.action));
      const ok = wh.ok && !!lead && !clean && avail;
      return { ok, detail: `wfLog=${wfLog} ${clean || reply.slice(0, 80)}` };
    },
  },
  {
    id: 6,
    name: 'Book visit Sunday 11am',
    run: async () => {
      const before = (await getLead())?.id;
      const visitsBefore = before ? await getVisitCount(before) : 0;
      const { wh, lead, logs, reply } = await runTurn('Book a site visit for next Sunday 11am');
      const visitsAfter = lead ? await getVisitCount(lead.id) : 0;
      const bookLog = logs.some((l) => /workflow_schedule_visit/i.test(l.action));
      const booked = visitsAfter > visitsBefore;
      const clean = assertCleanReply(reply, 'reply');
      const confirmed = /visit scheduled|confirmed|sunday|11:00|11 am/i.test(reply);
      const noStaffLeak = !/lead marked|reminders scheduled/i.test(reply);
      const ok = wh.ok && !!lead && booked && !clean && confirmed && noStaffLeak;
      return {
        ok,
        detail: `visits ${visitsBefore}->${visitsAfter} wfLog=${bookLog} staffLeak=${!noStaffLeak} ${clean || reply.slice(0, 60)}`,
      };
    },
  },
  {
    id: 7,
    name: 'Idempotent duplicate book',
    run: async () => {
      const lead = await getLead();
      if (!lead) return { ok: false, detail: 'no lead from prior scenarios' };
      const before = await getVisitCount(lead.id);
      const { wh, reply } = await runTurn('Book a site visit for next Sunday 11am');
      const after = await getVisitCount(lead.id);
      const clean = assertCleanReply(reply, 'reply');
      const idempotent = after <= before + 1;
      const ok = wh.ok && idempotent && !clean;
      return { ok, detail: `visits ${before}->${after} ${clean || reply.slice(0, 60)}` };
    },
  },
  {
    id: 8,
    name: 'When is my visit (deterministic)',
    run: async () => {
      const { wh, lead, reply } = await runTurn('When is my visit?');
      const clean = assertCleanReply(reply, 'reply');
      const hasVisit = /your visit|sunset|scheduled|saturday|sunday|\d{2}:\d{2}/i.test(reply);
      const ok = wh.ok && !!lead && !clean && hasVisit;
      return { ok, detail: `${clean || reply.slice(0, 100)}` };
    },
  },
  {
    id: 9,
    name: 'Reschedule push to Sunday',
    run: async () => {
      const { wh, lead, logs, reply } = await runTurn('Push my appointment to next Sunday');
      const reschedLog = logs.some((l) => /workflow_reschedule_visit/i.test(l.action));
      const clean = assertCleanReply(reply, 'reply');
      const rescheduled = /rescheduled|sunday|10:00|10 am/i.test(reply);
      const ok = wh.ok && !!lead && !clean && rescheduled && reschedLog;
      return { ok, detail: `wfLog=${reschedLog} ${clean || reply.slice(0, 80)}` };
    },
  },
  {
    id: 10,
    name: 'Memory recall — budget',
    run: async () => {
      const { wh, lead, reply } = await runTurn("What's my budget preference?");
      const mem = lead?.leadMemory;
      const clean = assertCleanReply(reply, 'reply');
      const recalls = /1\.2|1\.20|1\.5|1\.50|crore|budget preference|₹/i.test(reply);
      const ok = wh.ok && !!lead && !clean && recalls;
      return { ok, detail: `${clean || reply.slice(0, 80)}` };
    },
  },
  {
    id: 11,
    name: 'Escalate to human',
    run: async () => {
      const { wh, lead, logs, reply } = await runTurn('Please call me back, I want to talk to a human agent');
      const escLog = logs.some((l) => /workflow_escalate|escalat/i.test(l.action));
      const clean = assertCleanReply(reply, 'reply');
      const handoff = /human specialist|alerted our team/i.test(reply);
      const ok = wh.ok && !!lead && !clean && handoff && escLog;
      return { ok, detail: `wfLog=${escLog} ${clean || reply.slice(0, 80)}` };
    },
  },
  {
    id: 12,
    name: 'Price negotiation — no AI discount',
    run: async () => {
      const { wh, lead, logs, reply } = await runTurn('Can you give me 10% discount on the final price?');
      const escLog = logs.some((l) => /workflow_escalate/i.test(l.action));
      const clean = assertCleanReply(reply, 'reply');
      const noDiscount = !/i can offer|approved|10%\s*off|discount of/i.test(reply);
      const noCatalog = !/^Here are the matching options/i.test(reply);
      const escalates = /human specialist|alerted our team/i.test(reply);
      const ok = wh.ok && !!lead && !clean && noDiscount && noCatalog && escalates && escLog;
      return { ok, detail: `wfLog=${escLog} catalog=${!noCatalog} ${clean || reply.slice(0, 80)}` };
    },
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  let scenario = null;
  let from = null;
  let to = null;
  let all = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario') scenario = Number(args[++i]);
    if (args[i] === '--from') from = Number(args[++i]);
    if (args[i] === '--to') to = Number(args[++i]);
    if (args[i] === '--all') all = true;
  }
  if (scenario) return [scenario];
  if (all) return SCENARIOS.map((s) => s.id);
  if (from && to) return SCENARIOS.filter((s) => s.id >= from && s.id <= to).map((s) => s.id);
  return [1];
}

async function main() {
  try {
    const ids = parseArgs();
    console.log(`Buyer phone: ${BUYER_FROM} (${BUYER_E164})`);
    console.log(`Running scenarios: ${ids.join(', ')}\n`);

    const out = [];
    for (const id of ids) {
      const sc = SCENARIOS.find((s) => s.id === id);
      if (!sc) {
        console.log(`[SKIP] #${id} unknown`);
        continue;
      }
      if (sc.setup) await sc.setup();
      process.stdout.write(`[#${id}] ${sc.name} ... `);
      try {
        const result = await sc.run();
        const mark = result.ok ? 'PASS' : 'FAIL';
        console.log(`${mark} — ${result.detail}`);
        out.push({ id, name: sc.name, ...result });
        if (!result.ok && ids.length === 1) process.exitCode = 1;
      } catch (e) {
        console.log(`FAIL — ${e.message}`);
        out.push({ id, name: sc.name, ok: false, detail: e.message });
        if (ids.length === 1) process.exitCode = 1;
      }
    }

    const pass = out.filter((r) => r.ok).length;
    const fail = out.filter((r) => !r.ok).length;
    console.log(`\nSUMMARY pass=${pass} fail=${fail}`);
    const outPath = path.join(ROOT, 'scripts', 'buyer-scenario-results.json');
    fs.writeFileSync(outPath, JSON.stringify({ runAt: new Date().toISOString(), buyer: BUYER_FROM, results: out }, null, 2));
    console.log(`Wrote ${outPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
