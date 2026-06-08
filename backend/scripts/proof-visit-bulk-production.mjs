/**
 * Production proof: visit approval-first booking + staff bulk forward parse/send path.
 *
 * Usage:
 *   cd backend && npx tsx scripts/proof-visit-bulk-production.mjs
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const vars = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', '.railway-prod-vars.json'), 'utf8').replace(/^\uFEFF/, ''));
process.env.DATABASE_URL = process.env.DATABASE_URL || vars.DATABASE_URL;
process.env.DIRECT_URL = process.env.DIRECT_URL || vars.DIRECT_URL || vars.DATABASE_URL;
process.env.NODE_ENV = 'production';

const BASE = process.env.PROD_API_BASE || 'https://investo-backend-production.up.railway.app';
const E2E_TOKEN = process.env.E2E_WEBHOOK_PROOF_TOKEN || vars.E2E_WEBHOOK_PROOF_TOKEN || 'investo-handset-e2e-v1';
const COMPANY_ID = 'a9c308d8-1083-4981-bd46-3667e0474e8e';
const PHONE_NUMBER_ID = vars.WHATSAPP_PHONE_NUMBER_ID || '1090528010807708';

const { parseStaffForwardCommand } = await import('../src/services/staffMessageForward.service.js');
const { resolveVisitApproval } = await import('../src/services/visitPendingApproval.service.js');
const { PrismaClient } = await import('@prisma/client');
const { PrismaPg } = await import('@prisma/adapter-pg');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

const results = [];

function pass(id, detail) {
  results.push({ id, ok: true, detail });
  console.log(`PASS ${id} — ${detail}`);
}

function fail(id, detail) {
  results.push({ id, ok: false, detail });
  console.log(`FAIL ${id} — ${detail}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randPhone() {
  return '91900000' + String(7000 + Math.floor(Math.random() * 999));
}

async function sendBuyerWebhook(from, body) {
  const msgId = `wamid.proof.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'proof',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: 'Proof User' } }],
          messages: [{ from: from.replace(/^\+/, ''), id: msgId, type: 'text', text: { body } }],
        },
      }],
    }],
  };
  const res = await fetch(`${BASE}/api/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(E2E_TOKEN ? { 'X-Investo-E2E-Token': E2E_TOKEN } : {}),
    },
    body: JSON.stringify(payload),
  });
  return { ok: res.status === 200, msgId, sentAt: new Date() };
}

async function waitForLead(phone, timeoutSec = 45) {
  const last10 = phone.replace(/\D/g, '').slice(-10);
  for (let i = 0; i < timeoutSec / 3; i++) {
    await sleep(3000);
    const lead = await prisma.lead.findFirst({
      where: { companyId: COMPANY_ID, phone: { contains: last10 } },
      orderBy: { updatedAt: 'desc' },
    });
    if (lead) return lead;
  }
  return null;
}

async function waitForPendingApproval(leadId, since, timeoutSec = 60) {
  const model = prisma.bookingApprovalRequest;
  if (!model?.findFirst) return null;
  for (let i = 0; i < timeoutSec / 3; i++) {
    await sleep(3000);
    const row = await model.findFirst({
      where: {
        companyId: COMPANY_ID,
        leadId,
        kind: 'visit',
        status: 'pending',
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (row) return row;
  }
  return null;
}

async function main() {
  console.log(`Proof run — ${BASE}\n`);

  const health = await fetch(`${BASE}/api/health/live`).then((r) => r.json()).catch(() => ({}));
  if (health.status !== 'ok') {
    fail('health', JSON.stringify(health));
    process.exitCode = 1;
    return;
  }
  pass('health', `uptime=${health.uptime_seconds}s`);

  const bulkParsed = parseStaffForwardCommand('send "Site visit confirmed for Sunday 2pm" to 9036165603,919876543210');
  if (bulkParsed?.body && bulkParsed.phones.length === 2) {
    pass('bulk-parse-quoted', `${bulkParsed.phones.length} phones`);
  } else {
    fail('bulk-parse-quoted', 'parse failed');
  }

  const bulkForward = parseStaffForwardCommand('forward "Team update" to 9036165603 919876543210');
  if (bulkForward?.body === 'Team update' && bulkForward.phones.length === 2) {
    pass('bulk-parse-forward-alias', 'forward alias ok');
  } else {
    fail('bulk-parse-forward-alias', 'parse failed');
  }

  const prop = await prisma.property.findFirst({
    where: { companyId: COMPANY_ID, status: 'available' },
    select: { name: true },
  });
  const propName = prop?.name || 'Sunset Heights';
  const buyerPhone = randPhone();
  const slotDate = new Date();
  slotDate.setDate(slotDate.getDate() + 21 + Math.floor(Math.random() * 14));
  slotDate.setHours(15, 30, 0, 0);
  const slotLabel = slotDate.toLocaleDateString('en-IN', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
  const visitMsg = `Book a site visit for ${propName} on ${slotLabel} at 3:30 pm`;

  const wh = await sendBuyerWebhook(buyerPhone, visitMsg);
  if (!wh.ok) {
    fail('buyer-webhook', `status not 200`);
    process.exitCode = 1;
    return;
  }

  const lead = await waitForLead(buyerPhone);
  if (!lead) {
    fail('buyer-lead', 'lead not created');
    process.exitCode = 1;
    return;
  }
  pass('buyer-lead', lead.id);

  const approval = await waitForPendingApproval(lead.id, wh.sentAt);
  if (!approval) {
    const audit = await prisma.agentActionLog.findFirst({
      where: {
        companyId: COMPANY_ID,
        resourceId: lead.id,
        createdAt: { gte: wh.sentAt },
        action: { in: ['visit_pending_approval', 'customerVisitBooked', 'booking_approval_created'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (audit) {
      pass('visit-pending-approval-audit', audit.action);
    } else {
      fail('visit-pending-approval', 'no pending booking_approval_requests row or audit');
    }
  } else {
    pass('visit-pending-approval', `${approval.id} @ ${approval.scheduledAt.toISOString()}`);

    const agentId = approval.agentId;
    let resolved;
    try {
      resolved = await resolveVisitApproval(approval.id, true, COMPANY_ID, agentId);
    } catch (err) {
      fail('agent-confirm-visit', err instanceof Error ? err.message : String(err));
      resolved = { ok: false };
    }
    if (resolved?.ok) {
      pass('agent-confirm-visit', resolved.message.slice(0, 80));

      await sleep(2000);
      const visit = await prisma.visit.findFirst({
        where: { companyId: COMPANY_ID, leadId: lead.id, status: { in: ['scheduled', 'confirmed'] } },
        orderBy: { createdAt: 'desc' },
      });
      const refreshedLead = await prisma.lead.findUnique({ where: { id: lead.id }, select: { status: true } });
      if (visit && refreshedLead?.status === 'visit_scheduled') {
        pass('visit-db-lead-status', `visit=${visit.id} status=${refreshedLead.status}`);
      } else {
        fail('visit-db-lead-status', `visit=${!!visit} leadStatus=${refreshedLead?.status}`);
      }

      const confirmLog = await prisma.agentActionLog.findFirst({
        where: {
          companyId: COMPANY_ID,
          resourceId: visit?.id ?? lead.id,
          action: 'visit_confirmed_by_agent',
          createdAt: { gte: wh.sentAt },
        },
      });
      if (confirmLog) pass('visit-confirm-audit', 'visit_confirmed_by_agent logged');
      else fail('visit-confirm-audit', 'missing audit log');
    } else if (resolved && !resolved.ok) {
      fail('agent-confirm-visit', resolved.message || 'confirm failed');
    }
  }

  const outPath = path.join(ROOT, 'scripts', 'proof-visit-bulk-results.json');
  const passCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;
  fs.writeFileSync(outPath, JSON.stringify({ runAt: new Date().toISOString(), pass: passCount, fail: failCount, results }, null, 2));
  console.log(`\nSUMMARY pass=${passCount} fail=${failCount}`);
  console.log(`Wrote ${outPath}`);
  process.exitCode = failCount > 0 ? 1 : 0;
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
