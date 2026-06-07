/**
 * UX quality proof: staff phone + buyer webhooks, then assert friendly copy (no UUIDs, etc.).
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const vars = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
const COMPANY = 'a9c308d8-1083-4981-bd46-3667e0474e8e';
const STAFF_SESSION = '97cec163-39d4-4e77-8e43-79169dab9d47';
const WAIT_SEC = Number(process.env.MANUAL_WAIT_SEC || 30);

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

function sleep(sec) {
  execSync(`powershell -Command "Start-Sleep -Seconds ${sec}"`, { stdio: 'ignore' });
}

function sendStaff(msg) {
  const r = execSync(`node "${path.join(ROOT, 'scripts', 'wa-adb-send.mjs')}" com.whatsapp "${msg.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
  });
  const m = r.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : { sent: false };
}

async function sendBuyer(msg) {
  const msgId = `wamid.ux.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'ux-proof',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: '1090528010807708', display_phone_number: '+15551642552' },
          contacts: [{ profile: { name: 'Kannada media' } }],
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
  return { sent: res.status === 200, msgId };
}

function uxChecks(text, role) {
  const issues = [];
  if (/\bID:\s*[0-9a-f-]{8,}/i.test(text)) issues.push('contains_internal_uuid');
  if (/\bno_show\b/i.test(text)) issues.push('raw_snake_case_status');
  if (/\bproperty settings\b/i.test(text)) issues.push('staff_wording_on_buyer');
  if (/\bUpload one in\b/i.test(text)) issues.push('staff_upload_instruction');
  if (/\d{2}:\d{2}\s*(am|pm)\s+\d{2}:\d{2}\s*(am|pm)/i.test(text)) issues.push('duplicate_time');
  if (role === 'staff' && text.length > 3500) issues.push('message_too_long');
  return issues;
}

const scenarios = [
  { id: 'staff-visits', role: 'staff', msg: 'visits today', send: () => sendStaff('visits today'), expect: /visit|today|No visits/i },
  { id: 'staff-leads', role: 'staff', msg: 'new leads today', send: () => sendStaff('new leads today'), expect: /lead|today|No new leads/i },
  { id: 'buyer-brochure', role: 'buyer', msg: 'Send brochure for Sunset Heights', send: () => sendBuyer('Send brochure for Sunset Heights'), expect: /brochure|pricing|photos|site visit/i, reject: /property settings|Upload one|Thanks for your message.*Our team/i },
  { id: 'buyer-visit-status', role: 'buyer', msg: 'When is my visit?', send: () => sendBuyer('When is my visit?'), expect: /YOUR VISIT|visit|scheduled/i, reject: /02:00 pm 02:00 pm|Thanks for your message.*Our team/i },
];

async function staffReplyFor(msg, since) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT a.content FROM agent_session_messages s
     JOIN agent_session_messages a ON a.session_id = s.session_id
       AND a.role = 'assistant' AND a.created_at >= s.created_at
     WHERE s.session_id = $1::uuid AND s.role = 'staff' AND s.content = $2
       AND s.created_at > $3
     ORDER BY s.created_at DESC, a.created_at DESC
     LIMIT 1`,
    STAFF_SESSION,
    msg,
    since,
  );
  return rows[0]?.content ?? '';
}

const results = [];
console.log(`\n=== UX quality proof (${scenarios.length} scenarios) ===\n`);

console.log('Releasing buyer to AI...');
execSync(`npx tsx "${path.join(import.meta.dirname, 'prod-release-buyer-to-ai.mjs')}"`, {
  cwd: path.join(import.meta.dirname, '..'),
  stdio: 'inherit',
});
sleep(3);

for (const sc of scenarios) {
  const since = new Date(Date.now() - 2000);
  process.stdout.write(`[${sc.role}] ${sc.id} ... `);
  const sendResult = await sc.send();
  if (!sendResult.sent) {
    results.push({ id: sc.id, ok: false, reason: 'send_failed' });
    console.log('FAIL send');
    continue;
  }
  sleep(WAIT_SEC);

  let content = '';
  if (sc.role === 'staff') {
    content = await staffReplyFor(sc.msg, since);
  } else {
    const lead = await prisma.lead.findFirst({ where: { companyId: COMPANY, phone: { contains: '6363062930' } }, select: { id: true } });
    const msg = lead
      ? await prisma.message.findFirst({
          where: { conversation: { leadId: lead.id }, senderType: 'ai', createdAt: { gte: since } },
          orderBy: { createdAt: 'desc' },
          select: { content: true },
        })
      : null;
    content = msg?.content ?? '';
  }

  const issues = uxChecks(content, sc.role);
  const matchOk = sc.expect.test(content);
  const rejectHit = sc.reject && sc.reject.test(content);
  const ok = !!content && matchOk && !rejectHit && issues.length === 0;
  results.push({ id: sc.id, ok, issues, preview: content.slice(0, 160) });
  console.log(ok ? 'PASS' : 'FAIL', issues.join(',') || content.slice(0, 60));
  sleep(8);
}

const pass = results.filter((r) => r.ok).length;
const out = path.join(ROOT, 'scripts', 'manual-ux-quality-results.json');
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
console.log(`\n=== ${pass}/${results.length} UX checks passed ===\n`);
await prisma.$disconnect();
process.exit(pass === results.length ? 0 : 1);
