import { Prisma } from '@prisma/client';
import type { TurnResult, WhatsAppComponent, BuyerTurnInput } from '../../types/whatsapp-turn.types';
import type { ConversationState } from '../conversationStateMachine';
import { resolveBuyerComponents } from '../buyer/buyerButtonPolicy.service';
import { stripBuyerInternalMetadata } from './whatsappResponseSanitizer.service';
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { logOutboundBranch } from '../outboundTurnDebug.service';
import { tryCommitCustomerVisitBooking } from '../customerVisitBooking.service';
import { tryCommitCustomerCallBooking } from '../customerCallBooking.service';
import { extractDateTimeIso } from '../../utils/parseDateTimeFromMessage.util';
import { getLiveLeadContext } from '../liveLeadContext.service';
import { buildBuyerVisitStatusReply, isBuyerVisitStatusQuery } from '../buyerVisitQuery.service';
import { isVisitCancelOrRescheduleMessage, isVisitSchedulingMessage } from '../visitIntentFromMessage.service';
import { buildNeverSayNoContext } from '../neverSayNoEngine.service';
import { criteriaFromLead } from '../alternativeInventory.service';
import { sanitizeBuyerOutbound } from './whatsappResponseSanitizer.service';
import { buildGroundedFactsBlock } from '../groundingGuard.service';
import { propertyToCompletenessInput } from '../propertyCompleteness.service';
import {
  buildFocusedPropertyPromptBlock,
  enrichAiPropertiesFromKnowledge,
  propertyToAiPromptInput,
} from '../propertyAiContext.service';
import { getPropertyKnowledgeForProperty } from '../propertyKnowledge.service';
import { syncLeadScoreFromConversation } from '../leadScoring.service';
import { transitionLeadStatus, transitionLeadToVisitScheduled } from '../leadTransition.service';
import { logAgentAction } from '../agent-action-log.service';
import {
  inferBuyerPropertyContextFromOutbound,
  resolveBuyerPropertyReference,
} from '../buyerPropertyContext.service';
import { aiService } from '../ai.service';
import type { CompanyWhatsAppConfig } from '../whatsapp.service';

/**
 * All data needed for one buyer turn. The nested `input` matches BuyerTurnInput;
 * outer fields are wire-level identifiers needed for the service layer.
 */
type BuyerTurnRuntimeContext = {
  input: BuyerTurnInput;
  companyId: string;
  customerPhone: string;
  messageId: string | undefined;
  companyName: string;
  whatsappConfig: CompanyWhatsAppConfig;
  history: Array<{ senderType: string; content: string; createdAt: Date }>;
};

/** Minimal property shape used by media helpers. */
type PropertySummary = {
  id: string;
  name: string;
  brochureUrl?: string | null;
  images?: string[];
};

// ---------------------------------------------------------------------------
// Guard helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the conversation is under human-agent control.
 *
 * @param conversation - Snapshot with status and aiEnabled fields.
 * @returns true when AI must not respond.
 */
export function isHumanTakeoverActive(conversation: { status: string; aiEnabled: boolean }): boolean {
  return conversation.status === 'agent_active' || !conversation.aiEnabled;
}

// ---------------------------------------------------------------------------
// Media resolution
// ---------------------------------------------------------------------------

/**
 * Resolves at most one hero media attachment for this turn.
 *
 * Priority: brochure PDF > first property hero image (shortlist / commitment stage).
 * Enforces one-outbound budget: never returns more than one component.
 *
 * @param properties - Properties recommended this turn.
 * @param brochureResolution - Result from resolveBrochureForAiTurn.
 * @param stage - Current conversation stage.
 * @returns A single media component, or undefined.
 */
/** Cap turn components to one customer-visible payload: interactive wins over separate media. */
export function enforceTurnComponentBudget(components: WhatsAppComponent[]): WhatsAppComponent[] {
  const interactive = components.find((c) => c.kind === 'buttons' || c.kind === 'list');
  if (interactive) return [interactive];
  const media = components.find((c) => c.kind === 'media');
  return media ? [media] : [];
}

export function resolveHeroMediaComponent(
  properties: PropertySummary[],
  brochureResolution: { mediaComponent: { kind: 'media'; url: string; mime: string; caption?: string } | null } | null,
  stage: string,
): WhatsAppComponent | undefined {
  if (brochureResolution?.mediaComponent) {
    return brochureResolution.mediaComponent;
  }

  if (stage !== 'shortlist' && stage !== 'commitment') return undefined;

  for (const property of properties) {
    const images = property.images;
    if (!Array.isArray(images)) continue;
    const heroImage = images.find((url) => typeof url === 'string' && url.startsWith('https://'));
    if (heroImage) {
      return { kind: 'media', url: heroImage, mime: 'image/jpeg', caption: property.name };
    }
  }

  return undefined;
}

/** Fetch first property by id and resolve hero media (interactive shortlist path). */
export async function resolveHeroMediaComponentFromPropertyIds(
  companyId: string,
  propertyIds: string[],
): Promise<WhatsAppComponent | undefined> {
  if (!propertyIds.length) return undefined;

  const prop = await prisma.property.findFirst({
    where: { companyId, id: propertyIds[0] },
    select: { id: true, name: true, images: true },
  });
  if (!prop) return undefined;

  const images = Array.isArray(prop.images) ? (prop.images as string[]) : [];
  const heroUrl = images.find((url) => typeof url === 'string' && url.startsWith('https://'));
  if (!heroUrl) return undefined;

  return { kind: 'media', url: heroUrl, mime: 'image/jpeg', caption: prop.name };
}

// ---------------------------------------------------------------------------
// H0: Interactive button safety net (never LLM/workflow on button taps)
// ---------------------------------------------------------------------------

async function handleInteractiveSafetyTurn(ctx: BuyerTurnRuntimeContext): Promise<TurnResult | null> {
  const interactiveId = ctx.input.interactiveId?.trim();
  if (!interactiveId) return null;

  logOutboundBranch('H0', 'whatsappTurnOrchestrator:interactiveSafety', 'interactive_safety_net', {
    interactiveId,
  });

  const { tryOrchestratedInteractiveAction } = await import('./whatsappInteractiveOrchestrator.service');
  const { applyInteractiveActionSideEffects } = await import('./whatsappInteractivePersist.service');

  const actionResult = await tryOrchestratedInteractiveAction({
    interactiveId,
    lead: {
      id: ctx.input.leadId,
      customerName: ctx.input.leadCustomerName,
      phone: ctx.customerPhone,
      assignedAgentId: ctx.input.leadAssignedAgentId,
      status: ctx.input.leadStatus,
    },
    conversation: {
      id: ctx.input.conversationId,
      selectedPropertyId: ctx.input.conversationSelectedPropertyId,
    },
    company: { id: ctx.companyId, name: ctx.companyName },
  });

  if (!actionResult?.handled) {
    const { buildSafeBuyerFallback } = await import('../../utils/safeBuyerFallback.util');
    return { audience: 'buyer', handled: true, terminal: true, text: buildSafeBuyerFallback() };
  }

  await applyInteractiveActionSideEffects(actionResult, ctx.input.leadId, ctx.input.conversationId, {
    selectedPropertyId: ctx.input.conversationSelectedPropertyId,
    proposedVisitTime: ctx.input.conversationProposedVisitTime,
  });

  if (actionResult.turnResult?.text?.trim()) {
    await prisma.message.create({
      data: {
        conversationId: ctx.input.conversationId,
        senderType: 'ai',
        content: actionResult.turnResult.text.trim(),
        status: 'sent',
      },
    });
  }

  if (actionResult.turnResult) {
    return actionResult.turnResult;
  }

  const { buildSafeBuyerFallback } = await import('../../utils/safeBuyerFallback.util');
  return { audience: 'buyer', handled: true, terminal: true, text: buildSafeBuyerFallback() };
}

// ---------------------------------------------------------------------------
// H1: Human takeover
// ---------------------------------------------------------------------------

/**
 * Sends a courtesy handoff message when an agent has taken over.
 *
 * @param ctx - Turn runtime context.
 * @returns TurnResult when handled, null when AI is still active.
 */
/**
 * Checks whether the most recent AI-sent message in a conversation is already
 * a human-takeover handoff. Used by handleHumanTakeoverTurn to suppress
 * duplicate handoff messages when the buyer keeps messaging while under
 * human control — the agent still gets pinged, but the buyer is not spammed.
 *
 * @param conversationId - Conversation to check.
 * @returns true when the last AI message looks like a handoff.
 */
async function isLastAiMessageAlreadyHandoff(conversationId: string): Promise<boolean> {
  const lastAi = await prisma.message.findFirst({
    where: { conversationId, senderType: { in: ['ai', 'agent'] } },
    orderBy: { createdAt: 'desc' },
    select: { content: true },
  });
  if (!lastAi?.content) return false;
  return (
    lastAi.content.includes('Our team at') ||
    lastAi.content.includes('our team') ||
    lastAi.content.includes('human specialist') ||
    lastAi.content.includes('will assist you shortly') ||
    lastAi.content.includes('has your request')
  );
}

async function handleHumanTakeoverTurn(ctx: BuyerTurnRuntimeContext): Promise<TurnResult | null> {
  if (!ctx.input.humanTakeover) return null;

  const aiSettings = await prisma.aiSetting.findUnique({ where: { companyId: ctx.companyId } });
  const operatorLine = buildOperatorHandoffLine(aiSettings?.operatorContact);
  const handoffText =
    `Thanks for your message! Our team at *${ctx.companyName}* has your request.\n\n` +
    (operatorLine || `Please share your *area*, *budget*, and *property type* if you have not already - we will assist you shortly.`);

  // Dedup guard: if the last AI message is already a handoff, skip the message
  // create so the buyer is not flooded with identical messages on every inbound.
  // We still notify the agent below so they are always pinged.
  const isAlreadyHandoff = await isLastAiMessageAlreadyHandoff(ctx.input.conversationId);
  if (!isAlreadyHandoff) {
    await prisma.message.create({
      data: {
        conversationId: ctx.input.conversationId,
        senderType: 'ai',
        content: handoffText,
        language: ctx.input.leadLanguage || 'en',
        status: 'sent',
      },
    });
  }

  const notifTitle = 'New message from customer';
  const notifMessage = `${ctx.input.leadCustomerName || ctx.customerPhone}: ${ctx.input.messageText.substring(0, 100)}`;
  const { notificationEngine } = await import('../notification.engine');

  if (ctx.input.leadAssignedAgentId) {
    await prisma.notification.create({
      data: {
        companyId: ctx.companyId,
        userId: ctx.input.leadAssignedAgentId,
        type: 'agent_takeover',
        title: notifTitle,
        message: notifMessage,
      },
    });
    // Also ping agent on their personal WhatsApp
    const agentRecord = await prisma.user.findUnique({
      where: { id: ctx.input.leadAssignedAgentId },
      select: { phone: true },
    });
    if (agentRecord?.phone) {
      await notificationEngine.notifyAgentByWhatsApp({
        agentPhone: agentRecord.phone,
        companyId: ctx.companyId,
        message: `📩 *Customer message (agent active)*\n${notifMessage}\n\nReply in your Investo dashboard.`,
      });
    }
  } else {
    // No assigned agent — notify all company admins via in-app + WhatsApp
    const admins = await prisma.user.findMany({
      where: { companyId: ctx.companyId, role: 'company_admin', status: 'active' },
      select: { id: true, phone: true },
    });
    await Promise.all(
      admins.map(async (admin) => {
        await prisma.notification.create({
          data: {
            companyId: ctx.companyId,
            userId: admin.id,
            type: 'agent_takeover',
            title: 'Unassigned lead — customer message received',
            message: notifMessage,
          },
        });
        if (admin.phone) {
          await notificationEngine.notifyAgentByWhatsApp({
            agentPhone: admin.phone,
            companyId: ctx.companyId,
            message: `📩 *Unassigned lead \u2014 customer messaged*\n${notifMessage}\n\nAssign this lead in Investo.`,
          });
        }
      }),
    );
  }


  logger.info('Prospect message stored; handoff reply sent (conversation not ai_active)', {
    conversationId: ctx.input.conversationId,
  });

  return { audience: 'buyer', handled: true, terminal: true, text: handoffText };
}

// ---------------------------------------------------------------------------
// H1b: Buyer dismissal fast-path
// ---------------------------------------------------------------------------

const DISMISSAL_RE =
  /^(no\s*thanks?|no+|nope|nah|not\s+now|not\s+interested|later|maybe\s+later|not\s+today|no\s+need|i[' ]?m\s+okay|i[' ]?m\s+fine|ok(ay)?|alright|fine|sure\s+thanks?|got\s+it|understood|i\s+know|thanks?\s*[!.]*|thank\s+you[!.]*|thx)[\s!.]*$/i;

const DISMISSAL_ACKS = [
  'No worries! Just reach out when you\'re ready. 😊',
  'Understood — I\'ll be here when you need me!',
  'Alright! Feel free to message anytime.',
  'Got it! Whenever you\'re ready, just drop a message.',
];

function pickDismissalAck(companyName: string): string {
  const idx = Math.floor(Math.random() * DISMISSAL_ACKS.length);
  void companyName;
  return DISMISSAL_ACKS[idx];
}

async function handleDismissalTurn(
  ctx: BuyerTurnRuntimeContext,
  visitCommit: Awaited<ReturnType<typeof tryCommitCustomerVisitBooking>>,
): Promise<TurnResult | null> {
  if (visitCommit.committed || visitCommit.workflowSuggestion) return null;
  const t = ctx.input.messageText.trim();
  if (!DISMISSAL_RE.test(t)) return null;

  const hasPriorOutbound = ctx.history.some((m) => m.senderType === 'ai' || m.senderType === 'agent');
  if (!hasPriorOutbound) return null;

  const ack = pickDismissalAck(ctx.companyName);

  await prisma.message.create({
    data: {
      conversationId: ctx.input.conversationId,
      senderType: 'ai',
      content: ack,
      status: 'sent',
    },
  });

  return { audience: 'buyer', handled: true, terminal: true, text: ack };
}

// ---------------------------------------------------------------------------
// H2: Rapport / greeting
// ---------------------------------------------------------------------------

/**
 * Fast-path response to simple greetings without invoking the LLM.
 *
 * @param ctx - Turn runtime context.
 * @param visitCommit - Pre-fetched visit commit result.
 * @param conversationStage - Current stage from the state machine.
 * @returns TurnResult or null if message is not a rapport message.
 */
async function handleRapportTurn(
  ctx: BuyerTurnRuntimeContext,
  visitCommit: Awaited<ReturnType<typeof tryCommitCustomerVisitBooking>>,
  conversationStage: string,
): Promise<TurnResult | null> {
  if (visitCommit.committed || visitCommit.workflowSuggestion) return null;

  // Mid-booking stages: never send a parallel welcome/intro — one reply per turn.
  if (['visit_booking', 'confirmation', 'commitment'].includes(conversationStage)) return null;

  const { isBuyerRapportMessage, isReturningBuyerGreeting, buildBuyerRapportReply } =
    await import('../buyerQualification.service');

  const hasPriorOutbound = ctx.history.some((m) => m.senderType === 'ai' || m.senderType === 'agent');
  if (!isBuyerRapportMessage(ctx.input.messageText, { hasPriorOutbound })) return null;

  logOutboundBranch('H2', 'whatsappTurnOrchestrator:rapport', 'buyer_rapport_fast_path', {
    messagePreview: ctx.input.messageText.slice(0, 40),
    returning: hasPriorOutbound,
  });

  const isReturning = isReturningBuyerGreeting(ctx.input.messageText, { hasPriorOutbound });
  let locationPreference: string | null = null;
  if (isReturning) {
    const { getLeadMemory } = await import('../lead-memory.service');
    const memory = await getLeadMemory(ctx.input.leadId);
    locationPreference = memory.locationPreference ?? null;
  }

  const rapportReply = buildBuyerRapportReply(ctx.companyName, { isReturning, locationPreference });
  const safeReply = stripBuyerInternalMetadata(rapportReply);
  const components = isReturning
    ? []
    : resolveBuyerComponents({ stage: conversationStage, outboundText: safeReply, isReturningGreeting: false });

  await prisma.message.create({
    data: { conversationId: ctx.input.conversationId, senderType: 'ai', content: safeReply, status: 'sent' },
  });

  return { audience: 'buyer', handled: true, terminal: true, text: safeReply, components };
}

// ---------------------------------------------------------------------------
// H2b: Returning buyer pivot ("something new" after welcome-back prompt)
// ---------------------------------------------------------------------------

/**
 * Deterministic handler when a returning buyer chooses a fresh search.
 * Avoids full LLM path for a common one-line reply to the rapport prompt.
 */
async function handleReturningBuyerPivotTurn(
  ctx: BuyerTurnRuntimeContext,
  visitCommit: Awaited<ReturnType<typeof tryCommitCustomerVisitBooking>>,
): Promise<TurnResult | null> {
  if (visitCommit.committed || visitCommit.workflowSuggestion) return null;

  const hasPriorOutbound = ctx.history.some((m) => m.senderType === 'ai' || m.senderType === 'agent');
  if (!hasPriorOutbound) return null;

  const { isReturningBuyerPivotReply, buildReturningBuyerPivotReply } =
    await import('../buyerQualification.service');
  if (!isReturningBuyerPivotReply(ctx.input.messageText)) return null;

  logOutboundBranch('H2b', 'whatsappTurnOrchestrator:returningPivot', 'buyer_returning_pivot_fast_path', {
    messagePreview: ctx.input.messageText.slice(0, 40),
  });

  const pivotReply = stripBuyerInternalMetadata(
    buildReturningBuyerPivotReply(ctx.companyName),
  );

  await prisma.message.create({
    data: { conversationId: ctx.input.conversationId, senderType: 'ai', content: pivotReply, status: 'sent' },
  });

  await prisma.conversation.update({
    where: { id: ctx.input.conversationId },
    data: {
      stage: 'qualify',
      stageEnteredAt: new Date(),
      stageMessageCount: 0,
      recommendedPropertyIds: [],
      selectedPropertyId: null,
      escalationReason: null,
    },
  });

  return { audience: 'buyer', handled: true, terminal: true, text: pivotReply };
}

// ---------------------------------------------------------------------------
// H2.5: Deterministic property-browsing fast-path
// ---------------------------------------------------------------------------

/**
 * Pure-regex predicate that matches buyer messages whose primary intent is
 * browsing/listing available properties. Kept intentionally broad so that
 * one-word messages like "property" or "properties" are captured deterministically
 * instead of falling through to the LLM (H9) where temperature variance causes
 * spurious `human_escalated` transitions.
 *
 * Deliberately does NOT match scheduling/visit/price messages — those have their
 * own deterministic handlers (H5-H8) that run later in the chain.
 *
 * @param messageText - Raw inbound buyer message.
 * @returns true when the message is a property-browsing intent.
 */
export function isPropertyBrowsingIntent(messageText: string): boolean {
  const t = messageText.trim();
  if (!t) return false;

  // Guard: visit/call/price intent must not be short-circuited here.
  if (
    /\b(book|schedule|arrange|cancel|reschedule)\b/i.test(t) ||
    /\b(visit|appointment|call\s+me|price|cost|how\s+much|discount|brochure|pdf)\b/i.test(t)
  ) {
    return false;
  }

  return (
    // Bare keyword — highest signal
    /^\s*(property|properties|projects?|flats?|apartments?|villas?|plots?)\s*$/i.test(t) ||
    // "show me / list / see properties"
    /\b(show|list|see|view|display|get|give|tell)\s+(me\s+)?(your\s+|the\s+|all\s+|available\s+)?(properties|property|projects?|listings?|inventory|flats?|apartments?|villas?|plots?)\b/i.test(t) ||
    // "what properties / projects do you have"
    /\b(what|which)\s+(properties|property|projects?|flats?|apartments?|villas?|plots?)\b/i.test(t) ||
    // "available properties / projects"
    /\b(available|current|new|latest|upcoming)\s+(properties|property|projects?|flats?|apartments?|villas?|plots?)\b/i.test(t) ||
    // "show me options / inventory"
    /\bshow\s+(me\s+)?(options|inventory|choices|what['']?s\s+available)\b/i.test(t)
  );
}

/**
 * H2.5: Deterministic property-browsing turn.
 *
 * Runs the `show_properties` workflow directly — bypassing the LLM intent
 * classifier in H7 and the full LLM in H9. This guarantees that property
 * listing requests never trigger spurious `human_escalated` stage transitions
 * due to LLM temperature or model-version drift.
 *
 * @param ctx - Turn runtime context.
 * @param visitCommit - Must not be committed.
 * @param liveCtx - Pre-fetched live lead context.
 * @param conversationStage - Current stage from the state machine.
 * @returns TurnResult or null if message is not a property-browsing intent.
 */
async function handlePropertyBrowsingTurn(
  ctx: BuyerTurnRuntimeContext,
  visitCommit: Awaited<ReturnType<typeof tryCommitCustomerVisitBooking>>,
  liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>,
  conversationStage: string,
): Promise<TurnResult | null> {
  if (visitCommit.committed || visitCommit.workflowSuggestion) return null;
  if (!isPropertyBrowsingIntent(ctx.input.messageText)) return null;

  logOutboundBranch('H2_5', 'whatsappTurnOrchestrator:propertyBrowsing', 'buyer_property_browse_fast_path', {
    messagePreview: ctx.input.messageText.slice(0, 40),
  });

  // DETERMINISTIC FAST-PATH: run availability_check directly — no LLM classifier.
  // classifyAndRunBuyerWorkflow routes through the LLM which can emit
  // human_escalated on temperature drift. For bare property-listing intent
  // we always want inventory search, so we skip straight to runWorkflow.
  const { runWorkflow } = await import('../workflow/workflow-engine.service');
  const buyerWorkflowRun = {
    toolContext: {
      userId: 'system',
      companyId: ctx.companyId,
      userRole: 'company_admin' as const,
      userName: 'System',
      channel: 'buyer' as const,
    },
    messageText: ctx.input.messageText,
    recentMessages: [],
    companyName: ctx.companyName,
    sessionLeadId: ctx.input.leadId,
    sessionVisitId: liveCtx.activeVisit?.visitId ?? null,
    channel: 'buyer' as const,
  };
  const workflowResult = await runWorkflow('availability_check', buyerWorkflowRun, {
    leadId: ctx.input.leadId,
    propertyId: ctx.input.conversationSelectedPropertyId ?? undefined,
    message: ctx.input.messageText,
  });

  const rawReply = workflowResult.reply?.trim();
  if (!rawReply) return null;

  const safeReply = stripBuyerInternalMetadata(rawReply);
  await prisma.message.create({
    data: { conversationId: ctx.input.conversationId, senderType: 'ai', content: safeReply, status: 'sent' },
  });

  const visitTime = resolveVisitTimeString(liveCtx.activeVisit?.scheduledAt);
  const components = resolveBuyerComponents({
    stage: conversationStage,
    outboundText: safeReply,
    propertyId: ctx.input.conversationSelectedPropertyId,
    hasActiveVisit: Boolean(liveCtx.activeVisit),
    visitStatus: liveCtx.activeVisit?.status,
    visitProperty: liveCtx.activeVisit?.propertyName ?? undefined,
    visitTime,
  });

  fireMemoryExtraction({
    leadId: ctx.input.leadId,
    messageText: ctx.input.messageText,
    outboundText: safeReply,
    workflowId: 'availability_check',
    liveCtx,
  });

  return { audience: 'buyer', handled: true, terminal: true, text: safeReply, components };
}

// ---------------------------------------------------------------------------
// H3: Memory recall
// ---------------------------------------------------------------------------

/**
 * Answers preference-recall queries without the LLM.
 *
 * @param ctx - Turn runtime context.
 * @param visitCommit - Pre-fetched visit commit result.
 * @returns TurnResult or null if not a memory recall query.
 */
async function handleMemoryRecallTurn(
  ctx: BuyerTurnRuntimeContext,
  visitCommit: Awaited<ReturnType<typeof tryCommitCustomerVisitBooking>>,
): Promise<TurnResult | null> {
  if (visitCommit.committed || visitCommit.workflowSuggestion) return null;

  const { isBuyerMemoryRecallQuery, buildBuyerMemoryRecallReply } = await import('../buyerMemoryRecall.service');
  if (!isBuyerMemoryRecallQuery(ctx.input.messageText)) return null;

  const memoryReply = await buildBuyerMemoryRecallReply(ctx.input.leadId);
  if (!memoryReply) return null;

  await prisma.message.create({
    data: { conversationId: ctx.input.conversationId, senderType: 'ai', content: memoryReply, status: 'sent' },
  });

  void import('../buyer-memory-extract.service').then(({ extractAndPatchLeadMemory }) =>
    extractAndPatchLeadMemory({ leadId: ctx.input.leadId, messageText: ctx.input.messageText, outboundText: memoryReply }),
  );

  return { audience: 'buyer', handled: true, terminal: true, text: memoryReply };
}

// ---------------------------------------------------------------------------
// H4: Qualification statement
// ---------------------------------------------------------------------------

/**
 * Acknowledges buyer requirement statements (budget, area, property type).
 *
 * @param ctx - Turn runtime context.
 * @param visitCommit - Pre-fetched visit commit result.
 * @returns TurnResult or null if not a qualification statement.
 */
async function handleQualificationTurn(
  ctx: BuyerTurnRuntimeContext,
  visitCommit: Awaited<ReturnType<typeof tryCommitCustomerVisitBooking>>,
): Promise<TurnResult | null> {
  if (visitCommit.committed || visitCommit.workflowSuggestion) return null;
  if (!shouldUseQualificationFastPath(ctx.input.messageText)) return null;

  const { isBuyerQualificationStatement, buildBuyerQualificationAckReply, patchLeadMemoryFromQualification } =
    await import('../buyerQualification.service');
  if (!isBuyerQualificationStatement(ctx.input.messageText)) return null;

  const delta = await patchLeadMemoryFromQualification(ctx.input.leadId, ctx.input.messageText);
  const qualReply = buildBuyerQualificationAckReply(delta);

  await prisma.message.create({
    data: { conversationId: ctx.input.conversationId, senderType: 'ai', content: qualReply, status: 'sent' },
  });

  void import('../buyer-memory-extract.service').then(({ extractAndPatchLeadMemory }) =>
    extractAndPatchLeadMemory({ leadId: ctx.input.leadId, messageText: ctx.input.messageText, outboundText: qualReply }),
  );

  return { audience: 'buyer', handled: true, terminal: true, text: qualReply };
}

// ---------------------------------------------------------------------------
// H5: Visit status query
// ---------------------------------------------------------------------------

async function handleCallCommitReplyTurn(
  ctx: BuyerTurnRuntimeContext,
  callCommit: Awaited<ReturnType<typeof tryCommitCustomerCallBooking>>,
  _visitCommit: Awaited<ReturnType<typeof tryCommitCustomerVisitBooking>>,
): Promise<TurnResult | null> {
  if (!callCommit.committed || !callCommit.customerReply) return null;

  await prisma.message.create({
    data: {
      conversationId: ctx.input.conversationId,
      senderType: 'ai',
      content: callCommit.customerReply,
      status: 'sent',
    },
  });

  const components = resolveBuyerComponents({
    stage: 'confirmation',
    outboundText: callCommit.customerReply,
    propertyId: ctx.input.conversationSelectedPropertyId,
    hasActiveCall: true,
    recentAction: 'confirmed',
  });

  return {
    audience: 'buyer',
    handled: true,
    terminal: true,
    text: callCommit.customerReply,
    components,
  };
}

/**
 * Deterministically resolves visit status without invoking the LLM.
 *
 * @param ctx - Turn runtime context.
 * @param visitCommit - Pre-fetched visit commit result.
 * @param liveCtx - Pre-fetched live lead context.
 * @returns TurnResult or null if not a visit status query.
 */
async function handleVisitStatusTurn(
  ctx: BuyerTurnRuntimeContext,
  visitCommit: Awaited<ReturnType<typeof tryCommitCustomerVisitBooking>>,
  liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>,
): Promise<TurnResult | null> {
  if (visitCommit.committed || visitCommit.workflowSuggestion) return null;
  if (!isBuyerVisitStatusQuery(ctx.input.messageText)) return null;

  const visitReply = await buildBuyerVisitStatusReply({
    leadId: ctx.input.leadId,
    companyId: ctx.companyId,
    companyName: ctx.companyName,
  });

  const visitTime = resolveVisitTimeString(liveCtx.activeVisit?.scheduledAt);
  const components = resolveBuyerComponents({
    stage: 'confirmation',
    outboundText: visitReply,
    propertyId: ctx.input.conversationSelectedPropertyId,
    hasActiveVisit: Boolean(liveCtx.activeVisit),
    visitStatus: liveCtx.activeVisit?.status,
    visitProperty: liveCtx.activeVisit?.propertyName ?? undefined,
    visitTime,
  });

  await prisma.message.create({
    data: { conversationId: ctx.input.conversationId, senderType: 'ai', content: visitReply, status: 'sent' },
  });

  await prisma.conversation.update({
    where: { id: ctx.input.conversationId },
    data: { stage: 'confirmation', escalationReason: null },
  });

  return { audience: 'buyer', handled: true, terminal: true, text: visitReply, components };
}

// ---------------------------------------------------------------------------
// H6: Visit-commit suggested workflow
// ---------------------------------------------------------------------------

/**
 * Runs the specific workflow recommended by the visit-commit state machine.
 *
 * @param ctx - Turn runtime context.
 * @param visitCommit - Must have workflowSuggestion set.
 * @param liveCtx - Pre-fetched live lead context.
 * @param conversationStage - Current stage.
 * @param selectedPropertyId - Currently selected property.
 * @returns TurnResult or null if no workflow suggestion.
 */
async function handleVisitCommitWorkflowTurn(
  ctx: BuyerTurnRuntimeContext,
  visitCommit: Awaited<ReturnType<typeof tryCommitCustomerVisitBooking>>,
  liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>,
  conversationStage: string,
  selectedPropertyId: string | null,
): Promise<TurnResult | null> {
  if (visitCommit.committed || !visitCommit.workflowSuggestion) return null;

  const { runWorkflow } = await import('../workflow/workflow-engine.service');
  const suggestedPropertyId =
    typeof visitCommit.workflowSuggestion.parameters.propertyId === 'string'
      ? visitCommit.workflowSuggestion.parameters.propertyId
      : selectedPropertyId;
  const wfResult = await runWorkflow(
    visitCommit.workflowSuggestion.workflowId,
    {
      toolContext: { userId: 'system', companyId: ctx.companyId, userRole: 'company_admin', userName: 'System', channel: 'buyer' },
      messageText: ctx.input.messageText,
      recentMessages: [],
      companyName: ctx.companyName,
      sessionLeadId: ctx.input.leadId,
      sessionVisitId: liveCtx.activeVisit?.visitId ?? null,
      channel: 'buyer',
    },
    visitCommit.workflowSuggestion.parameters,
  );

  if (!wfResult.reply?.trim()) return null;

  const safeReply = stripBuyerInternalMetadata(wfResult.reply);
  await prisma.message.create({
    data: { conversationId: ctx.input.conversationId, senderType: 'ai', content: safeReply, status: 'sent' },
  });
  if (suggestedPropertyId && suggestedPropertyId !== selectedPropertyId) {
    await prisma.conversation.update({
      where: { id: ctx.input.conversationId },
      data: { selectedPropertyId: suggestedPropertyId },
    }).catch(() => undefined);
  }

  const visitTime = resolveVisitTimeString(liveCtx.activeVisit?.scheduledAt);
  const components = resolveBuyerComponents({
    stage: conversationStage,
    outboundText: safeReply,
    propertyId: suggestedPropertyId,
    hasActiveVisit: Boolean(liveCtx.activeVisit),
    visitStatus: liveCtx.activeVisit?.status,
    visitProperty: liveCtx.activeVisit?.propertyName ?? undefined,
    visitTime,
  });

  fireMemoryExtraction({ leadId: ctx.input.leadId, messageText: ctx.input.messageText, outboundText: safeReply, workflowId: visitCommit.workflowSuggestion.workflowId, liveCtx });
  return { audience: 'buyer', handled: true, terminal: true, text: safeReply, components };
}

// ---------------------------------------------------------------------------
// H7: Classifier workflow
// ---------------------------------------------------------------------------

/**
 * Runs the LLM workflow classifier then executes the matched workflow.
 *
 * @param ctx - Turn runtime context.
 * @param visitCommit - Must not be committed.
 * @param liveCtx - Pre-fetched live lead context.
 * @param conversationStage - Current stage.
 * @param selectedPropertyId - Currently selected property.
 * @returns TurnResult or null if no workflow matched.
 */
async function handleClassifierWorkflowTurn(
  ctx: BuyerTurnRuntimeContext,
  visitCommit: Awaited<ReturnType<typeof tryCommitCustomerVisitBooking>>,
  liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>,
  conversationStage: string,
  selectedPropertyId: string | null,
): Promise<TurnResult | null> {
  if (visitCommit.committed) return null;
  if (ctx.input.interactiveId?.trim()) return null;
  if (shouldDeferToFullAiForExtraction(ctx.input.messageText)) return null;

  const resolvedPropertyId = await resolveBuyerPropertyReference({
    companyId: ctx.companyId,
    messageText: ctx.input.messageText,
    selectedPropertyId,
    recommendedPropertyIds: ctx.input.conversationRecommendedPropertyIds,
  });

  const { classifyAndRunBuyerWorkflow } = await import('../workflow/workflow-engine.service');
  const workflowReply = await classifyAndRunBuyerWorkflow({
    companyId: ctx.companyId,
    leadId: ctx.input.leadId,
    messageText: ctx.input.messageText,
    propertyId: resolvedPropertyId ?? undefined,
    companyName: ctx.companyName,
    sessionVisitId: liveCtx.activeVisit?.visitId ?? null,
    activeVisit: liveCtx.activeVisit
      ? { visitId: liveCtx.activeVisit.visitId, propertyName: liveCtx.activeVisit.propertyName }
      : null,
  });

  if (!workflowReply?.trim()) return null;

  const safeReply = stripBuyerInternalMetadata(workflowReply);
  await prisma.message.create({
    data: { conversationId: ctx.input.conversationId, senderType: 'ai', content: safeReply, status: 'sent' },
  });
  if (resolvedPropertyId && resolvedPropertyId !== selectedPropertyId) {
    await prisma.conversation.update({
      where: { id: ctx.input.conversationId },
      data: { selectedPropertyId: resolvedPropertyId },
    }).catch(() => undefined);
  }

  const visitTime = resolveVisitTimeString(liveCtx.activeVisit?.scheduledAt);
  const components = resolveBuyerComponents({
    stage: conversationStage,
    outboundText: safeReply,
    propertyId: resolvedPropertyId,
    hasActiveVisit: Boolean(liveCtx.activeVisit),
    visitStatus: liveCtx.activeVisit?.status,
    visitProperty: liveCtx.activeVisit?.propertyName ?? undefined,
    visitTime,
  });

  fireMemoryExtraction({ leadId: ctx.input.leadId, messageText: ctx.input.messageText, outboundText: safeReply, workflowId: undefined, liveCtx });
  return { audience: 'buyer', handled: true, terminal: true, text: safeReply, components };
}

// ---------------------------------------------------------------------------
// H8: Visit commit reply
// ---------------------------------------------------------------------------

/**
 * Sends the customer-facing reply when tryCommitCustomerVisitBooking succeeds.
 *
 * @param ctx - Turn runtime context.
 * @param visitCommit - Must be committed with a customerReply.
 * @param liveCtx - Pre-fetched live lead context.
 * @returns TurnResult or null if visit was not committed.
 */
async function handleVisitCommitReplyTurn(
  ctx: BuyerTurnRuntimeContext,
  visitCommit: Awaited<ReturnType<typeof tryCommitCustomerVisitBooking>>,
  liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>,
): Promise<TurnResult | null> {
  if (!visitCommit.committed || !visitCommit.customerReply) return null;

  await prisma.message.create({
    data: { conversationId: ctx.input.conversationId, senderType: 'ai', content: visitCommit.customerReply, status: 'sent' },
  });

  if (visitCommit.scheduledAt) {
    await prisma.conversation.update({
      where: { id: ctx.input.conversationId },
      data: {
        stage: visitCommit.mode === 'scheduled' || visitCommit.mode === 'rescheduled' ? 'confirmation' : 'visit_booking',
        proposedVisitTime: visitCommit.scheduledAt,
        commitments: { visitSlotDiscussed: true, visitSlotConfirmed: visitCommit.mode === 'scheduled' || visitCommit.mode === 'rescheduled' },
      },
    });
  }

  if (visitCommit.leadStatus === 'visit_scheduled') {
    await transitionLeadToVisitScheduled(ctx.input.leadId);
  }

  void import('../clientMemory.service').then(({ syncLeadClientMemory }) => syncLeadClientMemory(ctx.input.leadId));

  await logAgentAction({
    companyId: ctx.companyId,
    triggeredBy: 'inbound_message',
    action:
      visitCommit.mode === 'rescheduled'
        ? 'workflow_reschedule_visit'
        : visitCommit.mode === 'cancelled'
          ? 'workflow_cancel_visit'
          : 'customerVisitBooked',
    resourceType: 'lead',
    resourceId: ctx.input.leadId,
    status: 'success',
    inputs: {
      mode: visitCommit.mode,
      visitId: visitCommit.visitId,
      scheduledAt: visitCommit.scheduledAt?.toISOString(),
    },
  });

  fireMemoryExtraction({
    leadId: ctx.input.leadId,
    messageText: ctx.input.messageText,
    outboundText: visitCommit.customerReply,
    workflowId:
      visitCommit.mode === 'cancelled'
        ? 'cancel_visit'
        : visitCommit.mode === 'rescheduled'
          ? 'reschedule_visit'
          : 'schedule_visit',
    liveCtx,
    visitCommit: {
      committed: true,
      visitId: visitCommit.visitId,
      scheduledAt: visitCommit.scheduledAt,
      mode: visitCommit.mode,
      propertyName: liveCtx.activeVisit?.propertyName ?? null,
    },
  });

  return { audience: 'buyer', handled: true, terminal: true, text: visitCommit.customerReply };
}

// ---------------------------------------------------------------------------
// H9: Full AI brain
// ---------------------------------------------------------------------------

/**
 * Full LLM response path - always produces a result.
 * Enforces one-outbound-per-turn: text + at most one interactive + at most one media.
 *
 * @param ctx - Turn runtime context.
 * @param visitCommit - Pre-fetched visit commit result.
 * @param liveCtx - Pre-fetched live lead context.
 * @param conversationState - Full state machine snapshot.
 * @returns TurnResult - always handled.
 */
async function handleFullAiTurn(
  ctx: BuyerTurnRuntimeContext,
  visitCommit: Awaited<ReturnType<typeof tryCommitCustomerVisitBooking>>,
  callCommit: Awaited<ReturnType<typeof tryCommitCustomerCallBooking>>,
  liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>,
  conversationState: ConversationState,
): Promise<TurnResult> {
  if (callCommit.committed && callCommit.customerReply) {
    const replay = await handleCallCommitReplyTurn(ctx, callCommit, visitCommit);
    if (replay) return replay;
  }

  const aiSettings = await prisma.aiSetting.findUnique({ where: { companyId: ctx.companyId } });

  const lead = await prisma.lead.findUnique({
    where: { id: ctx.input.leadId },
    select: {
      id: true, customerName: true, phone: true, language: true, status: true,
      assignedAgentId: true, budgetMin: true, budgetMax: true,
      locationPreference: true, propertyType: true,
    },
  });
  if (!lead) {
    throw new Error(`Lead not found for buyer turn: ${ctx.input.leadId}`);
  }

  const neverSayNoCtx = await buildNeverSayNoContext(
    ctx.companyId,
    criteriaFromLead({
      companyId: ctx.companyId,
      budgetMin: lead.budgetMin,
      budgetMax: lead.budgetMax,
      locationPreference: lead.locationPreference,
      propertyType: lead.propertyType,
    }),
    {
      customerMessage: ctx.input.messageText,
      customerName: lead.customerName,
      language: lead.language,
    },
  );

  const resolvedPropertyId = await resolveBuyerPropertyReference({
    companyId: ctx.companyId,
    messageText: ctx.input.messageText,
    selectedPropertyId: ctx.input.conversationSelectedPropertyId,
    recommendedPropertyIds: ctx.input.conversationRecommendedPropertyIds,
  });

  const propertyIdSet = [
    ...new Set([
      ...neverSayNoCtx.exactPropertyIds,
      ...neverSayNoCtx.alternativePropertyIds,
      ...(resolvedPropertyId ? [resolvedPropertyId] : []),
    ]),
  ];
  const rawProperties =
    propertyIdSet.length > 0
      ? await prisma.property.findMany({ where: { companyId: ctx.companyId, id: { in: propertyIdSet } } })
      : await prisma.property.findMany({ where: { companyId: ctx.companyId, status: 'available' }, take: 20 });

  let allRawProperties = rawProperties;
  if (resolvedPropertyId && !rawProperties.some((p) => p.id === resolvedPropertyId)) {
    const focusedRow = await prisma.property.findFirst({
      where: { id: resolvedPropertyId, companyId: ctx.companyId },
    });
    if (focusedRow) {
      allRawProperties = [focusedRow, ...rawProperties];
    }
  }

  let aiProperties = allRawProperties.map(propertyToAiPromptInput);
  aiProperties = await enrichAiPropertiesFromKnowledge(
    ctx.companyId,
    aiProperties,
    getPropertyKnowledgeForProperty,
  );
  const focusedAiProperty = resolvedPropertyId
    ? aiProperties.find((p) => p.id === resolvedPropertyId)
    : undefined;
  const focusedPropertyBlock = focusedAiProperty
    ? buildFocusedPropertyPromptBlock(focusedAiProperty)
    : undefined;

  const properties: PropertySummary[] = allRawProperties.map((p) => ({
    id: p.id,
    name: p.name,
    brochureUrl: p.brochureUrl,
    images: Array.isArray(p.images) ? (p.images as string[]) : undefined,
  }));

  const customerMessageCount = ctx.history.filter((m) => m.senderType === 'customer').length + 1;

  let conversationContextBlock = '';
  try {
    const { buildConversationContextBlock } = await import('../conversation-summary.service');
    conversationContextBlock = await buildConversationContextBlock(ctx.input.conversationId, ctx.input.leadId, ctx.companyId);
  } catch (err: unknown) {
    logger.warn('Conversation context block skipped', {
      leadId: ctx.input.leadId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logOutboundBranch('H9', 'whatsappTurnOrchestrator:aiPath', 'buyer_ai_service_path', {
    historyCount: ctx.history.length,
    stage: conversationState.stage,
  });

  const aiResponse = await Promise.race([
    aiService.generateResponse({
      companyId: ctx.companyId,
      customerMessage: ctx.input.messageText,
      conversationHistory: ctx.history,
      lead,
      properties: aiProperties,
      aiSettings: aiSettings || {},
      companyName: ctx.companyName,
      conversationState,
      conversionPromptBlock: neverSayNoCtx.promptBlock,
      neverSayNoFallbackCta: neverSayNoCtx.fallbackCta,
      neverSayNoHasAlternatives: neverSayNoCtx.hasInventoryAlternatives,
      customerMessageCount,
      conversationId: ctx.input.conversationId,
      conversationContextBlock,
      liveLeadContextBlock: liveCtx.promptBlock || undefined,
      activeVisit: liveCtx.activeVisit,
      messageId: ctx.messageId,
      extractedDateTime: extractDateTimeIso(ctx.input.messageText) ?? undefined,
      focusedPropertyBlock,
      focusedPropertyId: resolvedPropertyId ?? undefined,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AI response timed out after 28s')), 28_000),
    ),
  ]);

  const groundedProperties = allRawProperties.map((p) => propertyToCompletenessInput(p));
  const groundedFactsBlock = buildGroundedFactsBlock(groundedProperties, neverSayNoCtx.promptBlock);

  let outboundCandidate = aiResponse.text;

  if (isVisitCancelOrRescheduleMessage(ctx.input.messageText) && !visitCommit.committed && liveCtx.activeVisit) {
    const { formatDateIST } = await import('../agent/tools/format-helpers');
    outboundCandidate =
      `I found your visit for *${liveCtx.activeVisit.propertyName ?? 'your property'}* ` +
      `on ${formatDateIST(new Date(liveCtx.activeVisit.scheduledAt))}. ` +
      `What date and time should we move it to? (e.g. "this Saturday 11am")`;
  }

  const hasPriorOutbound = ctx.history.some((m) => m.senderType === 'ai' || m.senderType === 'agent');
  const selectedPropertyName =
    allRawProperties.find((p) => p.id === (resolvedPropertyId ?? ctx.input.conversationSelectedPropertyId))?.name
    ?? null;

  let outboundText = await sanitizeBuyerOutbound({
    text: outboundCandidate,
    hasInventoryAlternatives: neverSayNoCtx.hasInventoryAlternatives,
    fallbackCta: neverSayNoCtx.fallbackCta,
    groundedProperties,
    conversionPromptBlock: neverSayNoCtx.promptBlock,
    skipFallbackCta:
      conversationState.commitments.visitSlotDiscussed ||
      conversationState.commitments.visitSlotConfirmed ||
      conversationState.stage === 'visit_booking' ||
      conversationState.stage === 'confirmation' ||
      isVisitSchedulingMessage(ctx.input.messageText) ||
      isVisitCancelOrRescheduleMessage(ctx.input.messageText),
    groundedFactsBlock,
    language: aiResponse.detectedLanguage,
    companyName: ctx.companyName,
    turnContext: { visitCommitted: visitCommit.committed, workflowSuccess: false },
    bannedPhraseContext: {
      hasPriorOutbound,
      stage: conversationState.stage,
    },
    activeVisit: liveCtx.activeVisit
      ? {
          propertyName: liveCtx.activeVisit.propertyName,
          scheduledAt: liveCtx.activeVisit.scheduledAt,
          status: liveCtx.activeVisit.status,
        }
      : null,
    selectedPropertyName,
  });

  if (!outboundText.trim()) {
    outboundText = resolveEmptyOutboundFallback(ctx.input.messageText, liveCtx.activeVisit);
  }

  const brochureResolution = await resolveTurnBrochure({
    customerMessage: ctx.input.messageText,
    aiText: outboundText,
    properties: properties.map((p) => ({ id: p.id, name: p.name, brochureUrl: p.brochureUrl ?? null })),
  });
  outboundText = brochureResolution.cleanedText;
  const propertyContextPatch = inferBuyerPropertyContextFromOutbound({
    outboundText,
    properties: properties.map((p) => ({ id: p.id, name: p.name })),
  });

  await prisma.message.create({
    data: {
      conversationId: ctx.input.conversationId,
      senderType: 'ai',
      content: outboundText,
      language: aiResponse.detectedLanguage,
      status: 'sent',
    },
  });

  if (aiResponse.newState) {
    await persistNewConversationState(ctx, aiResponse, lead);
  }

  if (propertyContextPatch.recommendedPropertyIds?.length) {
    await prisma.conversation.update({
      where: { id: ctx.input.conversationId },
      data: {
        recommendedPropertyIds: propertyContextPatch.recommendedPropertyIds,
        selectedPropertyId: propertyContextPatch.selectedPropertyId ?? null,
      },
    });
  }

  if (aiResponse.detectedLanguage && aiResponse.detectedLanguage !== lead.language) {
    await prisma.lead.update({ where: { id: lead.id }, data: { language: aiResponse.detectedLanguage } });
    await prisma.conversation.update({ where: { id: ctx.input.conversationId }, data: { language: aiResponse.detectedLanguage } });
  }

  if (aiResponse.extractedInfo) {
    await applyExtractedLeadInfo(lead.id, aiResponse.extractedInfo);
  }

  if (lead.status === 'new') {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'contacted' } });
  }

  const recentAction = resolveRecentAction(visitCommit);
  const hasPropertyContextPatch = Boolean(propertyContextPatch.recommendedPropertyIds?.length);
  const componentPropertyId = hasPropertyContextPatch
    ? propertyContextPatch.selectedPropertyId
    : aiResponse.newState?.selectedPropertyId ?? ctx.input.conversationSelectedPropertyId;
  const componentRecommendedPropertyIds = hasPropertyContextPatch
    ? propertyContextPatch.recommendedPropertyIds
    : aiResponse.newState?.recommendedProperties;
  const interactiveComponents = aiResponse.newState?.stage
    ? resolveBuyerComponents({
        stage: aiResponse.newState.stage,
        outboundText,
        nextAction: aiResponse.nextAction,
        recentAction,
        sentPropertyFilters: false,
        propertyId: componentPropertyId,
        recommendedPropertyIds: componentRecommendedPropertyIds,
        properties: properties.map((p) => ({ id: p.id, name: p.name })),
        hasActiveVisit: Boolean(liveCtx.activeVisit),
        visitStatus: liveCtx.activeVisit?.status,
        visitProperty: liveCtx.activeVisit?.propertyName ?? undefined,
        visitTime: resolveVisitTimeString(liveCtx.activeVisit?.scheduledAt),
      })
    : [];

  const heroMedia = resolveHeroMediaComponent(
    properties,
    brochureResolution,
    aiResponse.newState?.stage ?? conversationState.stage,
  );

  const components = enforceTurnComponentBudget([
    ...interactiveComponents,
    ...(heroMedia ? [heroMedia] : []),
  ]);

  fireMemoryExtraction({
    leadId: ctx.input.leadId,
    messageText: ctx.input.messageText,
    outboundText,
    workflowId: undefined,
    liveCtx,
    aiExtractedInfo: aiResponse.extractedInfo ?? null,
  });

  logger.info('AI response generated', {
    conversationId: ctx.input.conversationId,
    stage: aiResponse.newState?.stage,
    action: aiResponse.nextAction?.action,
    hasMedia: Boolean(heroMedia),
  });

  return { audience: 'buyer', handled: true, terminal: true, text: outboundText, components };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Formats a scheduledAt timestamp into IST locale string.
 *
 * @param scheduledAt - Raw date value (may be undefined).
 * @returns Formatted string or undefined if no date.
 */
function resolveVisitTimeString(scheduledAt: unknown): string | undefined {
  if (!scheduledAt) return undefined;
  const date = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt as string);
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Resolves the recentAction flag for the button policy.
 *
 * @param visitCommit - Result from tryCommitCustomerVisitBooking.
 * @returns 'cancelled', 'rescheduled', or undefined.
 */
function resolveRecentAction(
  visitCommit: Awaited<ReturnType<typeof tryCommitCustomerVisitBooking>>,
): import('../../utils/contextQuickReplies.util').QuickReplyRecentAction | undefined {
  if (!visitCommit.committed) return undefined;
  if (visitCommit.mode === 'cancelled') return 'cancelled';
  if (visitCommit.mode === 'rescheduled' || visitCommit.mode === 'scheduled') return 'rescheduled';
  return undefined;
}

/**
 * Returns a context-aware fallback when the AI produces empty output.
 *
 * @param messageText - Original buyer message.
 * @param activeVisit - Current active visit if any.
 * @returns A non-empty fallback string.
 */
function resolveEmptyOutboundFallback(
  messageText: string,
  activeVisit: { propertyName?: string | null } | undefined | null,
): string {
  if (activeVisit) return `I'm looking into your visit details, one moment.`;
  if (isVisitCancelOrRescheduleMessage(messageText)) return `I couldn't find an upcoming visit to change. Would you like to book a new visit?`;
  return `Sorry, I had a brief issue. Could you repeat that?`;
}

function shouldUseQualificationFastPath(messageText: string): boolean {
  return !isRichBuyerRequirementRequest(messageText);
}

function shouldDeferToFullAiForExtraction(messageText: string): boolean {
  if (isVisitActionRequest(messageText)) return false;
  if (!isRichBuyerRequirementRequest(messageText)) return false;
  if (isVisitSchedulingMessage(messageText) || isVisitCancelOrRescheduleMessage(messageText)) return false;
  return true;
}

function isVisitActionRequest(messageText: string): boolean {
  return (
    /\b(book|schedule|arrange)\b[\s\S]{0,80}\b(site\s*)?visit\b/i.test(messageText)
    || /\b(site\s*)?visit\b[\s\S]{0,80}\b(book|schedule|arrange)\b/i.test(messageText)
    || /\b(book|schedule|arrange)\b[\s\S]{0,80}\bappointment\b/i.test(messageText)
  );
}

function isRichBuyerRequirementRequest(messageText: string): boolean {
  return /^\s*i\s+(want|need|am looking for|am searching for|would like)\b/i.test(messageText);
}

async function resolveTurnBrochure(input: {
  customerMessage: string;
  aiText: string;
  properties: Array<{ id: string; name: string; brochureUrl: string | null }>;
}): Promise<{
  cleanedText: string;
  mediaComponent: { kind: 'media'; url: string; mime: string; caption?: string } | null;
}> {
  const brochureModule = await import('../brochureDelivery.service');
  if (typeof brochureModule.resolveBrochureForAiTurn !== 'function') {
    return { cleanedText: input.aiText, mediaComponent: null };
  }
  return brochureModule.resolveBrochureForAiTurn(input);
}

/**
 * Normalises a raw property type string to an allowlisted value.
 *
 * @param value - Raw string from AI extraction.
 * @returns Normalised value or undefined if not recognised.
 */
function normalizeLeadPropertyType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const ALLOWED = ['apartment', 'villa', 'plot', 'commercial', 'office', 'shop', 'penthouse', 'studio'];
  const lower = value.toLowerCase();
  return ALLOWED.find((t) => lower.includes(t));
}

/**
 * Applies AI-extracted lead info to the lead row.
 *
 * @param leadId - Lead to update.
 * @param info - Key-value map from aiResponse.extractedInfo.
 */
async function applyExtractedLeadInfo(
  leadId: string,
  info: {
    budget_min?: number;
    budget_max?: number;
    location_preference?: string;
    property_type?: string;
    customer_name?: string;
  },
): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (info.budget_min != null) updates.budgetMin = info.budget_min;
  if (info.budget_max != null) updates.budgetMax = info.budget_max;
  if (info.location_preference) updates.locationPreference = info.location_preference;
  const normalizedPropertyType = normalizeLeadPropertyType(info.property_type);
  if (normalizedPropertyType) updates.propertyType = normalizedPropertyType;
  if (info.customer_name) updates.customerName = info.customer_name;
  if (Object.keys(updates).length > 0) {
    await prisma.lead.update({ where: { id: leadId }, data: updates });
  }
}

/**
 * Persists the new state machine state produced by the AI to the DB.
 * Also fires lead score sync, status transition, and escalation notification.
 *
 * @param ctx - Turn context.
 * @param aiResponse - AI service response.
 * @param lead - Lead record.
 */
async function persistNewConversationState(
  ctx: BuyerTurnRuntimeContext,
  aiResponse: Awaited<ReturnType<typeof aiService.generateResponse>>,
  lead: { id: string; customerName: string | null; phone: string; assignedAgentId: string | null },
): Promise<void> {
  const newState = { ...aiResponse.newState! };
  const { isAllowedStageTransition } = await import('../conversationStateMachine');
  const currentStage = ctx.input.conversationStage as import('../conversationStateMachine').ConversationStage;
  if (!isAllowedStageTransition(currentStage, newState.stage, ctx.input.messageText)) {
    logger.warn('Blocked LLM stage regression', { from: currentStage, to: newState.stage });
    newState.stage = currentStage;
  }
  await prisma.conversation.update({
    where: { id: ctx.input.conversationId },
    data: {
      stage: newState.stage,
      stageEnteredAt: newState.stageEnteredAt,
      stageMessageCount: newState.messageCount,
      commitments: newState.commitments as unknown as Prisma.InputJsonValue,
      objectionCount: newState.objectionCount,
      lastObjectionType: newState.lastObjectionType,
      consecutiveObjections: newState.consecutiveObjections,
      urgencyScore: newState.urgencyScore,
      valueScore: newState.valueScore,
      escalationReason: newState.escalationReason,
      recommendedPropertyIds: newState.recommendedProperties as string[],
      selectedPropertyId: newState.selectedPropertyId,
      proposedVisitTime: newState.proposedVisitTime,
      ...(newState.stage === 'human_escalated' && { status: 'agent_active', escalatedAt: new Date(), aiEnabled: false }),
    },
  });

  await syncLeadScoreFromConversation(ctx.input.leadId, newState.urgencyScore, newState.valueScore);

  if (aiResponse.nextAction?.suggestedLeadStatus) {
    await transitionLeadStatus(ctx.input.leadId, aiResponse.nextAction.suggestedLeadStatus, { force: true });
  }

  if (newState.stage === 'human_escalated' && lead.assignedAgentId) {
    await persistEscalationNotification(ctx.companyId, lead, newState, ctx.input.conversationId);
  }

  if (newState.stage === 'human_escalated') {
    await logAgentAction({
      companyId: ctx.companyId,
      triggeredBy: 'inbound_message',
      action: 'workflow_escalate_to_human',
      resourceType: 'lead',
      resourceId: ctx.input.leadId,
      status: 'success',
      inputs: {
        reason: newState.escalationReason ?? null,
        conversationId: ctx.input.conversationId,
      },
    });
  }
}

/**
 * Fire-and-forget memory extraction.
 *
 * @param input - Memory extraction inputs.
 */
function fireMemoryExtraction(input: {
  leadId: string;
  messageText: string;
  outboundText: string;
  workflowId: string | undefined;
  liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>;
  visitCommit?: { committed: boolean; visitId?: string | null; scheduledAt?: Date | null; mode?: string; propertyName?: string | null };
  aiExtractedInfo?: Record<string, unknown> | null;
}): void {
  void import('../buyer-memory-extract.service').then(({ extractAndPatchLeadMemory, inferBuyerWorkflowIdFromMessage }) =>
    extractAndPatchLeadMemory({
      leadId: input.leadId,
      messageText: input.messageText,
      outboundText: input.outboundText,
      aiExtractedInfo: input.aiExtractedInfo ?? null,
      workflowId: input.workflowId ?? inferBuyerWorkflowIdFromMessage(input.messageText),
      visitCommit: input.visitCommit,
      liveCtx: input.liveCtx.activeVisit
        ? { activeVisit: { visitId: input.liveCtx.activeVisit.visitId, propertyName: input.liveCtx.activeVisit.propertyName, scheduledAt: input.liveCtx.activeVisit.scheduledAt, status: input.liveCtx.activeVisit.status } }
        : null,
    }),
  );
}

/**
 * Persists an escalation notification to the DB.
 *
 * @param companyId - Company identifier.
 * @param lead - Lead record.
 * @param newState - New conversation state.
 * @param conversationId - Conversation being escalated.
 */
async function persistEscalationNotification(
  companyId: string,
  lead: { id: string; customerName: string | null; phone: string; assignedAgentId: string | null },
  newState: { escalationReason?: string | null; valueScore?: number },
  conversationId: string,
): Promise<void> {
  if (lead.assignedAgentId) {
    await prisma.notification.create({
      data: {
        companyId,
        userId: lead.assignedAgentId,
        type: 'agent_takeover',
        title: 'AI Escalation - Human Agent Needed',
        message: `Lead ${lead.customerName || lead.phone} escalated: ${newState.escalationReason}`,
        data: { leadId: lead.id, conversationId, reason: newState.escalationReason, valueScore: newState.valueScore },
      },
    });
  } else {
    // No assigned agent — notify all company admins so escalation is never silently lost.
    const admins = await prisma.user.findMany({
      where: { companyId, role: 'company_admin', status: 'active' },
      select: { id: true },
    });
    await Promise.all(
      admins.map((admin) =>
        prisma.notification.create({
          data: {
            companyId,
            userId: admin.id,
            type: 'agent_takeover',
            title: 'AI Escalation — Unassigned Lead',
            message: `Lead ${lead.customerName || lead.phone} escalated: ${newState.escalationReason}`,
            data: { leadId: lead.id, conversationId, reason: newState.escalationReason, valueScore: newState.valueScore },
          },
        }),
      ),
    );
  }
}

/**
 * Formats operator contact details into a plain-text handoff line.
 *
 * @param operatorContact - Raw DB JSON value.
 * @returns Formatted string or null.
 */
function buildOperatorHandoffLine(operatorContact: unknown): string | null {
  if (!operatorContact || typeof operatorContact !== 'object' || Array.isArray(operatorContact)) return null;
  const contact = operatorContact as Record<string, unknown>;
  const name = typeof contact.name === 'string' ? contact.name.trim() : '';
  const phone = typeof contact.phone === 'string' ? contact.phone.trim() : '';
  if (!name && !phone) return null;
  if (name && phone) return `You can also reach *${name}* directly at ${phone}.`;
  if (name) return `You can also reach *${name}* for assistance.`;
  return `You can also call us at ${phone}.`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Central buyer turn orchestrator.
 *
 * Calls handlers H1-H9 in cascade, returning on first match.
 * Guarantees one-outbound-per-turn: at most one interactive + at most one media per turn.
 *
 * Caller (whatsapp.service.ts) is responsible for:
 * - claimOutboundAiReply before dispatching
 * - simulateHumanReplyPacing before the primary send
 * - sendTurnResult(to, result, config) to dispatch
 *
 * @param ctx - Full runtime context for this turn.
 * @param conversationState - State machine snapshot from the DB.
 * @returns A fully-resolved TurnResult ready for dispatch.
 */
export async function orchestrateWhatsAppBuyerTurn(
  ctx: BuyerTurnRuntimeContext,
  conversationState: ConversationState,
): Promise<TurnResult> {
  // H1 must run before any booking commits — human takeover is terminal and must
  // never trigger side-effect DB mutations for a conversation owned by a live agent.
  const h1 = await handleHumanTakeoverTurn(ctx);
  if (h1) return h1;

  const h0 = await handleInteractiveSafetyTurn(ctx);
  if (h0) return h0;

  const recentCustomerMessages = ctx.history
    .filter((m) => m.senderType === 'customer')
    .map((m) => m.content)
    .slice(-7);

  const visitCommit = await tryCommitCustomerVisitBooking({
    companyId: ctx.companyId,
    lead: {
      id: ctx.input.leadId,
      assignedAgentId: ctx.input.leadAssignedAgentId,
      customerName: ctx.input.leadCustomerName,
      status: ctx.input.leadStatus,
    },
    conversation: {
      id: ctx.input.conversationId,
      selectedPropertyId: ctx.input.conversationSelectedPropertyId,
      proposedVisitTime: ctx.input.conversationProposedVisitTime,
      recommendedPropertyIds: [...ctx.input.conversationRecommendedPropertyIds],
    },
    customerMessage: ctx.input.messageText,
    customerPhone: ctx.customerPhone,
    recentCustomerMessages,
  });

  const liveCtx = await getLiveLeadContext(ctx.input.leadId, ctx.companyId);

  // Rapport/dismissal before call commit — bare "Hi" must not fall through to LLM greeting templates.
  const h1b = await handleDismissalTurn(ctx, visitCommit);
  if (h1b) return h1b;

  const h2 = await handleRapportTurn(ctx, visitCommit, conversationState.stage);
  if (h2) return h2;

  const h2b = await handleReturningBuyerPivotTurn(ctx, visitCommit);
  if (h2b) return h2b;

  // H2.5 must run BEFORE callCommit and H3-H7 so property-browsing intents
  // never reach the LLM (H9) where temperature variance causes spurious escalation.
  const h2_5 = await handlePropertyBrowsingTurn(ctx, visitCommit, liveCtx, conversationState.stage);
  if (h2_5) return h2_5;

  const callCommit = await tryCommitCustomerCallBooking({
    companyId: ctx.companyId,
    customerMessage: ctx.input.messageText,
    conversationId: ctx.input.conversationId,
    lead: { id: ctx.input.leadId, assignedAgentId: ctx.input.leadAssignedAgentId },
    interactiveId: ctx.input.interactiveId,
  });

  const hCall = await handleCallCommitReplyTurn(ctx, callCommit, visitCommit);
  if (hCall) return hCall;

  const h3 = await handleMemoryRecallTurn(ctx, visitCommit);
  if (h3) return h3;

  const h4 = await handleQualificationTurn(ctx, visitCommit);
  if (h4) return h4;

  const h5 = await handleVisitStatusTurn(ctx, visitCommit, liveCtx);
  if (h5) return h5;

  const h6 = await handleVisitCommitWorkflowTurn(ctx, visitCommit, liveCtx, conversationState.stage, ctx.input.conversationSelectedPropertyId);
  if (h6) return h6;

  const h7 = await handleClassifierWorkflowTurn(ctx, visitCommit, liveCtx, conversationState.stage, ctx.input.conversationSelectedPropertyId);
  if (h7) return h7;

  // H7b: Bare visit intent with no date/time — ask the buyer instead of falling to LLM escalation.
  // Fires only when isVisitActionRequest() is true but visitCommit was not committed (no time parsed).
  if (!visitCommit.committed && isVisitActionRequest(ctx.input.messageText)) {
    const askReply = `Great! I'd love to arrange a site visit for you. 😊\n\nCould you share your *preferred date and time*? For example: "Saturday 11am" or "Tuesday 3pm".`;
    await prisma.message.create({
      data: { conversationId: ctx.input.conversationId, senderType: 'ai', content: askReply, status: 'sent' },
    });
    await prisma.conversation.update({
      where: { id: ctx.input.conversationId },
      data: { stage: 'visit_booking', stageEnteredAt: new Date() },
    }).catch(() => undefined);
    return { audience: 'buyer', handled: true, terminal: true, text: askReply };
  }

  const h8 = await handleVisitCommitReplyTurn(ctx, visitCommit, liveCtx);
  if (h8) return h8;

  return handleFullAiTurn(ctx, visitCommit, callCommit, liveCtx, conversationState);
}

// ---------------------------------------------------------------------------
// Test / policy helpers
// ---------------------------------------------------------------------------

/** Build rapport TurnResult without DB writes (unit tests). */
export async function buildBuyerRapportTurnResult(input: {
  companyName: string;
  messageText: string;
  hasPriorOutbound: boolean;
  stage: string;
  locationPreference?: string | null;
}): Promise<TurnResult | null> {
  const { isBuyerRapportMessage, isReturningBuyerGreeting, buildBuyerRapportReply } =
    await import('../buyerQualification.service');

  const rapportCtx = { hasPriorOutbound: input.hasPriorOutbound };
  if (!isBuyerRapportMessage(input.messageText, rapportCtx)) return null;

  const isReturning = isReturningBuyerGreeting(input.messageText, rapportCtx);
  const text = stripBuyerInternalMetadata(
    buildBuyerRapportReply(input.companyName, {
      isReturning,
      locationPreference: input.locationPreference,
    }),
  );

  const components = isReturning
    ? []
    : resolveBuyerComponents({
        stage: input.stage,
        outboundText: text,
        isReturningGreeting: false,
      });

  return { audience: 'buyer', handled: true, terminal: true, text, components };
}

