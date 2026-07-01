/**
 * Unified post-visit feedback — single source of truth for prompts, parsing, persistence,
 * and deduplication across notification.engine, automation, and buyer turn orchestrator.
 */

import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { tBuyer, resolveBuyerLanguage } from '../../utils/buyerI18n.util';
import { isPostVisitBuyer } from '../../utils/buyerLeadProgress.util';
import {
  isConversationAwaitingPostVisitFeedback,
  isPostVisitFeedbackCollected,
  mergeConversationCommitments,
  POST_VISIT_FEEDBACK_NOTE_PREFIX,
  readPostVisitFeedbackCommitments,
  visitNotesIndicateFeedbackCollected,
} from '../../utils/postVisitFeedbackContext.util';
import { resolveSituationBuyerButtons } from '../../utils/buyerSituationButtons.util';
import type { LiveLeadContext } from '../liveLeadContext.service';
import type { WhatsAppComponent } from '../../types/whatsapp-turn.types';

export type PostVisitFeedbackSentiment =
  | 'loved'
  | 'more_options'
  | 'negotiate'
  | 'defer'
  | 'negative';

export type PostVisitFeedbackParseResult =
  | { matched: false }
  | { matched: true; kind: 'rating'; rating: number }
  | { matched: true; kind: 'sentiment'; sentiment: PostVisitFeedbackSentiment };

const POST_VISIT_PROMPT_OUTBOUND_RE =
  /how was your (site )?visit|rate your visit experience|loved it, need more options|need time to decide/i;

const PROMPT_COOLDOWN_MS = 20 * 60 * 60 * 1000;

export function isVisitNpsScoreMessage(message: string): boolean {
  return /^\s*[1-5]\s*$/.test(message.trim());
}

export function recentOutboundWasPostVisitPrompt(
  history: Array<{ senderType?: string; content?: string }>,
  withinMs = 48 * 60 * 60 * 1000,
): boolean {
  const cutoff = Date.now() - withinMs;
  return history.some((m) => {
    if (m.senderType !== 'ai' && m.senderType !== 'agent') return false;
    if (!m.content || !POST_VISIT_PROMPT_OUTBOUND_RE.test(m.content)) return false;
    return true;
  });
}

export function parsePostVisitFeedbackMessage(message: string): PostVisitFeedbackParseResult {
  const t = message.trim();
  if (!t) return { matched: false };

  if (isVisitNpsScoreMessage(t)) {
    return { matched: true, kind: 'rating', rating: Number(t.trim()) };
  }

  if (/^(loved it|love it|loved|excellent|great visit|amazing|wonderful|fantastic)\b/i.test(t)) {
    return { matched: true, kind: 'sentiment', sentiment: 'loved' };
  }
  if (/\b(need|want)\s+(more|other|different)\s+options?\b/i.test(t) || /\bshow me more\b/i.test(t)) {
    return { matched: true, kind: 'sentiment', sentiment: 'more_options' };
  }
  if (/\bnegotiat/i.test(t) || /\b(better price|discount|deal)\b/i.test(t)) {
    return { matched: true, kind: 'sentiment', sentiment: 'negotiate' };
  }
  if (
    /\bneed (some )?time\b/i.test(t)
    || /\bthink (about|over) it\b/i.test(t)
    || /\bdecide later\b/i.test(t)
    || /\bnot (sure|ready) yet\b/i.test(t)
    || /\bwill let you know\b/i.test(t)
  ) {
    return { matched: true, kind: 'sentiment', sentiment: 'defer' };
  }
  if (/\b(didn't like|did not like|not good|disappointed|bad experience|poor)\b/i.test(t)) {
    return { matched: true, kind: 'sentiment', sentiment: 'negative' };
  }

  return { matched: false };
}

export function shouldHandlePostVisitFeedbackTurn(input: {
  messageText: string;
  commitments: unknown;
  liveCtx: Pick<LiveLeadContext, 'activeVisit' | 'recentCompletedVisit' | 'leadStatus'>;
  history: Array<{ senderType?: string; content?: string }>;
}): boolean {
  const parsed = parsePostVisitFeedbackMessage(input.messageText);
  const inPostVisitContext =
    isConversationAwaitingPostVisitFeedback(input.commitments)
    || isPostVisitBuyer(input.liveCtx)
    || recentOutboundWasPostVisitPrompt(input.history);

  if (!inPostVisitContext) return false;
  if (parsed.matched) return true;
  return isConversationAwaitingPostVisitFeedback(input.commitments);
}

export function buildPostVisitFeedbackAlreadyRecordedReply(lang: string | null | undefined): string {
  return tBuyer(lang, 'post_visit_feedback_already_recorded');
}

export function buildPostVisitFeedbackPromptText(input: {
  lang: string | null | undefined;
  customerName: string | null | undefined;
  propertyName: string | null | undefined;
}): string {
  const name = (input.customerName ?? '').trim() || 'there';
  const property = (input.propertyName ?? '').trim() || 'the property';
  return tBuyer(input.lang, 'post_visit_feedback_prompt', { name, property });
}

export function buildPostVisitFeedbackButtons(input: {
  lang: string | null | undefined;
  visitPropertyProjectId?: string | null;
}): WhatsAppComponent[] {
  const lang = resolveBuyerLanguage({ leadLanguage: input.lang });
  const buttons = resolveSituationBuyerButtons({
    stage: 'shortlist',
    outboundText: 'How was your visit experience loved it need more options',
    hasCompletedVisit: true,
    hasActiveVisit: false,
    language: lang,
    visitPropertyProjectId: input.visitPropertyProjectId ?? null,
  });
  if (!buttons?.length) return [];
  return [{ kind: 'buttons', buttons }];
}

function buildFeedbackAckReply(input: {
  lang: string | null | undefined;
  propertyName: string | null | undefined;
  parsed: Exclude<PostVisitFeedbackParseResult, { matched: false }>;
}): string {
  const property = (input.propertyName ?? '').trim() || 'the property';
  if (input.parsed.kind === 'rating') {
    return tBuyer(input.lang, 'post_visit_feedback_rating_ack', {
      rating: String(input.parsed.rating),
      property,
    });
  }
  const keyMap: Record<PostVisitFeedbackSentiment, 'post_visit_feedback_loved_ack' | 'post_visit_feedback_more_options_ack' | 'post_visit_feedback_negotiate_ack' | 'post_visit_feedback_defer_ack' | 'post_visit_feedback_negative_ack'> = {
    loved: 'post_visit_feedback_loved_ack',
    more_options: 'post_visit_feedback_more_options_ack',
    negotiate: 'post_visit_feedback_negotiate_ack',
    defer: 'post_visit_feedback_defer_ack',
    negative: 'post_visit_feedback_negative_ack',
  };
  return tBuyer(input.lang, keyMap[input.parsed.sentiment], { property });
}

export async function openPostVisitFeedbackFlow(input: {
  conversationId: string;
  visitId: string;
}): Promise<void> {
  await mergeConversationCommitments(input.conversationId, {
    awaitingPostVisitFeedback: true,
    postVisitFeedbackVisitId: input.visitId,
    postVisitFeedbackPromptAt: new Date().toISOString(),
    postVisitFeedbackCollectedAt: undefined,
    postVisitFeedbackRating: undefined,
    postVisitFeedbackSentiment: undefined,
    visitSlotDiscussed: false,
    visitSlotConfirmed: false,
  });

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: {
      stage: 'shortlist',
      proposedVisitTime: null,
    },
  }).catch((err: unknown) => {
    logger.warn('openPostVisitFeedbackFlow: conversation stage reset failed', {
      conversationId: input.conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

export async function recordPostVisitFeedback(input: {
  conversationId: string;
  visitId: string;
  parsed: Exclude<PostVisitFeedbackParseResult, { matched: false }>;
  rawMessage: string;
}): Promise<boolean> {
  const existing = await prisma.visit.findUnique({
    where: { id: input.visitId },
    select: { notes: true },
  });
  if (visitNotesIndicateFeedbackCollected(existing?.notes)) {
    return false;
  }

  const noteParts = [
    POST_VISIT_FEEDBACK_NOTE_PREFIX,
    input.parsed.kind === 'rating'
      ? `rating=${input.parsed.rating}`
      : `sentiment=${input.parsed.sentiment}`,
    `message=${input.rawMessage.slice(0, 200)}`,
    `at=${new Date().toISOString()}`,
  ];

  try {
    await prisma.visit.update({
      where: { id: input.visitId },
      data: {
        notes: noteParts.join(' '),
      },
    });
  } catch (err: unknown) {
    logger.warn('recordPostVisitFeedback: visit notes update failed', {
      visitId: input.visitId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }

  await mergeConversationCommitments(input.conversationId, {
    awaitingPostVisitFeedback: false,
    postVisitFeedbackCollectedAt: new Date().toISOString(),
    postVisitFeedbackRating: input.parsed.kind === 'rating' ? input.parsed.rating : undefined,
    postVisitFeedbackSentiment: input.parsed.kind === 'sentiment' ? input.parsed.sentiment : undefined,
    visitSlotDiscussed: false,
    visitSlotConfirmed: false,
  });
  return true;
}

export async function shouldSendPostVisitFollowUp(input: {
  leadId: string;
  visitId: string;
}): Promise<boolean> {
  const visit = await prisma.visit.findUnique({
    where: { id: input.visitId },
    select: { notes: true, leadId: true, status: true },
  });
  if (!visit || visit.leadId !== input.leadId) return false;
  if (visit.status !== 'completed') return false;
  if (visitNotesIndicateFeedbackCollected(visit.notes)) return false;

  const conversation = await prisma.conversation.findFirst({
    where: { leadId: input.leadId, status: { not: 'closed' } },
    select: { commitments: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (conversation && isPostVisitFeedbackCollected(conversation.commitments)) return false;

  const c = conversation?.commitments;
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    const promptAt = (c as Record<string, unknown>).postVisitFeedbackPromptAt;
    if (typeof promptAt === 'string') {
      const elapsed = Date.now() - new Date(promptAt).getTime();
      if (elapsed >= 0 && elapsed < PROMPT_COOLDOWN_MS) {
        return false;
      }
    }
  }

  return true;
}

export async function deliverPostVisitFeedbackPrompt(input: {
  leadId: string;
  visitId: string;
  companyId: string;
  source: 'visit_completed' | 'automation_24h';
}): Promise<boolean> {
  if (!(await shouldSendPostVisitFollowUp({ leadId: input.leadId, visitId: input.visitId }))) {
    logger.debug('Post-visit feedback prompt suppressed', {
      leadId: input.leadId,
      visitId: input.visitId,
      source: input.source,
    });
    return false;
  }

  const visit = await prisma.visit.findUnique({
    where: { id: input.visitId },
    include: {
      lead: { select: { id: true, phone: true, customerName: true, language: true } },
      property: { select: { name: true, projectId: true } },
    },
  });
  if (!visit?.lead?.phone) return false;

  const conversation = await prisma.conversation.findFirst({
    where: { leadId: input.leadId, status: { not: 'closed' } },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  if (!conversation) {
    logger.debug('Post-visit feedback prompt skipped — no open conversation', {
      leadId: input.leadId,
      visitId: input.visitId,
    });
    return false;
  }

  const lang = resolveBuyerLanguage({ leadLanguage: visit.lead.language });
  const bodyText = buildPostVisitFeedbackPromptText({
    lang,
    customerName: visit.lead.customerName,
    propertyName: visit.property?.name ?? null,
  });

  await openPostVisitFeedbackFlow({
    conversationId: conversation.id,
    visitId: input.visitId,
  });

  const buttons = buildPostVisitFeedbackButtons({
    lang,
    visitPropertyProjectId: visit.property?.projectId ?? null,
  });

  const { whatsappService } = await import('../whatsapp.service');
  let sent = false;
  if (buttons.length) {
    const flat = buttons[0];
    if (flat.kind === 'buttons') {
      sent = await whatsappService.sendCompanyInteractiveButtons(
        visit.lead.phone,
        input.companyId,
        bodyText,
        flat.buttons,
      );
    }
  }
  if (!sent) {
    sent = await whatsappService.sendCompanyTextMessage(
      visit.lead.phone,
      bodyText,
      input.companyId,
    );
  }

  if (sent) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType: 'ai',
        content: bodyText,
        status: 'sent',
        // INVESTO-FIX-2026-07-01: mark as interactive when this prompt was delivered with buttons
        ...(buttons.length ? { messageType: 'interactive' } : {}),
      },
    }).catch(() => undefined);
  }

  return sent;
}

export function buildPostVisitFeedbackTurnResult(input: {
  parsed: Exclude<PostVisitFeedbackParseResult, { matched: false }>;
  lang: string | null | undefined;
  propertyName: string | null | undefined;
  visitPropertyProjectId?: string | null;
}): { text: string; components: WhatsAppComponent[] } {
  const text = buildFeedbackAckReply({
    lang: input.lang,
    propertyName: input.propertyName,
    parsed: input.parsed,
  });
  const components = buildPostVisitFeedbackButtons({
    lang: input.lang,
    visitPropertyProjectId: input.visitPropertyProjectId,
  });
  return { text, components };
}

export async function resolvePostVisitFeedbackVisitId(input: {
  commitments: unknown;
  liveCtx: Pick<LiveLeadContext, 'recentCompletedVisit'>;
}): Promise<string | null> {
  const c = readPostVisitFeedbackCommitments(input.commitments);
  if (c.postVisitFeedbackVisitId) return c.postVisitFeedbackVisitId;
  return input.liveCtx.recentCompletedVisit?.visitId ?? null;
}
