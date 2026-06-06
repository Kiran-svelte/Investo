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

export function isBuyerRapportMessage(message: string): boolean {
  const t = message.trim();
  if (!t || EXPLICIT_INTENT.test(t)) return false;
  return isRapportPhrase(t);
}

export function isBuyerQualificationStatement(message: string): boolean {
  const t = message.trim();
  if (!t || EXPLICIT_INTENT.test(t)) return false;
  return QUALIFY_PATTERN.test(t);
}

function formatBudgetLine(budget: LeadMemory['budget']): string | null {
  if (!budget?.min && !budget?.max) return null;
  const fmt = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} crore` : `₹${(n / 1e5).toFixed(2)} lakh`);
  if (budget.min && budget.max) return `${fmt(budget.min)} – ${fmt(budget.max)}`;
  if (budget.max) return `up to ${fmt(budget.max)}`;
  return budget.min ? `from ${fmt(budget.min)}` : null;
}

export function buildBuyerRapportReply(companyName: string): string {
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
