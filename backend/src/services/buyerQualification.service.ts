import type { LeadMemory } from './lead-memory.service';
import { extractLeadMemoryDelta } from './buyer-memory-extract.service';
import { patchLeadMemory } from './lead-memory.service';

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
};

export function isBuyerRapportMessage(message: string, ctx?: BuyerRapportContext): boolean {
  const t = message.trim();
  if (!t || EXPLICIT_INTENT.test(t)) return false;
  if (!isRapportPhrase(t)) return false;
  // Bare greetings only trigger full welcome for strangers — returning buyers get short ack.
  const isBareGreeting = /^(hi|hello|hey|good\s+(morning|afternoon|evening))[\s,!]*$/i.test(t);
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

export function buildReturningBuyerPivotReply(companyName: string): string {
  return (
    `Great — let's start fresh! 🏡\n\n` +
    `Share your *budget*, preferred *area*, and *BHK* (or property type) and I'll shortlist the best matches from *${companyName}*.`
  );
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
  opts?: { isReturning?: boolean; locationPreference?: string | null },
): string {
  if (opts?.isReturning) {
    const area = opts.locationPreference?.trim();
    const areaHint = area ? `Still looking at *${area}*, or something new?` : 'Still exploring options, or something new?';
    return `Welcome back! ${areaHint}`;
  }
  return (
    `Hello! Welcome to *${companyName}*.\n\n` +
    `I can help you explore homes in Bangalore — share your budget, preferred area, and BHK, ` +
    `or ask about a specific project.`
  );
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
