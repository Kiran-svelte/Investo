import { Prisma } from '@prisma/client';
import config from '../../config';
import type { TurnResult, WhatsAppComponent, BuyerTurnInput } from '../../types/whatsapp-turn.types';
import { conversationStateManager, type ConversationState } from '../conversationStateMachine';
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
import {
  isShortVisitConfirmation,
  isVisitCancelOrRescheduleMessage,
  isVisitSchedulingMessage,
  parseCustomVisitSlotFromMessage,
  parseVisitDateTimeFromHistory,
  parseVisitDateTimeFromMessage,
} from '../visitIntentFromMessage.service';
import { applyVisitMutationFromChat } from '../visitMutationFromChat.service';
import { buildSafeBuyerFallback } from '../../utils/safeBuyerFallback.util';
import { resolveFirstPropertyHeroMediaComponent } from '../brochureDelivery.service';
import {
  buildAdvancedReturningReply,
  buildPostVisitWelcomeReply,
  isAdvancedLeadStatus,
  isPostVisitBuyer,
  resolveStageFromLeadStatus,
  resolveStageAfterHumanEscalationReset,
} from '../../utils/buyerLeadProgress.util';
import { isFeatureEnabledForLead } from '../../utils/featureRollout.util';
import { shadowCompare } from '../../utils/featureShadow.util';
import { loadBuyerAiSettings } from '../../utils/buyerAiSettings.util';
import { resolveBuyerLanguage, normalizeBuyerLang } from '../../utils/buyerI18n.util';
import { isMultilingualBrowseIntent } from '../../utils/buyerBrowseIntent.util';
import { mergeGreetingMediaComponents } from '../../utils/greetingMedia.util';
import { shouldElevateReturningBuyerStage } from '../../utils/fixMdFeatures.util';
import {
  getBuyerLlmTimeoutMs,
  resolveDefaultReplyPacing,
  resolveLlmReplyPacing,
  shouldSkipHeavyBuyerContext,
} from '../../utils/whatsappReplySpeed.util';
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
import {
  buildBuyerStartFreshReply,
  isBuyerStartCommand,
  resetBuyerBookingAndConversationState,
} from '../buyer/buyerStartFresh.service';
import {
  buildDiscoveryButtonSet,
  getCompanyBrowseSnapshot,
} from '../companyInventoryBrowse.service';

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
  /** Company-specific browse filter buttons loaded once per turn. */
  browseFilters?: Array<{ id: string; title: string }>;
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
  const media = components.filter((c) => c.kind === 'media');
  if (interactive && media.length) return [...media.slice(0, 2), interactive];
  if (interactive) return [interactive];
  if (media.length) return media.slice(0, 2);
  return [];
}

export function resolveHeroMediaComponent(
  properties: PropertySummary[],
  brochureResolution: { mediaComponent: { kind: 'media'; url: string; mime: string; caption?: string } | null } | null,
  stage: string,
): WhatsAppComponent | undefined {
  if (brochureResolution?.mediaComponent) {
    return brochureResolution.mediaComponent;
  }

  if (stage !== 'shortlist' && stage !== 'commitment' && stage !== 'qualify' && stage !== 'rapport') {
    return undefined;
  }

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

  const media = await resolveFirstPropertyHeroMediaComponent({
    images: prop.images,
    caption: prop.name,
  });
  return media ?? undefined;
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

  try {
    await applyInteractiveActionSideEffects(actionResult, ctx.input.leadId, ctx.input.conversationId, {
      selectedPropertyId: ctx.input.conversationSelectedPropertyId,
      proposedVisitTime: ctx.input.conversationProposedVisitTime,
    });
  } catch (sideEffectErr: unknown) {
    logger.error('Interactive safety-net side-effects failed — transcript already persisted', {
      interactiveId,
      action: actionResult.action,
      conversationId: ctx.input.conversationId,
      error: sideEffectErr instanceof Error ? sideEffectErr.message : String(sideEffectErr),
    });
  }

  if (actionResult.turnResult) {
    return actionResult.turnResult;
  }

  const { buildSafeBuyerFallback } = await import('../../utils/safeBuyerFallback.util');
  return { audience: 'buyer', handled: true, terminal: true, text: buildSafeBuyerFallback() };
}

// ---------------------------------------------------------------------------
// H-start: Buyer /start fresh reset
// ---------------------------------------------------------------------------

async function handleStartFreshTurn(
  ctx: BuyerTurnRuntimeContext,
  conversationState: ConversationState,
): Promise<TurnResult | null> {
  if (!isBuyerStartCommand(ctx.input.messageText)) return null;

  logOutboundBranch('H-start', 'whatsappTurnOrchestrator:startFresh', 'buyer_start_fresh_reset', {
    conversationId: ctx.input.conversationId,
    leadId: ctx.input.leadId,
  });

  await resetBuyerBookingAndConversationState({
    companyId: ctx.companyId,
    leadId: ctx.input.leadId,
    conversationId: ctx.input.conversationId,
    customerPhone: ctx.customerPhone,
  });

  const resetState = conversationStateManager.createInitialState();
  Object.assign(conversationState, {
    stage: 'rapport' as ConversationState['stage'],
    previousStage: conversationState.stage,
    stageEnteredAt: new Date(),
    messageCount: 0,
    consecutiveObjections: 0,
    escalationReason: null,
    commitments: resetState.commitments,
    selectedPropertyId: null,
    proposedVisitTime: null,
    recommendedProperties: [],
  });

  const replyText = buildBuyerStartFreshReply(ctx.companyName);
  await prisma.message.create({
    data: {
      conversationId: ctx.input.conversationId,
      senderType: 'ai',
      content: replyText,
      language: ctx.input.leadLanguage || 'en',
      status: 'sent',
    },
  });

  return { audience: 'buyer', handled: true, terminal: true, text: replyText, replyPacing: 'none' };
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

  logOutboundBranch('H1', 'whatsappTurnOrchestrator:humanTakeover', 'buyer_human_takeover_handoff', {
    conversationId: ctx.input.conversationId,
    leadId: ctx.input.leadId,
  });

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

const BARE_GREETING_INBOUND =
  /^(hi|hello|hey|good\s+(morning|afternoon|evening))[\s,!]*$/i;

function finalizeRapportComponents(
  components: WhatsAppComponent[],
  input: {
    isReturning: boolean;
    liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>;
    greetingMedia?: unknown;
  },
): WhatsAppComponent[] {
  const merged = mergeGreetingMediaComponents(input.greetingMedia, components, {
    isReturning: input.isReturning,
    hasActiveVisit: Boolean(input.liveCtx.activeVisit),
  });
  return enforceTurnComponentBudget(merged);
}

async function resolveRapportOutbound(
  ctx: BuyerTurnRuntimeContext,
  input: {
    isReturning: boolean;
    conversationStage: string;
    liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>;
    postVisit: boolean;
  },
): Promise<{ safeReply: string; greetingMedia?: unknown }> {
  const aiSettings = await loadBuyerAiSettings(ctx.companyId);
  const greetingMedia = aiSettings?.greetingMedia;

  let locationPreference: string | null = null;
  if (input.isReturning) {
    const { getLeadMemory } = await import('../lead-memory.service');
    const memory = await getLeadMemory(ctx.input.leadId);
    locationPreference = memory.locationPreference ?? null;
  }

  const { buildFastPathCustomerReply } = await import('../customerMessageFastPath.service');
  const { buildReturningBuyerWelcomeReply } = await import('../buyerQualification.service');
  const fastPath = buildFastPathCustomerReply({
    customerMessage: ctx.input.messageText,
    companyName: ctx.companyName,
    customerName: ctx.input.leadCustomerName,
    aiSettings,
    conversationHistory: ctx.history,
    conversationStage: input.conversationStage,
    leadLanguage: ctx.input.leadLanguage,
    upcomingVisit: input.liveCtx.activeVisit,
    upcomingCall: input.liveCtx.activeCall,
  });

  let safeReply: string;
  if (fastPath?.text) {
    safeReply = fastPath.text;
  } else if (
    input.postVisit
    && BARE_GREETING_INBOUND.test(ctx.input.messageText.trim())
  ) {
    const { wasRecentBareGreetingWelcomeSent, tBuyer, resolveBuyerLanguage } =
      await import('../../utils/buyerI18n.util');
    const lang = resolveBuyerLanguage({
      message: ctx.input.messageText,
      leadLanguage: ctx.input.leadLanguage,
      defaultLanguage: aiSettings?.defaultLanguage,
    });
    if (wasRecentBareGreetingWelcomeSent(ctx.history)) {
      const name = ctx.input.leadCustomerName ? ` ${ctx.input.leadCustomerName}` : '';
      safeReply = tBuyer(lang, 'post_visit_compact_greeting', { name });
    } else {
      safeReply = buildPostVisitWelcomeReply({
        customerName: ctx.input.leadCustomerName,
        companyName: ctx.companyName,
        propertyName: input.liveCtx.recentCompletedVisit?.propertyName ?? input.liveCtx.activeVisit?.propertyName,
      });
    }
  } else if (input.isReturning) {
    const { resolveBuyerLanguage } = await import('../../utils/buyerI18n.util');
    const lang = resolveBuyerLanguage({
      message: ctx.input.messageText,
      leadLanguage: ctx.input.leadLanguage,
      defaultLanguage: aiSettings?.defaultLanguage,
    });
    safeReply = buildReturningBuyerWelcomeReply({
      companyName: ctx.companyName,
      customerName: ctx.input.leadCustomerName,
      locationPreference,
      greetingTemplate: aiSettings?.greetingTemplate ?? null,
      lang,
      leadLanguage: ctx.input.leadLanguage,
      conversationHistory: ctx.history,
      liveCtx: input.liveCtx,
    });
  } else {
    const { buildBuyerRapportReply } = await import('../buyerQualification.service');
    const { resolveBuyerLanguage } = await import('../../utils/buyerI18n.util');
    const lang = resolveBuyerLanguage({
      message: ctx.input.messageText,
      leadLanguage: ctx.input.leadLanguage,
      defaultLanguage: aiSettings?.defaultLanguage,
    });
    safeReply = buildBuyerRapportReply(ctx.companyName, { lang });
  }

  return {
    safeReply: stripBuyerInternalMetadata(safeReply),
    greetingMedia,
  };
}

function resolveRapportComponents(
  ctx: BuyerTurnRuntimeContext,
  input: {
    isReturning: boolean;
    conversationStage: string;
    liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>;
    postVisit: boolean;
    advancedLead: boolean;
    leadStatus: string | null | undefined;
    safeReply: string;
  },
): WhatsAppComponent[] {
  const buttonFlags = buyerButtonContextFromTurn(ctx, input.liveCtx);
  const stage = input.postVisit || input.advancedLead
    ? resolveStageFromLeadStatus(input.leadStatus || 'visited')
    : input.conversationStage;

  return resolveBuyerComponents({
    stage,
    outboundText: input.safeReply,
    inboundMessageText: ctx.input.messageText,
    isReturningGreeting: false,
    language: resolveBuyerLanguage({
      message: ctx.input.messageText,
      leadLanguage: ctx.input.leadLanguage,
    }),
    propertyId: input.liveCtx.recentCompletedVisit?.propertyId ?? ctx.input.conversationSelectedPropertyId,
    ...buttonFlags,
  });
}

async function buildLegacyRapportPayload(
  ctx: BuyerTurnRuntimeContext,
  input: {
    isReturning: boolean;
    conversationStage: string;
    liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>;
    hasPriorOutbound: boolean;
  },
): Promise<{ safeReply: string; components: WhatsAppComponent[] }> {
  const { safeReply, greetingMedia } = await resolveRapportOutbound(ctx, {
    isReturning: input.isReturning,
    conversationStage: input.conversationStage,
    liveCtx: input.liveCtx,
    postVisit: isPostVisitBuyer(input.liveCtx),
  });

  const components = resolveRapportComponents(ctx, {
    isReturning: input.isReturning,
    conversationStage: input.conversationStage,
    liveCtx: input.liveCtx,
    postVisit: isPostVisitBuyer(input.liveCtx),
    advancedLead: false,
    leadStatus: input.liveCtx.leadStatus,
    safeReply,
  });

  return {
    safeReply,
    components: finalizeRapportComponents(components, {
      isReturning: input.isReturning,
      liveCtx: input.liveCtx,
      greetingMedia,
    }),
  };
}

async function buildAdvancedRapportPayload(
  ctx: BuyerTurnRuntimeContext,
  input: {
    isReturning: boolean;
    conversationStage: string;
    liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>;
    hasPriorOutbound: boolean;
    postVisit: boolean;
    advancedLead: boolean;
    useCustomGreeting: boolean;
    leadStatus: string | null | undefined;
  },
): Promise<{ safeReply: string; components: WhatsAppComponent[] }> {
  const { safeReply, greetingMedia } = await resolveRapportOutbound(ctx, {
    isReturning: input.isReturning,
    conversationStage: input.conversationStage,
    liveCtx: input.liveCtx,
    postVisit: input.postVisit,
  });

  const components = resolveRapportComponents(ctx, {
    isReturning: input.isReturning,
    conversationStage: input.conversationStage,
    liveCtx: input.liveCtx,
    postVisit: input.postVisit,
    advancedLead: input.advancedLead,
    leadStatus: input.leadStatus,
    safeReply,
  });

  return {
    safeReply,
    components: finalizeRapportComponents(components, {
      isReturning: input.isReturning,
      liveCtx: input.liveCtx,
      greetingMedia,
    }),
  };
}

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
  liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>,
): Promise<TurnResult | null> {
  if (visitCommit.committed || visitCommit.workflowSuggestion) return null;

  // Mid-booking stages: never send a parallel welcome/intro — one reply per turn.
  if (['visit_booking', 'confirmation', 'commitment'].includes(conversationStage)) return null;

  const { isBuyerRapportMessage, isReturningBuyerGreeting, buildBuyerRapportReply } =
    await import('../buyerQualification.service');

  const hasPriorOutbound = ctx.history.some((m) => m.senderType === 'ai' || m.senderType === 'agent');
  const leadId = ctx.input.leadId;
  const leadStatus = liveCtx.leadStatus || ctx.input.leadStatus;
  const rapportCtx = isFeatureEnabledForLead(leadId, 'advancedLeadUx')
    ? { hasPriorOutbound, leadStatus }
    : { hasPriorOutbound };
  if (!isBuyerRapportMessage(ctx.input.messageText, { ...rapportCtx, leadId })) return null;

  logOutboundBranch('H2', 'whatsappTurnOrchestrator:rapport', 'buyer_rapport_fast_path', {
    messagePreview: ctx.input.messageText.slice(0, 40),
    returning: hasPriorOutbound,
  });

  const isReturning = isReturningBuyerGreeting(ctx.input.messageText, { hasPriorOutbound });
  const useCustomGreeting = isFeatureEnabledForLead(leadId, 'customGreetingTemplate');
  const useAdvancedUx = isFeatureEnabledForLead(leadId, 'advancedLeadUx');
  const postVisit = useAdvancedUx && isPostVisitBuyer(liveCtx);
  const advancedLead = useAdvancedUx && isAdvancedLeadStatus(leadStatus);

  const rapportPayload = await shadowCompare({
    featureName: 'buyer_rapport_h2',
    featureKey: 'advancedLeadUx',
    leadId,
    oldFn: async () => buildLegacyRapportPayload(ctx, {
      isReturning,
      conversationStage,
      liveCtx,
      hasPriorOutbound,
    }),
    newFn: async () => buildAdvancedRapportPayload(ctx, {
      isReturning,
      conversationStage,
      liveCtx,
      hasPriorOutbound,
      postVisit,
      advancedLead,
      useCustomGreeting,
      leadStatus,
    }),
  });

  const { safeReply, components } = rapportPayload;

  const resolvedLang = resolveBuyerLanguage({
    message: ctx.input.messageText,
    leadLanguage: ctx.input.leadLanguage,
  });
  if (resolvedLang !== normalizeBuyerLang(ctx.input.leadLanguage)) {
    await prisma.lead.update({ where: { id: leadId }, data: { language: resolvedLang } }).catch(() => undefined);
    await prisma.conversation.update({
      where: { id: ctx.input.conversationId },
      data: { language: resolvedLang },
    }).catch(() => undefined);
  }

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

  const pivotLang = resolveBuyerLanguage({
    message: ctx.input.messageText,
    leadLanguage: ctx.input.leadLanguage,
  });
  const pivotReply = stripBuyerInternalMetadata(
    buildReturningBuyerPivotReply(ctx.companyName, pivotLang),
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
    // "do you have villa(s)" / "any 4bhk"
    /\b(do you|have you|got|any)\b[\s\S]{0,40}\b(villas?|apartments?|flats?|plots?|properties|projects?)\b/i.test(t) ||
    /\b(\d)\s*bhk\b/i.test(t) ||
    // inventory count
    /\b(how many|number of|total)\b[\s\S]{0,40}\b(project|projects|properties|inventory|ongoing)\b/i.test(t) ||
    // "show me / list / see properties"
    /\b(show|list|see|view|display|get|give|tell)\s+(me\s+)?(your\s+|the\s+|all\s+|available\s+)?(properties|property|projects?|listings?|inventory|flats?|apartments?|villas?|plots?)\b/i.test(t) ||
    // "what properties / projects do you have"
    /\b(what|which)\s+(properties|property|projects?|flats?|apartments?|villas?|plots?)\b/i.test(t) ||
    // "available properties / projects"
    /\b(available|current|new|latest|upcoming)\s+(properties|property|projects?|flats?|apartments?|villas?|plots?)\b/i.test(t) ||
    // "show me options / inventory"
    /\bshow\s+(me\s+)?(options|inventory|choices|what['']?s\s+available)\b/i.test(t)
    || isMultilingualBrowseIntent(messageText)
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

  const { isPropertyInquiryMessage } = await import('../customerMessageFastPath.service');
  const resolvedLang = resolveBuyerLanguage({
    message: ctx.input.messageText,
    leadLanguage: ctx.input.leadLanguage,
  });

  const { resolvePropertyBrowseTurn } = await import('../../utils/propertyBrowseTurn.util');

  if (isPropertyInquiryMessage(ctx.input.messageText)) {
    const soldBrowse = await resolvePropertyBrowseTurn({
      companyId: ctx.companyId,
      messageText: ctx.input.messageText,
      stage: conversationStage,
      leadLanguage: resolvedLang,
    });
    if (!soldBrowse) return null;
    return dispatchPropertyBrowseTurn(ctx, soldBrowse, resolvedLang, liveCtx, 'sold_property_inquiry');
  }

  if (!isPropertyBrowsingIntent(ctx.input.messageText)) return null;

  logOutboundBranch('H2_5', 'whatsappTurnOrchestrator:propertyBrowsing', 'buyer_property_browse_fast_path', {
    messagePreview: ctx.input.messageText.slice(0, 40),
  });

  const browse = await resolvePropertyBrowseTurn({
    companyId: ctx.companyId,
    messageText: ctx.input.messageText,
    stage: conversationStage,
    leadLanguage: resolvedLang,
  });
  if (!browse) return null;

  return dispatchPropertyBrowseTurn(ctx, browse, resolvedLang, liveCtx, 'availability_check');
}

async function dispatchPropertyBrowseTurn(
  ctx: BuyerTurnRuntimeContext,
  browse: Awaited<ReturnType<typeof import('../../utils/propertyBrowseTurn.util').resolvePropertyBrowseTurn>> & object,
  resolvedLang: string,
  liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>,
  workflowId: string,
): Promise<TurnResult> {
  if (resolvedLang !== normalizeBuyerLang(ctx.input.leadLanguage)) {
    await prisma.lead.update({ where: { id: ctx.input.leadId }, data: { language: resolvedLang } }).catch(() => undefined);
    await prisma.conversation.update({
      where: { id: ctx.input.conversationId },
      data: { language: resolvedLang },
    }).catch(() => undefined);
  }

  const safeReply = stripBuyerInternalMetadata(browse.reply);
  await prisma.message.create({
    data: { conversationId: ctx.input.conversationId, senderType: 'ai', content: safeReply, status: 'sent' },
  });

  if (browse.propertyIds.length) {
    await prisma.conversation.update({
      where: { id: ctx.input.conversationId },
      data: {
        recommendedPropertyIds: browse.propertyIds,
        selectedPropertyId: browse.propertyIds[0] ?? null,
        ...(browse.propertyIds.length === 1 ? { stage: 'shortlist' as const } : {}),
      },
    }).catch(() => undefined);
  }

  fireMemoryExtraction({
    leadId: ctx.input.leadId,
    messageText: ctx.input.messageText,
    outboundText: safeReply,
    workflowId,
    liveCtx,
  });

  return {
    audience: 'buyer',
    handled: true,
    terminal: true,
    text: safeReply,
    components: enforceTurnComponentBudget(browse.components),
  };
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
  liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>,
): Promise<TurnResult | null> {
  if (visitCommit.committed || visitCommit.workflowSuggestion) return null;
  if (
    isFeatureEnabledForLead(ctx.input.leadId, 'advancedLeadUx')
    && (isAdvancedLeadStatus(ctx.input.leadStatus) || isPostVisitBuyer(liveCtx))
  ) {
    return null;
  }
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

  const qualComponents = isFeatureEnabledForLead(ctx.input.leadId, 'advancedLeadUx')
    ? resolveBuyerComponents({
        stage: 'qualify',
        outboundText: qualReply,
        propertyId: ctx.input.conversationSelectedPropertyId,
        ...buyerButtonContextFromTurn(ctx, liveCtx),
      })
    : [];

  return {
    audience: 'buyer',
    handled: true,
    terminal: true,
    text: qualReply,
    ...(qualComponents.length ? { components: qualComponents } : {}),
  };
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

  logOutboundBranch('H-call', 'whatsappTurnOrchestrator:callCommit', 'buyer_call_commit_reply', {
    conversationId: ctx.input.conversationId,
    leadId: ctx.input.leadId,
    hasActiveCall: Boolean(callCommit.hasActiveCall),
  });

  await prisma.message.create({
    data: {
      conversationId: ctx.input.conversationId,
      senderType: 'ai',
      content: callCommit.customerReply,
      status: 'sent',
    },
  });

  const components = resolveBuyerComponents({
    stage: ctx.input.conversationStage || 'confirmation',
    outboundText: callCommit.customerReply,
    propertyId: ctx.input.conversationSelectedPropertyId,
    hasActiveCall: Boolean(callCommit.hasActiveCall),
    recentAction: callCommit.hasActiveCall ? 'confirmed' : undefined,
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

  const visitLang = resolveBuyerLanguage({
    message: ctx.input.messageText,
    leadLanguage: ctx.input.leadLanguage,
  });
  const visitReply = await buildBuyerVisitStatusReply({
    leadId: ctx.input.leadId,
    companyId: ctx.companyId,
    companyName: ctx.companyName,
    customerMessage: ctx.input.messageText,
    leadLanguage: ctx.input.leadLanguage,
    lang: visitLang,
  });

  const components = resolveBuyerComponents({
    stage: 'confirmation',
    outboundText: visitReply,
    inboundMessageText: ctx.input.messageText,
    language: visitLang,
    propertyId: ctx.input.conversationSelectedPropertyId,
    ...buyerButtonContextFromTurn(ctx, liveCtx),
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

  const components = resolveBuyerComponents({
    stage: conversationStage,
    outboundText: safeReply,
    propertyId: suggestedPropertyId,
    ...buyerButtonContextFromTurn(ctx, liveCtx),
  });

  fireMemoryExtraction({ leadId: ctx.input.leadId, messageText: ctx.input.messageText, outboundText: safeReply, workflowId: visitCommit.workflowSuggestion.workflowId, liveCtx });
  return { audience: 'buyer', handled: true, terminal: true, text: safeReply, components };
}

// ---------------------------------------------------------------------------
// H7: Classifier workflow
// ---------------------------------------------------------------------------

async function resolveBuyerWorkflowComponents(input: {
  companyId: string;
  conversationId: string;
  messageText: string;
  conversationStage: string;
  outboundText: string;
  resolvedPropertyId: string | null;
  liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>;
  leadId: string;
  recommendedPropertyIds?: string[];
}): Promise<WhatsAppComponent[]> {
  const { isInventoryCountQuery, isPropertyTypeBrowseQuery } = await import('../../utils/formatBuyerCatalog.util');
  const isCatalogTurn =
    isPropertyBrowsingIntent(input.messageText)
    || isInventoryCountQuery(input.messageText)
    || isPropertyTypeBrowseQuery(input.messageText)
    || /\b(active project|matching options|couldn't find a \*\d BHK)/i.test(input.outboundText);

  if (isCatalogTurn) {
    const { resolvePropertyBrowseTurn } = await import('../../utils/propertyBrowseTurn.util');
    const browse = await resolvePropertyBrowseTurn({
      companyId: input.companyId,
      messageText: input.messageText,
      stage: input.conversationStage,
    });
    if (browse?.propertyIds.length) {
      await prisma.conversation.update({
        where: { id: input.conversationId },
        data: {
          recommendedPropertyIds: browse.propertyIds,
          selectedPropertyId: browse.propertyIds[0] ?? null,
        },
      }).catch(() => undefined);
    }
    if (browse) {
      return enforceTurnComponentBudget(browse.components);
    }
  }

  return resolveBuyerComponents({
    stage: input.conversationStage,
    outboundText: input.outboundText,
    propertyId: input.resolvedPropertyId,
    recommendedPropertyIds: input.recommendedPropertyIds,
    ...buyerButtonFlagsFromLive(input.liveCtx, input.leadId),
  });
}

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

  const { shouldBypassBuyerWorkflowForRichPropertyLlm } = await import('../customerMessageFastPath.service');
  if (shouldBypassBuyerWorkflowForRichPropertyLlm(ctx.input.messageText)) return null;

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
    leadLanguage: ctx.input.leadLanguage,
    activeVisit: liveCtx.activeVisit
      ? { visitId: liveCtx.activeVisit.visitId, propertyName: liveCtx.activeVisit.propertyName }
      : null,
  });

  if (!workflowReply?.trim()) return null;

  logOutboundBranch('H7', 'whatsappTurnOrchestrator:classifierWorkflow', 'buyer_classifier_workflow', {
    conversationId: ctx.input.conversationId,
    messagePreview: ctx.input.messageText.slice(0, 80),
  });

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

  const components = await resolveBuyerWorkflowComponents({
    companyId: ctx.companyId,
    conversationId: ctx.input.conversationId,
    messageText: ctx.input.messageText,
    conversationStage,
    outboundText: safeReply,
    resolvedPropertyId,
    liveCtx,
    leadId: ctx.input.leadId,
    recommendedPropertyIds: [...(ctx.input.conversationRecommendedPropertyIds ?? [])],
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
    const slotConfirmed =
      visitCommit.mode === 'scheduled' || visitCommit.mode === 'rescheduled';
    await prisma.conversation.update({
      where: { id: ctx.input.conversationId },
      data: {
        stage: slotConfirmed ? 'confirmation' : 'visit_booking',
        proposedVisitTime: visitCommit.scheduledAt,
        commitments: {
          visitSlotDiscussed: true,
          visitSlotConfirmed: slotConfirmed,
        },
      },
    });
  }

  if (visitCommit.leadStatus === 'visit_scheduled') {
    await transitionLeadToVisitScheduled(ctx.input.leadId);
  }

  void import('../clientMemory.service').then(({ syncLeadClientMemory }) => syncLeadClientMemory(ctx.input.leadId));

  const visitAction =
    visitCommit.mode === 'pending_approval'
      ? 'visit_pending_approval'
      : visitCommit.mode === 'rescheduled'
        ? 'workflow_reschedule_visit'
        : visitCommit.mode === 'cancelled'
          ? 'workflow_cancel_visit'
          : 'customerVisitBooked';

  await logAgentAction({
    companyId: ctx.companyId,
    triggeredBy: 'inbound_message',
    action: visitAction,
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

  const aiSettings = await loadBuyerAiSettings(ctx.companyId);

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

  const [neverSayNoCtx, resolvedPropertyId] = await Promise.all([
    buildNeverSayNoContext(
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
    ),
    resolveBuyerPropertyReference({
      companyId: ctx.companyId,
      messageText: ctx.input.messageText,
      selectedPropertyId: ctx.input.conversationSelectedPropertyId,
      recommendedPropertyIds: ctx.input.conversationRecommendedPropertyIds,
    }),
  ]);

  const propertyIdSet = [
    ...new Set([
      ...neverSayNoCtx.exactPropertyIds,
      ...neverSayNoCtx.alternativePropertyIds,
      ...(resolvedPropertyId ? [resolvedPropertyId] : []),
    ]),
  ];
  const rawProperties =
    propertyIdSet.length > 0
      ? await prisma.property.findMany({
        where: { companyId: ctx.companyId, id: { in: propertyIdSet }, status: { in: ['available', 'upcoming'] } },
      })
      : await prisma.property.findMany({
        where: { companyId: ctx.companyId, status: { in: ['available', 'upcoming'] } },
        take: 20,
      });

  let allRawProperties = rawProperties;
  if (resolvedPropertyId && !rawProperties.some((p) => p.id === resolvedPropertyId)) {
    const focusedRow = await prisma.property.findFirst({
      where: { id: resolvedPropertyId, companyId: ctx.companyId, status: { in: ['available', 'upcoming'] } },
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
  if (!shouldSkipHeavyBuyerContext(ctx.input.messageText, ctx.history.length)) {
    try {
      const { buildConversationContextBlock } = await import('../conversation-summary.service');
      conversationContextBlock = await buildConversationContextBlock(ctx.input.conversationId, ctx.input.leadId, ctx.companyId);
    } catch (err: unknown) {
      logger.warn('Conversation context block skipped', {
        leadId: ctx.input.leadId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logOutboundBranch('H9', 'whatsappTurnOrchestrator:aiPath', 'buyer_ai_service_path', {
    historyCount: ctx.history.length,
    stage: conversationState.stage,
  });

  type AiTurnResponse = Awaited<ReturnType<typeof aiService.generateResponse>>;
  const buyerLlmTimeoutMs = getBuyerLlmTimeoutMs();
  let aiResponse: AiTurnResponse;
  try {
    aiResponse = await Promise.race([
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
        setTimeout(
          () => reject(new Error(`AI response timed out after ${buyerLlmTimeoutMs}ms`)),
          buyerLlmTimeoutMs,
        ),
      ),
    ]);
  } catch (err: unknown) {
    logger.warn('H9 AI response timed out or failed', {
      conversationId: ctx.input.conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    aiResponse = {
      text: buildSafeBuyerFallback({
        activeVisit: liveCtx.activeVisit
          ? {
              propertyName: liveCtx.activeVisit.propertyName,
              scheduledAt: liveCtx.activeVisit.scheduledAt,
              status: liveCtx.activeVisit.status,
            }
          : null,
      }),
      detectedLanguage: resolveBuyerLanguage({
        message: ctx.input.messageText,
        leadLanguage: lead.language,
      }),
    };
  }

  aiResponse.detectedLanguage = resolveBuyerLanguage({
    message: ctx.input.messageText,
    leadLanguage: lead.language,
  });

  const groundedProperties = allRawProperties.map((p) => propertyToCompletenessInput(p));
  const groundedFactsBlock = buildGroundedFactsBlock(groundedProperties, neverSayNoCtx.promptBlock);

  let outboundCandidate = aiResponse.text;

  if (isVisitCancelOrRescheduleMessage(ctx.input.messageText) && !visitCommit.committed) {
    const mutation = await applyVisitMutationFromChat({
      companyId: ctx.companyId,
      message: ctx.input.messageText,
      leadId: ctx.input.leadId,
      suppressCustomerNotification: true,
    });
    if (mutation.handled && mutation.reply) {
      outboundCandidate = mutation.reply;
    }
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

  if (aiResponse.detectedLanguage !== lead.language) {
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
  const interactiveComponents = resolveBuyerComponents({
    stage: aiResponse.newState?.stage ?? conversationState.stage,
    outboundText,
    nextAction: aiResponse.nextAction,
    recentAction,
    sentPropertyFilters: false,
    propertyId: componentPropertyId,
    recommendedPropertyIds: componentRecommendedPropertyIds
      ? [...componentRecommendedPropertyIds]
      : [...(ctx.input.conversationRecommendedPropertyIds ?? [])],
    properties: properties.map((p) => ({ id: p.id, name: p.name })),
    ...buyerButtonContextFromTurn(ctx, liveCtx, {
      propertyId: componentPropertyId,
      recommendedPropertyIds: componentRecommendedPropertyIds
        ? [...componentRecommendedPropertyIds]
        : [...(ctx.input.conversationRecommendedPropertyIds ?? [])],
      properties: properties.map((p) => ({ id: p.id, name: p.name })),
    }),
  });

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

  return {
    audience: 'buyer',
    handled: true,
    terminal: true,
    text: outboundText,
    components,
    replyPacing: resolveLlmReplyPacing(),
  };
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

function buyerButtonFlagsFromLive(
  liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>,
  leadId?: string,
) {
  return {
    hasActiveVisit: Boolean(liveCtx.activeVisit),
    hasActiveCall: Boolean(liveCtx.activeCall),
    visitStatus: liveCtx.activeVisit?.status,
    visitProperty: liveCtx.activeVisit?.propertyName ?? undefined,
    visitTime: resolveVisitTimeString(liveCtx.activeVisit?.scheduledAt),
    visitPropertyProjectId:
      liveCtx.activeVisit?.projectId ?? liveCtx.recentCompletedVisit?.projectId ?? null,
    visitPropertyId:
      liveCtx.activeVisit?.propertyId ?? liveCtx.recentCompletedVisit?.propertyId ?? null,
    hasCompletedVisit: isPostVisitBuyer(liveCtx),
    leadId,
    liveLeadSnapshot: {
      activeVisit: liveCtx.activeVisit,
      recentCompletedVisit: liveCtx.recentCompletedVisit,
      leadStatus: liveCtx.leadStatus,
    },
  };
}

/** Visit state + conversation property context for contextual next-step buttons. */
function buyerButtonContextFromTurn(
  ctx: BuyerTurnRuntimeContext,
  liveCtx: Awaited<ReturnType<typeof getLiveLeadContext>>,
  extra?: {
    propertyId?: string | null;
    recommendedPropertyIds?: string[];
    properties?: Array<{ id: string; name: string }>;
  },
) {
  return {
    ...buyerButtonFlagsFromLive(liveCtx, ctx.input.leadId),
    inboundMessageText: ctx.input.messageText,
    propertyId: extra?.propertyId ?? ctx.input.conversationSelectedPropertyId,
    recommendedPropertyIds:
      extra?.recommendedPropertyIds
        ? [...extra.recommendedPropertyIds]
        : [...(ctx.input.conversationRecommendedPropertyIds ?? [])],
    properties: extra?.properties,
    browseFilters: ctx.browseFilters,
  };
}

async function syncAdvancedLeadConversationStage(
  conversationId: string,
  conversationState: ConversationState,
  leadStatus: string | null | undefined,
): Promise<ConversationState> {
  if (!leadStatus || !isAdvancedLeadStatus(leadStatus)) return conversationState;
  if (conversationState.stage !== 'rapport' && conversationState.stage !== 'human_escalated') {
    return conversationState;
  }

  const advancedStage = resolveStageFromLeadStatus(leadStatus);
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { stage: advancedStage, stageEnteredAt: new Date(), stageMessageCount: 0 },
  }).catch(() => undefined);

  return { ...conversationState, stage: advancedStage, previousStage: 'rapport' };
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

/** True when the buyer supplied (or confirmed) a concrete visit slot — H7b must not fire. */
function buyerMessageHasResolvableVisitDateTime(
  messageText: string,
  proposedVisitTime: Date | null,
  recentCustomerMessages: string[],
): boolean {
  if (parseVisitDateTimeFromMessage(messageText)) return true;
  if (parseCustomVisitSlotFromMessage(messageText)) return true;
  if (isShortVisitConfirmation(messageText) && proposedVisitTime) return true;
  return Boolean(parseVisitDateTimeFromHistory(recentCustomerMessages));
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

  if (newState.stage === 'human_escalated') {
    newState.stage = currentStage === 'human_escalated'
      ? resolveStageAfterHumanEscalationReset(ctx.input.leadStatus ?? null)
      : currentStage;
    newState.escalationReason = null;
  }

  const shouldNotifyAgents = aiResponse.nextAction?.action === 'escalate';

  await prisma.conversation.update({
    where: { id: ctx.input.conversationId },
    data: {
      status: 'ai_active',
      aiEnabled: true,
      stage: newState.stage,
      stageEnteredAt: newState.stageEnteredAt,
      stageMessageCount: newState.messageCount,
      commitments: newState.commitments as unknown as Prisma.InputJsonValue,
      objectionCount: newState.objectionCount,
      lastObjectionType: newState.lastObjectionType,
      consecutiveObjections: newState.consecutiveObjections,
      urgencyScore: newState.urgencyScore,
      valueScore: newState.valueScore,
      escalationReason: shouldNotifyAgents ? (aiResponse.nextAction?.escalationReason ?? newState.escalationReason) : null,
      recommendedPropertyIds: newState.recommendedProperties as string[],
      selectedPropertyId: newState.selectedPropertyId,
      proposedVisitTime: newState.proposedVisitTime,
    },
  });

  await syncLeadScoreFromConversation(ctx.input.leadId, newState.urgencyScore, newState.valueScore);

  if (aiResponse.nextAction?.suggestedLeadStatus) {
    await transitionLeadStatus(ctx.input.leadId, aiResponse.nextAction.suggestedLeadStatus, { force: true });
  }

  if (shouldNotifyAgents) {
    const { notifyBuyerAgentAssistNeeded } = await import('../buyerAgentAssist.service');
    const reasonText = aiResponse.nextAction?.escalationReason ?? 'Customer needs agent attention';
    await notifyBuyerAgentAssistNeeded({
      companyId: ctx.companyId,
      leadId: lead.id,
      conversationId: ctx.input.conversationId,
      reason: /negotiat|discount|price/i.test(reasonText) ? 'price_negotiation' : 'escalation_request',
      summary: reasonText,
      customerMessage: ctx.input.messageText,
      customerName: lead.customerName,
      customerPhone: lead.phone,
    });

    await logAgentAction({
      companyId: ctx.companyId,
      triggeredBy: 'inbound_message',
      action: 'workflow_escalate_to_human',
      resourceType: 'lead',
      resourceId: ctx.input.leadId,
      status: 'success',
      inputs: {
        reason: reasonText,
        conversationId: ctx.input.conversationId,
        notifyOnly: true,
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
  let activeState = conversationState;
  const browseLang = resolveBuyerLanguage({
    message: ctx.input.messageText,
    leadLanguage: ctx.input.leadLanguage,
  });
  const browseSnapshot = await getCompanyBrowseSnapshot(ctx.companyId);
  ctx.browseFilters = buildDiscoveryButtonSet(browseSnapshot, browseLang);
  // /start resets all booking/conversation state and re-enables AI — must run before H1.
  const hStart = await handleStartFreshTurn(ctx, activeState);
  if (hStart) return hStart;

  // H1 must run before any booking commits — human takeover is terminal and must
  // never trigger side-effect DB mutations for a conversation owned by a live agent.
  const h1 = await handleHumanTakeoverTurn(ctx);
  if (h1) return withDefaultReplyPacing(h1);

  const h0 = await handleInteractiveSafetyTurn(ctx);
  if (h0) return withDefaultReplyPacing(h0);

  const recentCustomerMessages = ctx.history
    .filter((m) => m.senderType === 'customer')
    .map((m) => m.content)
    .slice(-7);

  const [visitCommit, liveCtx] = await Promise.all([
    tryCommitCustomerVisitBooking({
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
    }),
    getLiveLeadContext(ctx.input.leadId, ctx.companyId),
  ]);
  if (shouldElevateReturningBuyerStage(ctx.input.leadId)) {
    activeState = await syncAdvancedLeadConversationStage(
      ctx.input.conversationId,
      activeState,
      liveCtx.leadStatus || ctx.input.leadStatus,
    );
  }

  // Rapport/dismissal before call commit — bare "Hi" must not fall through to LLM greeting templates.
  const h1b = await handleDismissalTurn(ctx, visitCommit);
  if (h1b) return withDefaultReplyPacing(h1b);

  const h2 = await handleRapportTurn(ctx, visitCommit, activeState.stage, liveCtx);
  if (h2) return withDefaultReplyPacing(h2);

  const h2b = await handleReturningBuyerPivotTurn(ctx, visitCommit);
  if (h2b) return withDefaultReplyPacing(h2b);

  // H2.5 must run BEFORE callCommit and H3-H7 so property-browsing intents
  // never reach the LLM (H9) where temperature variance causes spurious escalation.
  const h2_5 = await handlePropertyBrowsingTurn(ctx, visitCommit, liveCtx, activeState.stage);
  if (h2_5) return withDefaultReplyPacing(h2_5);

  const callCommit = await tryCommitCustomerCallBooking({
    companyId: ctx.companyId,
    customerMessage: ctx.input.messageText,
    conversationId: ctx.input.conversationId,
    lead: { id: ctx.input.leadId, assignedAgentId: ctx.input.leadAssignedAgentId },
    interactiveId: ctx.input.interactiveId,
  });

  const hCall = await handleCallCommitReplyTurn(ctx, callCommit, visitCommit);
  if (hCall) return withDefaultReplyPacing(hCall);

  const h3 = await handleMemoryRecallTurn(ctx, visitCommit);
  if (h3) return withDefaultReplyPacing(h3);

  const h4 = await handleQualificationTurn(ctx, visitCommit, liveCtx);
  if (h4) return withDefaultReplyPacing(h4);

  const h5 = await handleVisitStatusTurn(ctx, visitCommit, liveCtx);
  if (h5) return withDefaultReplyPacing(h5);

  const h6 = await handleVisitCommitWorkflowTurn(ctx, visitCommit, liveCtx, activeState.stage, ctx.input.conversationSelectedPropertyId);
  if (h6) return withDefaultReplyPacing(h6);

  const h7 = await handleClassifierWorkflowTurn(ctx, visitCommit, liveCtx, activeState.stage, ctx.input.conversationSelectedPropertyId);
  if (h7) return withDefaultReplyPacing(h7);

  // H7b: Bare visit intent with no date/time — ask the buyer instead of falling to LLM escalation.
  // Fires only when isVisitActionRequest() is true but visitCommit was not committed (no time parsed).
  if (
    !visitCommit.committed
    && isVisitActionRequest(ctx.input.messageText)
    && !buyerMessageHasResolvableVisitDateTime(
      ctx.input.messageText,
      ctx.input.conversationProposedVisitTime,
      recentCustomerMessages,
    )
  ) {
    const askReply = `Great! I'd love to arrange a site visit for you. 😊\n\nCould you share your *preferred date and time*? For example: "Saturday 11am" or "Tuesday 3pm".`;
    await prisma.message.create({
      data: { conversationId: ctx.input.conversationId, senderType: 'ai', content: askReply, status: 'sent' },
    });
    await prisma.conversation.update({
      where: { id: ctx.input.conversationId },
      data: { stage: 'visit_booking', stageEnteredAt: new Date() },
    }).catch(() => undefined);
    return withDefaultReplyPacing({ audience: 'buyer', handled: true, terminal: true, text: askReply });
  }

  const h8 = await handleVisitCommitReplyTurn(ctx, visitCommit, liveCtx);
  if (h8) return withDefaultReplyPacing(h8);

  return handleFullAiTurn(ctx, visitCommit, callCommit, liveCtx, activeState);
}

function withDefaultReplyPacing(result: TurnResult): TurnResult {
  if (result.replyPacing) return result;
  return { ...result, replyPacing: resolveDefaultReplyPacing() };
}

// ---------------------------------------------------------------------------
// Test / policy helpers
// ---------------------------------------------------------------------------

/** Build rapport TurnResult without DB writes (unit tests). */
export async function buildBuyerRapportTurnResult(input: {
  companyId?: string;
  companyName: string;
  messageText: string;
  hasPriorOutbound: boolean;
  stage: string;
  locationPreference?: string | null;
  browseFilters?: Array<{ id: string; title: string }>;
  liveCtx?: Awaited<ReturnType<typeof getLiveLeadContext>>;
}): Promise<TurnResult | null> {
  const {
    isBuyerRapportMessage,
    isReturningBuyerGreeting,
    buildBuyerRapportReply,
    buildReturningBuyerWelcomeReply,
  } = await import('../buyerQualification.service');

  const rapportCtx = { hasPriorOutbound: input.hasPriorOutbound };
  if (!isBuyerRapportMessage(input.messageText, rapportCtx)) return null;

  const isReturning = isReturningBuyerGreeting(input.messageText, rapportCtx);
  const liveCtx = input.liveCtx ?? {
    leadStatus: 'new',
    leadName: null,
    activeVisit: null,
    recentCompletedVisit: null,
    recentCancelledVisit: null,
    activeCall: null,
    assignedAgentName: null,
    assignedAgentPhone: null,
    promptBlock: '',
  };
  const text = stripBuyerInternalMetadata(
    isReturning
      ? buildReturningBuyerWelcomeReply({
          companyName: input.companyName,
          locationPreference: input.locationPreference,
          liveCtx,
        })
      : buildBuyerRapportReply(input.companyName),
  );

  let browseFilters = input.browseFilters;
  if (!browseFilters && input.companyId) {
    const snapshot = await getCompanyBrowseSnapshot(input.companyId);
    browseFilters = buildDiscoveryButtonSet(snapshot, 'en');
  }

  const components = resolveBuyerComponents({
    stage: input.stage,
    outboundText: text,
    isReturningGreeting: false,
    browseFilters,
    hasActiveVisit: Boolean(liveCtx.activeVisit),
    hasActiveCall: Boolean(liveCtx.activeCall),
    visitStatus: liveCtx.activeVisit?.status,
    visitPropertyProjectId: liveCtx.activeVisit?.projectId ?? null,
    hasCompletedVisit: isPostVisitBuyer(liveCtx),
    liveLeadSnapshot: {
      activeVisit: liveCtx.activeVisit,
      recentCompletedVisit: liveCtx.recentCompletedVisit,
      leadStatus: liveCtx.leadStatus,
    },
  });

  return { audience: 'buyer', handled: true, terminal: true, text, components };
}

/** Documented handler cascade for unit tests (full.md PART III.O). */
export const BUYER_HANDLER_CASCADE = [
  'H-start',
  'H1',
  'H0',
  'visitCommit',
  'H1b',
  'H2',
  'H2b',
  'H2.5',
  'callCommit',
  'H-call',
  'H3',
  'H4',
  'H5',
  'H6',
  'H7',
  'H7b',
  'H8',
  'H9',
] as const;

