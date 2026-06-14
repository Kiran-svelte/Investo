import type { ActionContext } from './action-helpers';
import { fail, failToolResult, ok, requireLeadId, runNamedTool, skip } from './action-helpers';
import {
  formatBuyerCatalogEmpty,
  formatBuyerCatalogMatches,
  formatInventoryCountReply,
  isInventoryCountQuery,
} from '../../../utils/formatBuyerCatalog.util';
import {
  getInventorySummary,
  matchCatalogPropertiesForQuery,
} from '../../../services/propertyKnowledge.service';
import {
  companyUsesProjectBrowse,
  getProjectInventorySummary,
} from '../../../services/projectBrowse.service';
import { resolveBuyerLanguage } from '../../../utils/buyerI18n.util';
import prisma from '../../../config/prisma';

async function resolveBuyerCatalogLang(ctx: ActionContext, message: string): Promise<string> {
  const leadId = requireLeadId(ctx) ?? ctx.run.sessionLeadId ?? null;
  let leadLanguage: string | null = null;
  if (leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, companyId: ctx.run.toolContext.companyId },
      select: { language: true },
    });
    leadLanguage = lead?.language ?? null;
  }
  return resolveBuyerLanguage({ message, leadLanguage });
}

async function resolveBuyerCatalogReply(
  companyId: string,
  message: string,
  lang: string,
): Promise<string> {
  if (isInventoryCountQuery(message)) {
    const usesProjects = await companyUsesProjectBrowse(companyId);
    if (usesProjects) {
      const summary = await getProjectInventorySummary(companyId);
      return formatInventoryCountReply({ ...summary, usesProjects: true }, lang);
    }
    const summary = await getInventorySummary(companyId);
    return formatInventoryCountReply(
      { ...summary, propertyCount: summary.total, usesProjects: false },
      lang,
    );
  }
  const matches = await matchCatalogPropertiesForQuery({ companyId, query: message, limit: 5 });
  if (!matches.length) return formatBuyerCatalogEmpty(message, lang);
  return formatBuyerCatalogMatches(matches, lang);
}

export async function fetchPropertyPrice(ctx: ActionContext) {
  if (ctx.params.propertyId) {
    const result = await runNamedTool(ctx.run.toolContext, 'getPropertyDetails', {
      propertyId: ctx.params.propertyId,
    });
    if (result.ok === false) return failToolResult(result);
    ctx.state.lastMessage = result.text;
    return skip();
  }
  const leadId = requireLeadId(ctx);
  if (leadId) {
    const result = await runNamedTool(ctx.run.toolContext, 'searchPropertiesForLead', {
      leadId,
      query: ctx.params.message ?? ctx.run.messageText,
    });
    if (result.ok) {
      ctx.state.lastMessage = result.text;
      return skip();
    }
  }
  const catalog = await runNamedTool(ctx.run.toolContext, 'searchCatalogByCustomerMessage', {
    message: ctx.params.message ?? ctx.run.messageText,
  });
  if (catalog.ok === false) return failToolResult(catalog);
  if ((ctx.run.channel ?? 'staff') === 'buyer') {
    const message = ctx.params.message ?? ctx.run.messageText;
    const lang = await resolveBuyerCatalogLang(ctx, message);
    ctx.state.lastMessage = await resolveBuyerCatalogReply(
      ctx.run.toolContext.companyId,
      message,
      lang,
    );
  } else {
    ctx.state.lastMessage = catalog.text;
  }
  return skip();
}

export async function respondPrice(ctx: ActionContext) {
  if (ctx.state.lastMessage) return ok(ctx.state.lastMessage);
  return fail('I could not find pricing for that request.');
}

export async function checkInventory(ctx: ActionContext) {
  const message = ctx.params.message ?? ctx.run.messageText;
  if ((ctx.run.channel ?? 'staff') === 'buyer') {
    const lang = await resolveBuyerCatalogLang(ctx, message);
    ctx.state.lastMessage = await resolveBuyerCatalogReply(
      ctx.run.toolContext.companyId,
      message,
      lang,
    );
    return skip();
  }
  const result = await runNamedTool(ctx.run.toolContext, 'searchCatalogByCustomerMessage', {
    message,
  });
  if (result.ok === false) return failToolResult(result);
  ctx.state.lastMessage = result.text;
  return skip();
}

export async function respondAvailability(ctx: ActionContext) {
  if (ctx.state.lastMessage) return ok(ctx.state.lastMessage);
  return fail('I could not check availability right now.');
}

export async function sendBrochure(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId) return fail('Which lead should receive the brochure?');

  if (ctx.params.propertyId) {
    const result = await runNamedTool(ctx.run.toolContext, 'sendBrochureToClient', {
      leadId,
      propertyId: ctx.params.propertyId,
    });
    if (result.ok === false) return failToolResult(result);
    return ok(result.text);
  }

  const catalog = await runNamedTool(ctx.run.toolContext, 'searchCatalogByCustomerMessage', {
    message: ctx.params.message ?? ctx.run.messageText,
  });
  if (catalog.ok) {
    const idMatch = catalog.text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (idMatch) {
      const resolved = await runNamedTool(ctx.run.toolContext, 'sendBrochureToClient', {
        leadId,
        propertyId: idMatch[0],
      });
      if (resolved.ok) return ok(resolved.text);
    }
  }

  {
    const { logAgentAction } = await import('../../agent-action-log.service');
    void logAgentAction({
      companyId: ctx.run.toolContext.companyId,
      triggeredBy: 'inbound_message',
      action: 'workflow_clarification',
      resourceType: 'lead',
      resourceId: leadId ?? null,
      inputs: { workflowId: 'brochure_request', channel: ctx.run.channel ?? 'buyer', source: 'inline_property_unresolved' },
      status: 'success',
      result: 'Asked which property for brochure',
    });
  }
  return ok(
    "I'd love to send you the brochure! Could you let me know which project you're interested in? " +
    'We have several properties available.',
  );
}

export async function logBrochureRequest(ctx: ActionContext) {
  const leadId = requireLeadId(ctx);
  if (!leadId) return skip();
  const { logAgentAction } = await import('../../agent-action-log.service');
  void logAgentAction({
    companyId: ctx.run.toolContext.companyId,
    triggeredBy: 'agent_tool',
    action: 'workflow_brochure_request',
    resourceType: 'lead',
    resourceId: leadId,
    inputs: { propertyId: ctx.params.propertyId },
    status: 'success',
  });
  return skip();
}

export async function answerAmenities(ctx: ActionContext) {
  if (!ctx.params.propertyId) {
    const catalog = await runNamedTool(ctx.run.toolContext, 'searchCatalogByCustomerMessage', {
      message: ctx.params.message ?? ctx.run.messageText,
    });
    if (catalog.ok) return ok(catalog.text);
    return fail('Which property should I describe amenities for?');
  }
  const result = await runNamedTool(ctx.run.toolContext, 'getPropertyDetails', {
    propertyId: ctx.params.propertyId,
  });
  if (result.ok === false) return failToolResult(result);
  return ok(result.text);
}

export async function notifyIfHot(ctx: ActionContext) {
  if (ctx.run.channel === 'buyer') return skip();
  const leadId = requireLeadId(ctx);
  if (!leadId) return skip();
  const msg = (ctx.params.message ?? '').toLowerCase();
  if (!/\b(urgent|hot|ready|buy|book)\b/.test(msg)) return skip();
  const { notifyAgent } = await import('./lead-actions');
  return notifyAgent(ctx);
}

