import type { LeadMemory } from './lead-memory.service';
import { extractLeadMemoryDelta } from './buyer-memory-extract.service';
import { patchLeadMemory } from './lead-memory.service';
import {
  buildPostVisitWelcomeReply,
  isPostVisitBuyer,
  isAdvancedLeadStatus,
} from '../utils/buyerLeadProgress.util';
import { isFeatureEnabledForLead } from '../utils/featureRollout.util';
import type { LiveLeadContext } from './liveLeadContext.service';
import {
  buildCallAwareGreeting,
  buildVisitAwareGreeting,
  buildCompactActiveVisitAck,
  buildCompactConfirmedCallAck,
} from './liveLeadContext.service';
import {
  resolveBuyerLanguage,
  tBuyer,
  wasRecentBareGreetingWelcomeSent,
  wasRecentVisitWelcomeSent,
  wasRecentCallWelcomeSent,
} from '../utils/buyerI18n.util';

function isRapportPhrase(message: string): boolean {
  return (
    /^(hi|hello|hey|good\s+(morning|afternoon|evening))[\s,!]*$/i.test(message)
    || /\b(looking for|need a|searching for|interested in)\b.*\b(home|house|flat|apartment|property|3bhk|2bhk)\b/i.test(message)
  );
}

const QUALIFY_PATTERN =
  /\b(budget|crore|lakh|bhk|whitefield|preference|interested in)\b/i;

const EXPLICIT_INTENT =
  /\b(price|cost|how much|brochure|pdf|book|schedule|visit|available|amenities|discount|negotiat|human|call me|send me)\b/i;

export type BuyerRapportContext = {
  /** True when the conversation already has prior AI/staff outbound messages. */
  hasPriorOutbound?: boolean;
  /** CRM lead status — advanced leads skip generic rapport re-onboarding. */
  leadStatus?: string | null;
  /** Lead id for rollout gating. */
  leadId?: string | null;
};

export function isBuyerRapportMessage(message: string, ctx?: BuyerRapportContext): boolean {
  const t = message.trim();
  if (!t || EXPLICIT_INTENT.test(t)) return false;
  if (!isRapportPhrase(t)) return false;
  const isBareGreeting = /^(hi|hello|hey|good\s+(morning|afternoon|evening))[\s,!]*$/i.test(t);
  // Visited / negotiating buyers saying "interested in 3BHK" must reach shortlist/LLM — not rapport welcome.
  if (
    !isBareGreeting
    && ctx?.leadId
    && isFeatureEnabledForLead(ctx.leadId, 'advancedLeadUx')
    && isAdvancedLeadStatus(ctx?.leadStatus)
  ) {
    return false;
  }
  if (isBareGreeting && ctx?.hasPriorOutbound) return true;
  if (isBareGreeting && !ctx?.hasPriorOutbound) return true;
  return !isBareGreeting;
}

export function isReturningBuyerGreeting(message: string, ctx?: BuyerRapportContext): boolean {
  const t = message.trim();
  return Boolean(
    ctx?.hasPriorOutbound
    && /^(hi|hello|hey|good\s+(morning|afternoon|evening))[\s,!]*$/i.test(t),
  );
}

/** Reply to "Welcome back… or something new?" — pivot to a fresh search (no LLM). */
const RETURNING_PIVOT_PATTERN =
  /^(something\s+new|new\s+search|start\s+(?:over|fresh|again)|explore\s+(?:something\s+)?(?:new|else|different)|different\s+(?:property|project|area)|fresh\s+start|yes\s+something\s+new)[\s.!?]*$/i;

export function isReturningBuyerPivotReply(message: string): boolean {
  return RETURNING_PIVOT_PATTERN.test(message.trim());
}

export function buildReturningBuyerPivotReply(companyName: string, lang = 'en'): string {
  return tBuyer(lang, 'returning_pivot', { company: companyName.trim() || 'our team' });
}

export function isBuyerQualificationStatement(message: string): boolean {
  const t = message.trim();
  if (!t || EXPLICIT_INTENT.test(t)) return false;
  // Questions about saved preferences are memory recall, not new qualification statements.
  if (/\?$/.test(t) && /\b(what|how|when|where|which|who|can you|do you|remind)\b/i.test(t)) {
    return false;
  }
  if (/\bwhat(?:'s| is)\s+my\b/i.test(t)) return false;
  return QUALIFY_PATTERN.test(t);
}

function formatBudgetLine(budget: LeadMemory['budget']): string | null {
  if (!budget?.min && !budget?.max) return null;
  const fmt = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} crore` : `₹${(n / 1e5).toFixed(2)} lakh`);
  if (budget.min && budget.max) return `${fmt(budget.min)} – ${fmt(budget.max)}`;
  if (budget.max) return `up to ${fmt(budget.max)}`;
  return budget.min ? `from ${fmt(budget.min)}` : null;
}

export function buildBuyerRapportReply(
  companyName: string,
  opts?: { isReturning?: boolean; locationPreference?: string | null; lang?: string },
): string {
  const lang = opts?.lang ?? 'en';
  if (opts?.isReturning) {
    const area = opts.locationPreference?.trim();
    const hint = area
      ? tBuyer(lang, 'returning_area_hint', { area })
      : tBuyer(lang, 'returning_explore_hint');
    return `${tBuyer(lang, 'returning_welcome_back')} ${hint}`;
  }
  return buildFirstTimeBuyerWelcome(companyName);
}

function buildFirstTimeBuyerWelcome(companyName: string, customerName?: string | null): string {
  const name = (customerName ?? '').trim();
  const who = name ? `, *${name}*` : '';
  return (
    `Hello${who}! Welcome to *${companyName}*.\n\n` +
    `I'm your assistant for *${companyName}* — share your budget, preferred area, and what you're looking for, ` +
    `or ask about one of our listed projects.`
  );
}

function resolveWelcomeShell(
  companyName: string,
  customerName?: string | null,
  greetingTemplate?: string | null,
): string {
  const company = companyName.trim() || 'our team';
  const template = typeof greetingTemplate === 'string' ? greetingTemplate.trim() : '';
  if (template) {
    return template.replace(/\{business_name\}/gi, company);
  }
  return buildFirstTimeBuyerWelcome(company, customerName);
}

function buildReturningActivityLines(input: {
  locationPreference?: string | null;
  liveCtx: Pick<LiveLeadContext, 'recentCancelledVisit' | 'recentCompletedVisit' | 'leadStatus'>;
}): string[] {
  const lines: string[] = [];
  const area = input.locationPreference?.trim();
  if (area) {
    lines.push(`📍 Saved preference: *${area}*`);
  }
  if (input.liveCtx.recentCancelledVisit) {
    const property = input.liveCtx.recentCancelledVisit.propertyName ?? 'your property';
    lines.push(`❌ Your visit to *${property}* was cancelled — I can help reschedule or show other options.`);
  }
  if (
    input.liveCtx.recentCompletedVisit
    && !isPostVisitBuyer({
      activeVisit: null,
      recentCompletedVisit: input.liveCtx.recentCompletedVisit,
      leadStatus: input.liveCtx.leadStatus,
    })
  ) {
    const property = input.liveCtx.recentCompletedVisit.propertyName ?? 'the property';
    lines.push(`✔️ You recently visited *${property}* — happy to help with next steps.`);
  }
  return lines;
}

/**
 * Returning buyer bare-greeting welcome — same first-contact shell as new leads,
 * enriched with live visit/call/cancelled/completed context from CRM.
 */
export function buildReturningBuyerWelcomeReply(input: {
  companyName: string;
  customerName?: string | null;
  locationPreference?: string | null;
  greetingTemplate?: string | null;
  lang?: string;
  conversationHistory?: Array<{ senderType?: string; content?: string; createdAt?: Date | string }>;
  liveCtx: Pick<
    LiveLeadContext,
    'activeVisit' | 'activeCall' | 'recentCompletedVisit' | 'recentCancelledVisit' | 'leadStatus'
  >;
}): string {
  const company = input.companyName.trim() || 'our team';
  const lang = input.lang ?? 'en';

  if (input.liveCtx.activeVisit) {
    const visit = input.liveCtx.activeVisit;
    const propertyName = visit.propertyName ?? '';
    const history = input.conversationHistory ?? [];
    if (wasRecentVisitWelcomeSent(history, propertyName)) {
      return buildCompactActiveVisitAck(input.customerName ?? null, visit, lang);
    }
    return buildVisitAwareGreeting(
      input.customerName ?? null,
      visit,
      company,
      lang,
    );
  }

  if (isPostVisitBuyer({
    activeVisit: null,
    recentCompletedVisit: input.liveCtx.recentCompletedVisit,
    leadStatus: input.liveCtx.leadStatus,
  })) {
    if (wasRecentBareGreetingWelcomeSent(input.conversationHistory ?? [])) {
      const name = input.customerName ? ` ${input.customerName}` : '';
      return tBuyer(lang, 'post_visit_compact_greeting', { name });
    }
    return buildPostVisitWelcomeReply({
      customerName: input.customerName,
      companyName: company,
      propertyName: input.liveCtx.recentCompletedVisit?.propertyName,
    });
  }

  if (input.liveCtx.activeCall) {
    const call = input.liveCtx.activeCall;
    if (
      call.status === 'confirmed'
      && wasRecentCallWelcomeSent(input.conversationHistory ?? [])
    ) {
      return buildCompactConfirmedCallAck(input.customerName ?? null, call, lang);
    }
    return buildCallAwareGreeting(
      input.customerName ?? null,
      call,
      company,
      lang,
    );
  }

  if (wasRecentBareGreetingWelcomeSent(input.conversationHistory ?? [])) {
    const name = input.customerName ? ` ${input.customerName}` : '';
    return tBuyer(lang, 'returning_compact_greeting', { name });
  }

  let text = resolveWelcomeShell(company, input.customerName, input.greetingTemplate);
  const activityLines = buildReturningActivityLines({
    locationPreference: input.locationPreference,
    liveCtx: input.liveCtx,
  });
  if (activityLines.length) {
    text += `\n\n${activityLines.join('\n')}`;
  }
  return text;
}

export function buildBuyerQualificationAckReply(memory: Partial<LeadMemory>): string {
  const parts: string[] = [];
  const budgetLine = formatBudgetLine(memory.budget);
  if (budgetLine) parts.push(`budget *${budgetLine}*`);
  if (memory.locationPreference) parts.push(`area *${memory.locationPreference}*`);
  const noted = parts.length ? parts.join(' and ') : 'your preferences';
  return (
    `Thanks — I've saved ${noted}.\n\n` +
    `Would you like to see matching projects, get a brochure, or book a free site visit?`
  );
}

/** Patch lead_memory from inbound qualification text only (no LLM). */
export async function patchLeadMemoryFromQualification(leadId: string, messageText: string): Promise<Partial<LeadMemory>> {
  const delta = extractLeadMemoryDelta({
    leadId,
    messageText,
    outboundText: '',
  });
  if (Object.keys(delta).length > 1 || delta.budget || delta.locationPreference) {
    await patchLeadMemory(leadId, delta);
    const { syncLeadClientMemory } = await import('./clientMemory.service');
    void syncLeadClientMemory(leadId);
  }
  return delta;
}
