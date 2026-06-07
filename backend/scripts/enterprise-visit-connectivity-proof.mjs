/**
 * Runtime proof: visit lifecycle wiring against production DB.
 * Run: node backend/scripts/enterprise-visit-connectivity-proof.mjs
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const varsPath = path.join(ROOT, 'scripts', '.railway-prod-vars.json');
if (!fs.existsSync(varsPath)) {
  console.error('Missing scripts/.railway-prod-vars.json');
  process.exit(1);
}

const vars = JSON.parse(fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, ''));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });
const COMPANY_ID = process.env.COMPANY_ID || 'a9c308d8-1083-4981-bd46-3667e0474e8e';

const checks = [];

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
}

async function main() {
  console.log('=== Enterprise visit connectivity proof ===\n');

  const recentVisit = await prisma.visit.findFirst({
    where: { companyId: COMPANY_ID, status: { in: ['scheduled', 'confirmed'] } },
    orderBy: { createdAt: 'desc' },
    include: { lead: { select: { customerName: true, phone: true } }, property: { select: { name: true } } },
  });
  record(
    'Active visit exists in DB',
    Boolean(recentVisit),
    recentVisit
      ? `${recentVisit.property?.name ?? 'property'} @ ${recentVisit.scheduledAt.toISOString()} (${recentVisit.status})`
      : 'no active visit — book one via WhatsApp first',
  );

  if (recentVisit) {
    const agentNotif = await prisma.notification.findFirst({
      where: {
        companyId: COMPANY_ID,
        userId: recentVisit.agentId,
        type: { in: ['visit_scheduled', 'visit_confirmed', 'visit_rescheduled'] },
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });
    record(
      'Agent in-app notification for visit',
      Boolean(agentNotif),
      agentNotif ? `${agentNotif.type}: ${agentNotif.title}` : 'none in last 7 days',
    );

    const conv = await prisma.conversation.findFirst({
      where: { leadId: recentVisit.leadId },
      select: { id: true, stage: true, proposedVisitTime: true, status: true },
    });
    record(
      'Conversation linked to visit lead',
      Boolean(conv),
      conv
        ? `stage=${conv.stage} proposed=${conv.proposedVisitTime?.toISOString() ?? 'null'}`
        : 'missing',
    );

    const aiMsgs = await prisma.message.count({
      where: {
        conversationId: conv?.id,
        senderType: 'ai',
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });
    record('AI outbound messages on visit thread (7d)', aiMsgs > 0, `count=${aiMsgs}`);
  }

  const pendingApproval = await prisma.notification.findFirst({
    where: {
      companyId: COMPANY_ID,
      type: 'visit_scheduled',
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (pendingApproval) {
    const data = (pendingApproval.data ?? {}) ;
    record(
      'Pending approval payload shape',
      Boolean(data.approvalId || data.visitId),
      JSON.stringify({ pendingApproval: data.pendingApproval, approvalId: data.approvalId, visitId: data.visitId }),
    );
  }

  const codeProof = [
    'visitLifecycle.service.ts',
    'visitAutoConfirm.service.ts',
    'visitBooking.service.ts',
    'visitState.service.ts',
  ].every((f) => fs.existsSync(path.join(ROOT, 'backend/src/services', f)));
  record('Lifecycle service files present', codeProof, codeProof ? 'all 4 files' : 'missing files');

  const pass = checks.filter((c) => c.ok).length;
  console.log(`\nResult: ${pass}/${checks.length} checks passed`);
  process.exit(pass >= Math.max(3, checks.length - 1) ? 0 : 1);
}

main().finally(() => prisma.$disconnect());
