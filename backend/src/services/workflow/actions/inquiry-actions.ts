import type { ActionContext } from './action-helpers';
import { fail, failToolResult, ok, requireLeadId, runNamedTool, skip } from './action-helpers';

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
  ctx.state.lastMessage = catalog.text;
  return skip();
}

export async function respondPrice(ctx: ActionContext) {
  if (ctx.state.lastMessage) return ok(ctx.state.lastMessage);
  return fail('I could not find pricing for that request.');
}

export async function checkInventory(ctx: ActionContext) {
  const result = await runNamedTool(ctx.run.toolContext, 'searchCatalogByCustomerMessage', {
    message: ctx.params.message ?? ctx.run.messageText,
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

  // If propertyId is known, send directly.
  if (ctx.params.propertyId) {
    const result = await runNamedTool(ctx.run.toolContext, 'sendBrochureToClient', {
      leadId,
      propertyId: ctx.params.propertyId,
    });
    if (result.ok === false) return failToolResult(result);
    return ok(result.text);
  }

  // propertyId is missing — attempt to find the best-matching property with a brochure
  // by searching the catalog against the current message. This handles the common case
  // where a buyer says "send me the brochure" without specifying which property.
  const catalog = await runNamedTool(ctx.run.toolContext, 'searchCatalogByCustomerMessage', {
    message: ctx.params.message ?? ctx.run.messageText,
  });
  if (catalog.ok) {
    // catalog text contains property details; extract the first propertyId if present
    const idMatch = catalog.text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (idMatch) {
      const resolved = await runNamedTool(ctx.run.toolContext, 'sendBrochureToClient', {
        leadId,
        propertyId: idMatch[0],
      });
      if (resolved.ok) return ok(resolved.text);
    }
  }

  // No property could be resolved — let the buyer know we need more info.
  return fail(
    "I'd love to send you the brochure! Could you let me know which project you're interested in? " +
    "We have several properties available.",
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
  const leadId = requireLeadId(ctx);
  if (!leadId) return skip();
  const msg = (ctx.params.message ?? '').toLowerCase();
  if (!/\b(urgent|hot|ready|buy|book)\b/.test(msg)) return skip();
  const { notifyAgent } = await import('./lead-actions');
  return notifyAgent(ctx);
}
