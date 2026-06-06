/**
 * Deep audit of buyer scenario runs on prod DB.
 * Validates: message pairing, workflow completion, action logs, leaks, duplicates.
 *
 * Usage:
 *   npx tsx scripts/buyer-scenario-audit.mjs --phone 919000008909
 *   npx tsx scripts/buyer-scenario-audit.mjs --phone 919000008909 --since 2026-06-06T08:00:00Z
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const varsPath = path.join(ROOT, 'scripts', '.railway-prod-vars.json');
const COMPANY_ID = 'a9c308d8-1083-4981-bd46-3667e0474e8e';

const raw = fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, '');
const vars = JSON.parse(raw);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

function parseArgs() {
  const args = process.argv.slice(2);
  let phone = null;
  let since = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--phone') phone = args[++i]?.replace(/\D/g, '');
    if (args[i] === '--since') since = args[++i];
  }
  if (!phone) throw new Error('--phone required');
  return { phone, since: since ? new Date(since) : null };
}

const INTERNAL_LEAK = /Workflow\s+"[^"]+"\s+failed|handler not configured|Invalid uuid|propertyId:/i;
const CONNECTION_ISSUE = /brief (connection|technical) issue|resend your message/i;

function auditOutbound(content, ctx) {
  const issues = [];
  if (INTERNAL_LEAK.test(content)) issues.push('INTERNAL_WORKFLOW_LEAK');
  if (CONNECTION_ISSUE.test(content)) issues.push('GENERIC_CONNECTION_FALLBACK');
  if (/^Here are the matching options I found:/i.test(content) && ctx.expectation === 'visit_book') {
    issues.push('CATALOG_INSTEAD_OF_VISIT');
  }
  if (/^Here are the matching options I found:/i.test(content) && ctx.expectation === 'availability') {
    issues.push('OK_CATALOG_AVAILABILITY');
  }
  if (/\bi can offer\b|\d+%\s*off/i.test(content)) issues.push('FABRICATED_DISCOUNT');
  return issues;
}

async function main() {
  const { phone, since } = parseArgs();
  const e164 = phone.startsWith('+') ? phone : `+${phone}`;
  const last10 = phone.slice(-10);

  const lead = await prisma.lead.findFirst({
    where: {
      companyId: COMPANY_ID,
      OR: [{ phone: e164 }, { phone: { contains: last10 } }],
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      visits: { orderBy: { createdAt: 'desc' }, take: 5 },
    },
  });

  if (!lead) {
    console.log(JSON.stringify({ error: 'lead_not_found', phone }, null, 2));
    process.exit(1);
  }

  const conv = await prisma.conversation.findFirst({
    where: { leadId: lead.id },
    orderBy: { updatedAt: 'desc' },
  });

  const msgWhere = { conversationId: conv?.id };
  if (since) msgWhere.createdAt = { gte: since };

  const messages = conv
    ? await prisma.message.findMany({
        where: msgWhere,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          senderType: true,
          content: true,
          createdAt: true,
          whatsappMessageId: true,
        },
      })
    : [];

  const actionLogs = await prisma.agentActionLog.findMany({
    where: {
      companyId: COMPANY_ID,
      resourceId: lead.id,
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    select: {
      action: true,
      status: true,
      triggeredBy: true,
      inputs: true,
      result: true,
      createdAt: true,
    },
  });

  const workflowRuns = await prisma.workflowRunRecord.findMany({
    where: {
      companyId: COMPANY_ID,
      channel: 'buyer',
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  // Pair inbound → outbound AI messages
  const turns = [];
  let pendingInbound = null;
  for (const m of messages) {
    if (m.senderType === 'customer') {
      pendingInbound = m;
    } else if (m.senderType === 'ai' && pendingInbound) {
      turns.push({ inbound: pendingInbound, outbounds: [m] });
      pendingInbound = null;
    } else if (m.senderType === 'ai' && turns.length) {
      turns[turns.length - 1].outbounds.push(m);
    }
  }

  const issues = [];
  for (const t of turns) {
    const outCount = t.outbounds.length;
    if (outCount > 1) {
      issues.push({
        severity: 'warn',
        code: 'MULTIPLE_AI_REPLIES',
        inbound: t.inbound.content.slice(0, 80),
        count: outCount,
      });
    }
    for (const o of t.outbounds) {
      const leak = auditOutbound(o.content, {});
      for (const code of leak) {
        issues.push({
          severity: 'error',
          code,
          inbound: t.inbound.content.slice(0, 80),
          reply: o.content.slice(0, 120),
        });
      }
    }
  }

  const failedWorkflows = workflowRuns.filter((w) => w.status === 'failed' || w.failedStep);
  const completedWorkflows = workflowRuns.filter((w) => w.status === 'completed');

  const report = {
    auditedAt: new Date().toISOString(),
    phone,
    leadId: lead.id,
    leadStatus: lead.status,
    leadMemory: lead.leadMemory,
    visits: lead.visits.map((v) => ({
      id: v.id,
      status: v.status,
      scheduledAt: v.scheduledAt,
      propertyId: v.propertyId,
    })),
    conversation: conv
      ? { id: conv.id, stage: conv.stage, humanTakeover: conv.humanTakeover }
      : null,
    messageStats: {
      total: messages.length,
      customer: messages.filter((m) => m.senderType === 'customer').length,
      ai: messages.filter((m) => m.senderType === 'ai').length,
      turns: turns.length,
    },
    workflowStats: {
      total: workflowRuns.length,
      completed: completedWorkflows.length,
      failed: failedWorkflows.length,
      needsReconciliation: workflowRuns.filter((w) => w.status === 'needs_reconciliation').length,
    },
    actionLogSummary: actionLogs.reduce((acc, l) => {
      acc[l.action] = (acc[l.action] || 0) + 1;
      return acc;
    }, {}),
    failedWorkflows: failedWorkflows.map((w) => ({
      workflowId: w.workflowId,
      status: w.status,
      failedStep: w.failedStep,
      steps: w.stepsJson,
      createdAt: w.createdAt,
    })),
    issues,
    turns: turns.map((t) => ({
      inbound: t.inbound.content,
      inboundAt: t.inbound.createdAt,
      outboundCount: t.outbounds.length,
      replies: t.outbounds.map((o) => o.content.slice(0, 200)),
    })),
    recentActionLogs: actionLogs.slice(-20),
  };

  const outPath = path.join(ROOT, 'scripts', `buyer-audit-${phone}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('=== BUYER SCENARIO AUDIT ===');
  console.log(`Phone: ${phone} | Lead: ${lead.id}`);
  console.log(`Messages: ${report.messageStats.customer} in → ${report.messageStats.ai} AI out (${report.messageStats.turns} turns)`);
  console.log(`Workflows: ${report.workflowStats.completed} completed, ${report.workflowStats.failed} failed`);
  console.log(`Visits: ${lead.visits.length}`);
  console.log(`Issues: ${issues.filter((i) => i.severity === 'error').length} errors, ${issues.filter((i) => i.severity === 'warn').length} warnings`);
  for (const i of issues) {
    console.log(`  [${i.severity}] ${i.code}: ${i.inbound || ''}`);
  }
  console.log(`\nWrote ${outPath}`);

  const errCount = issues.filter((i) => i.severity === 'error').length;
  if (errCount > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
