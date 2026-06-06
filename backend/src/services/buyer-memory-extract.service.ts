/**
 * Buyer Memory Extract Service
 *
 * Derives a `LeadMemory` delta from each buyer turn using deterministic rules.
 * Called fire-and-forget after every outbound reply so the buyer pipeline is
 * never blocked.
 *
 * Design:
 *   - Never throws — all errors are caught and logged.
 *   - Returns a partial delta suitable for `patchLeadMemory`.
 *   - Sources: extracted AI info, visit commit result, workflow ID, live context.
 *   - Does NOT perform an LLM call (optional LLM extraction can be added later
 *     behind the `BUYER_MEMORY_LLM_EXTRACT` env flag per ai-reality-check-and-roadmap.md).
 */

import logger from '../config/logger';
import type { LeadMemory } from './lead-memory.service';
import { getLeadMemory, patchLeadMemory } from './lead-memory.service';

/** Shape of AI-extracted information from aiService.generateResponse. */
export interface AiExtractedInfo {
  budget_min?: number | null;
  budget_max?: number | null;
  location_preference?: string | null;
  property_type?: string | null;
  customer_name?: string | null;
}

/** Shape of the visit commit result from tryCommitCustomerVisitBooking. */
export interface VisitCommitSnapshot {
  committed: boolean;
  visitId?: string | null;
  scheduledAt?: Date | null;
  mode?: 'scheduled' | 'rescheduled' | 'cancelled' | string | null;
  propertyName?: string | null;
}

/** Live context from getLiveLeadContext. */
export interface LiveContextSnapshot {
  activeVisit?: {
    visitId: string;
    propertyName?: string | null;
    scheduledAt: Date | string;
    status: string;
  } | null;
}

export interface ExtractBuyerMemoryDeltaParams {
  /** The lead's DB ID. */
  leadId: string;
  /** Raw customer message text. */
  messageText: string;
  /** The outbound AI text sent to the customer (for property mention extraction). */
  outboundText: string;
  /** Structured facts already extracted by aiService (optional). */
  aiExtractedInfo?: AiExtractedInfo | null;
  /** Visit commit result from the fast-path commit block (optional). */
  visitCommit?: VisitCommitSnapshot | null;
  /** The workflow ID that ran for this turn (optional). */
  workflowId?: string | null;
  /** Current live lead context snapshot (optional). */
  liveCtx?: LiveContextSnapshot | null;
}

/** Budget regex: matches "X lakhs", "X Cr", "X–Y Cr" patterns (Indian real-estate format). */
const BUDGET_PATTERN =
  /(?:budget|range|price)?\s*(?:is|:)?\s*(?:around\s+)?(?:₹|rs\.?\s*)?(\d+(?:\.\d+)?)\s*(?:–|-|to)\s*(?:₹|rs\.?\s*)?(\d+(?:\.\d+)?)\s*(cr|crore|l|lakh)/i;

/** Single-figure budget (e.g. "under 2 Cr", "2Cr budget"). */
const BUDGET_SINGLE_PATTERN =
  /(?:budget|under|within|up\s+to|below|around)?\s*(?:₹|rs\.?\s*)?(\d+(?:\.\d+)?)\s*(cr|crore|l|lakh)/i;

const LAKH_UNIT = new Set(['l', 'lakh']);
const CRORE_UNIT = new Set(['cr', 'crore']);

/** Convert a value+unit pair to integer rupees. */
function toRupees(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (LAKH_UNIT.has(u)) return Math.round(value * 100_000);
  if (CRORE_UNIT.has(u)) return Math.round(value * 10_000_000);
  return Math.round(value);
}

/** Extract budget range from a free-text message. Returns undefined when not found. */
function extractBudgetFromText(text: string): Pick<NonNullable<LeadMemory['budget']>, 'min' | 'max'> | undefined {
  const rangeMatch = BUDGET_PATTERN.exec(text);
  if (rangeMatch) {
    const unit = rangeMatch[3];
    return {
      min: toRupees(parseFloat(rangeMatch[1]), unit),
      max: toRupees(parseFloat(rangeMatch[2]), unit),
    };
  }
  const singleMatch = BUDGET_SINGLE_PATTERN.exec(text);
  if (singleMatch) {
    const amount = toRupees(parseFloat(singleMatch[1]), singleMatch[2]);
    return { max: amount };
  }
  return undefined;
}

/** Rough location keyword extractor — matches major Indian city/area names in the message. */
const LOCATION_PATTERN =
  /\b(whitefield|sarjapur|electronic\s+city|koramangala|hebbal|yelahanka|hyderabad|pune|mumbai|bangalore|bengaluru|delhi|chennai|noida|gurgaon|gurugram|navi\s+mumbai|thane|[a-z]+\s+(?:area|locality|suburb|sector|nagar|colony|layout|extension))\b/i;

function extractLocationFromText(text: string): string | undefined {
  const match = LOCATION_PATTERN.exec(text);
  return match ? match[1] : undefined;
}

/** Property name mention extraction — looks for known signals in outbound text. */
function extractPropertyMentionFromReply(outbound: string): Array<{ name: string; factsShown: string[] }> {
  const mentions: Array<{ name: string; factsShown: string[] }> = [];
  const brochureShown = /brochure|pdf|floor\s+plan/i.test(outbound);
  const priceShown = /price|cost|₹|crore|lakh|starting\s+from/i.test(outbound);
  const amenitiesShown = /amenities|pool|gym|club|garden/i.test(outbound);

  // Extract project name — matches bold names or "* [Name]*" WhatsApp formatting.
  const namePattern = /\*([A-Z][a-zA-Z\s]{3,40})\*/g;
  let match = namePattern.exec(outbound);
  while (match !== null) {
    const name = match[1].trim();
    if (name.length > 3 && name.length < 50) {
      const factsShown: string[] = [];
      if (priceShown) factsShown.push('price');
      if (brochureShown) factsShown.push('brochure');
      if (amenitiesShown) factsShown.push('amenities');
      mentions.push({ name, factsShown });
    }
    match = namePattern.exec(outbound);
  }
  return mentions;
}

/** Build an upcomingVisits entry from a live context snapshot. */
function buildUpcomingVisitEntry(
  visit: NonNullable<LiveContextSnapshot['activeVisit']>,
): LeadMemory['upcomingVisits'] {
  return [
    {
      visitId: visit.visitId,
      propertyName: visit.propertyName ?? undefined,
      scheduledAt: typeof visit.scheduledAt === 'string'
        ? visit.scheduledAt
        : (visit.scheduledAt as Date).toISOString(),
      status: visit.status,
    },
  ];
}

/**
 * Compute a LeadMemory delta for one buyer turn using deterministic rules.
 * Never calls an LLM. Never throws.
 *
 * @param params - Turn data from the buyer pipeline.
 * @returns Partial LeadMemory delta to merge.
 */
export function extractLeadMemoryDelta(params: ExtractBuyerMemoryDeltaParams): Partial<LeadMemory> {
  const delta: Partial<LeadMemory> = {};

  const combinedText = `${params.messageText} ${params.outboundText}`;

  // --- Budget ---
  const aiBudget = params.aiExtractedInfo;
  if (aiBudget?.budget_min || aiBudget?.budget_max) {
    delta.budget = {
      min: aiBudget.budget_min ?? undefined,
      max: aiBudget.budget_max ?? undefined,
      currency: 'INR',
    };
  } else {
    const extracted = extractBudgetFromText(params.messageText);
    if (extracted) {
      delta.budget = { ...extracted, currency: 'INR' };
    }
  }

  // --- Location preference ---
  const aiLocation = params.aiExtractedInfo?.location_preference;
  if (aiLocation) {
    delta.locationPreference = aiLocation;
  } else {
    const loc = extractLocationFromText(combinedText);
    if (loc) delta.locationPreference = loc;
  }

  // --- Projects discussed ---
  const propertyMentions = extractPropertyMentionFromReply(params.outboundText);
  if (propertyMentions.length > 0) {
    delta.projectsDiscussed = propertyMentions.map((m) => ({
      name: m.name,
      factsShown: m.factsShown,
    }));
  }

  // --- Upcoming visits ---
  if (params.visitCommit?.committed && params.visitCommit.visitId && params.visitCommit.scheduledAt) {
    const mode = params.visitCommit.mode;
    if (mode === 'cancelled') {
      // Clear upcoming visits if explicitly cancelled
      delta.upcomingVisits = [];
    } else if (mode === 'scheduled' || mode === 'rescheduled') {
      delta.upcomingVisits = [
        {
          visitId: params.visitCommit.visitId,
          propertyName: params.visitCommit.propertyName ?? undefined,
          scheduledAt: params.visitCommit.scheduledAt.toISOString(),
          status: mode === 'rescheduled' ? 'scheduled' : 'scheduled',
        },
      ];
    }
  } else if (params.liveCtx?.activeVisit) {
    delta.upcomingVisits = buildUpcomingVisitEntry(params.liveCtx.activeVisit);
  }

  // --- Last intent ---
  if (params.workflowId) {
    delta.lastIntent = params.workflowId;
  }

  const summary = params.outboundText.trim().slice(0, 200);
  if (summary) {
    delta.conversationSummary = `${params.messageText.slice(0, 80)} → ${summary}`;
  }

  return delta;
}

/**
 * Infers the most likely buyer workflow ID from message text using regex rules.
 * Mirrors the fast-path in `tryRunBuyerWorkflow`. Returns null when no workflow matches.
 *
 * @param messageText - Raw customer message text.
 * @returns A workflow ID string or null when no match.
 */
export function inferBuyerWorkflowIdFromMessage(messageText: string): string | null {
  const text = messageText.toLowerCase();
  if (/\b(cancel|call\s+off)\b.*\b(visit|appointment)\b/.test(text)) return 'cancel_visit';
  if (/\b(reschedule|move|push|change)\b.*\b(visit|appointment|slot)\b/.test(text)) return 'reschedule_visit';
  if (/\b(push|move)\b.*\b(appointment|visit)\b/.test(text)) return 'reschedule_visit';
  if (/\b(book|schedule)\b.*\b(visit|appointment|site\s+visit)\b/.test(text)) return 'schedule_visit';
  if (/\b(site\s+visit|property\s+visit)\b/.test(text)) return 'schedule_visit';
  if (/\b(brochure|pdf|details|share)\b/.test(text)) return 'brochure_request';
  if (/\b(price|cost|how much|rate)\b/.test(text)) return 'price_inquiry';
  if (/\b(available|availability|units left|in stock)\b/.test(text)) return 'availability_check';
  if (/\b(amenit|pool|gym|clubhouse)\b/.test(text)) return 'amenities_question';
  if (/\b(talk\s+to|speak\s+to|human|agent|call\s+me|callback|call\s+back)\b/.test(text)) return 'escalate_to_human';
  return null;
}

/**
 * Fire-and-forget wrapper: extract delta then patch lead memory.
 * Safe to call without await — errors are caught and logged internally.
 *
 * @param params - Turn data from the buyer pipeline.
 */
export async function extractAndPatchLeadMemory(params: ExtractBuyerMemoryDeltaParams): Promise<void> {
  try {
    const delta = extractLeadMemoryDelta(params);

    // Merge with existing projectsDiscussed to avoid overwriting prior mentions.
    const hasNewProjects = (delta.projectsDiscussed?.length ?? 0) > 0;
    if (hasNewProjects) {
      const current = await getLeadMemory(params.leadId);
      const existingNames = new Set(current.projectsDiscussed?.map((p) => p.name) ?? []);
      const merged = [
        ...(current.projectsDiscussed ?? []),
        ...(delta.projectsDiscussed ?? []).filter((p) => !existingNames.has(p.name)),
      ];
      delta.projectsDiscussed = merged.slice(0, 10); // cap at 10 projects
    }

    await patchLeadMemory(params.leadId, delta);
  } catch (err: unknown) {
    logger.warn('extractAndPatchLeadMemory failed', {
      leadId: params.leadId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
