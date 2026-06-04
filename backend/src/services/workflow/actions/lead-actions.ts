import prisma from '../../../config/prisma';
import logger from '../../../config/logger';
import { LEAD_PIPELINE_STATUSES, type LeadPipelineStatus } from '../../../constants/agent-intent.constants';
import { logAgentAction } from '../../agent-action-log.service';
import { syncLeadClientMemory, setAgentSessionClientContext } from '../../clientMemory.service';
import { assignLeadRoundRobin, notifyAgentOfNewLead } from '../../leadAssignment.service';
import { transitionLeadStatus } from '../../leadTransition.service';
import { notificationEngine } from '../../notification.engine';
import { updateLeadStatusById } from '../../agent/lead-status-actions';
import { resolveLeadForIntent } from '../../agent/agent-lead-resolution.service';
import { buildAgentScopeFilter } from '../../agent/tools/format-helpers';
import type { ActionContext } from './action-helpers';
import { fail, failToolResult, ok, requireLeadId, runNamedTool, skip, mergeStateFromToolOutput } from './action-helpers';

function normalizeStatus(value: unknown): LeadPipelineStatus | undefined {
  const raw = String(value ?? '').toLowerCase().replace(/\s+/g, '_');
  return (LEAD_PIPELINE_STATUSES as readonly string[]).includes(raw) ? (raw as LeadPipelineStatus) : undefined;
}

export async function resolveLead(ctx: ActionContext) {
  const { run, params, state } = ctx;
  if (state.leadId || params.leadId) {
    const leadId = state.leadId ?? params.leadId!;
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, ...buildAgentScopeFilter(run.toolContext.companyId, run.toolContext.userRole, run.toolContext.userId) },
      select: { id: true, customerName: true, status: true, assignedAgentId: true },
    });
    if (!lead) return fail('Lead not found or access denied.');
    state.leadId = lead.id;
    state.leadName = lead.customerName ?? undefined;
    state.oldStatus = lead.status;
    return ok(undefined, { leadId: lead.id, leadName: state.leadName });
  }

  const resolved = await resolveLeadForIntent(
    run.toolContext,
    params,
    run.sessionLeadId,
    run.recentMessages,
  );
  if (!resolved) {
    return fail('Which lead? Share the customer name or lead ID from your list.');
  }
  state.leadId = resolved.leadId;
  state.leadName = resolved.customerName;
  return ok(undefined, { leadId: resolved.leadId, leadName: resolved.customerName });
}

export async function createLead(ctx: ActionContext) {
  const name = ctx.params.customerName ?? ctx.params.leadName;
  const phone = ctx.params.phone;
  if (!name || !phone) return fail('I need customer name and phone to create a lead.');
  const result = await runNamedTool(ctx.run.toolContext, 'createLead', {
    customerName: name,
    phone,
    notes: ctx.params.note,
  });
  if (result.ok === false) return failToolResult(result);
  const patch = mergeStateFromToolOutput('createLead', result.text, ctx.state);
  Object.assign(ctx.state, patch);
  return ok(result.text, patch);
}

export async function assignAgent(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId) return fail('Lead is required before assigning an agent.');
  let agentId = ctx.params.agentId ?? ctx.state.agentId;
  if (!agentId) {
    agentId = (await assignLeadRoundRobin(ctx.run.toolContext.companyId, leadId)) ?? undefined;
  }
  if (!agentId) return skip();
  const result = await runNamedTool(ctx.run.toolContext, 'assignLead', { leadId, agentId });
  if (result.ok === false) return ctx.params.agentId ? failToolResult(result) : skip();
  ctx.state.agentId = agentId;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (lead) await notificationEngine.onLeadAssigned(lead, agentId);
  return ok(result.text, { agentId });
}

export async function sendWelcome(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId || ctx.run.channel === 'staff') return skip();
  const lead = await prisma.lead.findFirst({
    where: { id: leadId },
    select: { phone: true, customerName: true, companyId: true },
  });
  if (!lead?.phone) return skip();
  try {
    const { whatsappService } = await import('../../whatsapp.service');
    const greeting = `Hi ${lead.customerName ?? 'there'}! Thanks for reaching out. Our team will assist you shortly.`;
    await whatsappService.sendCompanyTextMessage(lead.phone, greeting, lead.companyId);
    return ok('Welcome message sent.');
  } catch (err: unknown) {
    logger.warn('sendWelcome failed', { error: err instanceof Error ? err.message : String(err) });
    return skip();
  }
}

export async function notifyAgent(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  const agentId = ctx.state.agentId ?? ctx.params.agentId;
  if (!leadId || !agentId) return skip();
  void notifyAgentOfNewLead(agentId, leadId, ctx.run.toolContext.companyId);
  return ok('Agent notified.');
}

export async function updateLeadStatus(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  const status = normalizeStatus(ctx.params.status);
  if (!leadId) return fail('Which lead should I update?');
  if (!status) return fail('Which status? (e.g. visited, contacted, negotiation)');
  const result = await updateLeadStatusById(ctx.run.toolContext, leadId, status);
  if (!result.handled) return fail(result.reply);
  if (result.leadId && ctx.run.staffPhone) {
    await setAgentSessionClientContext({
      userId: ctx.run.toolContext.userId,
      phone: ctx.run.staffPhone,
      leadId: result.leadId,
    }).catch(() => undefined);
  }
  ctx.state.newStatus = status;
  return ok(result.reply, { leadId: result.leadId, newStatus: status }, result.requiresConfirmation);
}

export async function logLeadHistory(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId) return skip();
  void logAgentAction({
    companyId: ctx.run.toolContext.companyId,
    triggeredBy: 'agent_tool',
    action: 'workflow_lead_status_history',
    actorId: ctx.run.toolContext.userId,
    resourceType: 'lead',
    resourceId: leadId,
    inputs: { from: ctx.state.oldStatus, to: ctx.state.newStatus ?? ctx.params.status },
    status: 'success',
  });
  return skip();
}

export async function notifyIfCritical(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  const status = normalizeStatus(ctx.state.newStatus ?? ctx.params.status);
  if (!leadId || !status) return skip();
  const critical = new Set(['closed_won', 'closed_lost', 'negotiation']);
  if (!critical.has(status)) return skip();
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { companyId: true, customerName: true, phone: true, assignedAgentId: true, status: true },
  });
  if (!lead) return skip();
  await notificationEngine.onLeadStatusChange(lead, ctx.state.oldStatus ?? 'unknown', status);
  return ok('Team notified of critical status change.');
}

export async function addLeadNote(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  const note = ctx.params.note?.trim();
  if (!leadId) return fail('Which lead is this note for?');
  if (!note) return fail('What note should I add?');
  const result = await runNamedTool(ctx.run.toolContext, 'addLeadNote', { leadId, note });
  if (result.ok === false) return failToolResult(result);
  return ok(result.text);
}

export async function syncLeadMemory(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId) return skip();
  void syncLeadClientMemory(leadId);
  return skip();
}

export async function resolveAgent(ctx: ActionContext) {
  if (ctx.state.agentId || ctx.params.agentId) {
    ctx.state.agentId = ctx.state.agentId ?? ctx.params.agentId;
    return ok(undefined, { agentId: ctx.state.agentId });
  }
  if (!ctx.params.agentName) return fail('Which agent? Share a name.');
  const agent = await prisma.user.findFirst({
    where: {
      companyId: ctx.run.toolContext.companyId,
      status: 'active',
      name: { contains: String(ctx.params.agentName), mode: 'insensitive' },
    },
    select: { id: true, name: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (!agent) return fail(`No active agent matching "${ctx.params.agentName}".`);
  ctx.state.agentId = agent.id;
  return ok(undefined, { agentId: agent.id });
}

export async function reassignLead(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  const agentId = ctx.state.agentId ?? ctx.params.toAgentId ?? ctx.params.agentId;
  if (!leadId || !agentId) return fail('Lead and target agent are required.');
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId: ctx.run.toolContext.companyId },
    select: { assignedAgentId: true },
  });
  if (!lead) return fail('Lead not found.');
  const result = await runNamedTool(ctx.run.toolContext, 'assignLead', { leadId, agentId });
  if (result.ok === false) return failToolResult(result);
  const updated = await prisma.lead.findUnique({ where: { id: leadId } });
  if (updated) await notificationEngine.onLeadReassigned(updated, lead.assignedAgentId, agentId);
  return ok(result.text);
}

export async function notifyAgentChange(ctx: ActionContext) {
  return notifyAgent(ctx);
}

export async function updateLeadStatusVisitScheduled(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId) return skip();
  const okTransition = await transitionLeadStatus(leadId, 'visit_scheduled', { force: false });
  if (!okTransition) return skip();
  ctx.state.newStatus = 'visit_scheduled';
  return ok('Lead marked visit_scheduled.');
}

export async function updateLeadStatusVisited(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId) return skip();
  const result = await updateLeadStatusById(ctx.run.toolContext, leadId, 'visited');
  return result.handled ? ok(result.reply) : skip();
}

export async function updateLeadScore(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId) return skip();
  void logAgentAction({
    companyId: ctx.run.toolContext.companyId,
    triggeredBy: 'agent_tool',
    action: 'workflow_lead_score_touch',
    resourceType: 'lead',
    resourceId: leadId,
    inputs: { message: ctx.params.message },
    status: 'success',
  });
  return skip();
}

export async function updateLeadInterest(ctx: ActionContext) {
  return syncLeadMemory(ctx);
}

export async function updateLeadPreferences(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId || !ctx.params.note) return skip();
  await addLeadNote({ ...ctx, params: { ...ctx.params, note: `[preference] ${ctx.params.note}` } });
  return skip();
}

export async function tagLead(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId) return skip();
  const tag = ctx.params.note ?? ctx.params.message ?? 'amenities_interest';
  const result = await runNamedTool(ctx.run.toolContext, 'addLeadNote', {
    leadId,
    note: `[tag] ${String(tag).slice(0, 200)}`,
  });
  return result.ok ? skip() : skip();
}

export async function markLeadUrgent(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId) return skip();
  const result = await runNamedTool(ctx.run.toolContext, 'flagLeadPriority', { leadId, priority: 'hot' });
  return result.ok ? ok(result.text) : skip();
}
