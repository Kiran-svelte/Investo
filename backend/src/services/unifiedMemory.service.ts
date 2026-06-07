/**
 * Unified Memory Service — single read facade over the lead's AI memory.
 *
 * Investo previously read lead context from several stores independently
 * (lead_memory blob, live CRM snapshot, message history, RAG chunks), which
 * could disagree. This facade establishes one canonical hierarchy and one
 * read entrypoint for both the buyer brain (`ai.service.ts`) and the staff
 * copilot (`agent-prompt-context.service.ts`).
 *
 * Canonical hierarchy (highest precedence first):
 *   1. liveLeadContext   — real-time Prisma read (freshness; e.g. a visit booked
 *                          30s ago that RAG has not embedded yet).
 *   2. leads.lead_memory  — canonical structured memory blob (budget, location,
 *                          projects discussed, summary). Backfilled from lead
 *                          columns + visits on first read.
 *   3. messages          — raw conversation history (audit / recent-asks).
 *
 * `client_memory_chunks` is a DERIVED index only. It must be rebuilt from the
 * stores above (via syncLeadClientMemory after a lead_memory patch); it is never
 * an independent source of truth and is intentionally not part of this facade's
 * resolved view.
 */

import { getLeadMemory, buildPromptMemoryBlock, type LeadMemory } from './lead-memory.service';
import { getLiveLeadContext, type LiveLeadContext } from './liveLeadContext.service';
import { buildConversationContextBlock } from './conversation-summary.service';

/** A visit entry in the resolved (precedence-applied) view. */
export interface ResolvedVisit {
  visitId: string;
  propertyName?: string | null;
  scheduledAt: string;
  status: string;
}

/** Precedence-applied view of the lead's memory across all stores. */
export interface ResolvedLeadMemory {
  status: string;
  budget?: LeadMemory['budget'];
  locationPreference?: string;
  /** Upcoming visits, preferring the real-time CRM snapshot over the extracted blob. */
  upcomingVisits: ResolvedVisit[];
}

/** Full unified read: canonical structured + freshness + a resolved view. */
export interface UnifiedLeadMemory {
  leadId: string;
  /** Canonical structured memory (leads.lead_memory). */
  structured: LeadMemory;
  /** Real-time CRM snapshot; null when companyId is unavailable. */
  live: LiveLeadContext | null;
  /** Precedence-applied convenience view (live > structured). */
  resolved: ResolvedLeadMemory;
}

function resolveUpcomingVisits(
  structured: LeadMemory,
  live: LiveLeadContext | null,
): ResolvedVisit[] {
  // Freshness layer wins: a visit just booked/rescheduled shows here before the
  // extracted blob catches up.
  if (live?.activeVisit) {
    return [
      {
        visitId: live.activeVisit.visitId,
        propertyName: live.activeVisit.propertyName,
        scheduledAt: live.activeVisit.scheduledAt.toISOString(),
        status: live.activeVisit.status,
      },
    ];
  }
  return structured.upcomingVisits ?? [];
}

/**
 * Reads the lead's memory from all canonical stores and returns both the raw
 * layers and a precedence-applied resolved view.
 *
 * @param leadId - Lead UUID.
 * @param companyId - Company scope; when provided, the live CRM snapshot is included.
 */
export async function getUnifiedLeadMemory(
  leadId: string,
  companyId?: string,
): Promise<UnifiedLeadMemory> {
  const structured = await getLeadMemory(leadId);
  const live = companyId ? await getLiveLeadContext(leadId, companyId) : null;

  const resolved: ResolvedLeadMemory = {
    // Status only exists on the live snapshot; structured blob has no status.
    status: live?.leadStatus ?? 'unknown',
    budget: structured.budget,
    locationPreference: structured.locationPreference,
    upcomingVisits: resolveUpcomingVisits(structured, live),
  };

  return { leadId, structured, live, resolved };
}

/**
 * Composes the prompt-facing memory blocks through a single entrypoint.
 *
 * Returns the structured "known facts" block (canonical) and the rolling
 * conversation context block (structured + history + live freshness). The live
 * CRM block itself is injected separately at the top of the system prompt by
 * callers that already hold it, so it is not duplicated here.
 */
export async function buildUnifiedMemoryContextBlock(input: {
  leadId: string;
  conversationId?: string | null;
  companyId?: string;
}): Promise<{ leadMemoryBlock: string; conversationContextBlock: string }> {
  const leadMemoryBlock = await buildPromptMemoryBlock(input.leadId);
  const conversationContextBlock = input.conversationId
    ? await buildConversationContextBlock(input.conversationId, input.leadId, input.companyId)
    : '';
  return { leadMemoryBlock, conversationContextBlock };
}
