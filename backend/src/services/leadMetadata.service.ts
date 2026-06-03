import type { Lead } from '@prisma/client';

export type LeadScore = 'hot' | 'warm' | 'cold';

export interface LeadMetadata {
  lead_score?: LeadScore;
  tags?: string[];
  source_detail?: string;
  lost_reason?: string;
  intent?: 'buy' | 'rent' | 'invest';
}

export function parseLeadMetadata(raw: unknown): LeadMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const m = raw as Record<string, unknown>;
  const score = m.lead_score;
  const validScore =
    score === 'hot' || score === 'warm' || score === 'cold' ? score : undefined;
  const tags = Array.isArray(m.tags)
    ? m.tags.filter((t): t is string => typeof t === 'string').slice(0, 20)
    : undefined;
  return {
    lead_score: validScore,
    tags,
    source_detail: typeof m.source_detail === 'string' ? m.source_detail.slice(0, 255) : undefined,
    lost_reason: typeof m.lost_reason === 'string' ? m.lost_reason.slice(0, 500) : undefined,
    intent:
      m.intent === 'buy' || m.intent === 'rent' || m.intent === 'invest'
        ? m.intent
        : undefined,
  };
}

export function mergeLeadMetadata(existing: unknown, patch: LeadMetadata): LeadMetadata {
  const base = parseLeadMetadata(existing);
  return {
    ...base,
    ...patch,
    tags: patch.tags !== undefined ? patch.tags : base.tags,
  };
}

export function metadataToDto(raw: unknown): LeadMetadata {
  return parseLeadMetadata(raw);
}

export function leadScoreFromConversation(urgencyScore: number, valueScore: number): LeadScore {
  const combined = urgencyScore + valueScore;
  if (combined >= 16 || urgencyScore >= 8) return 'hot';
  if (combined >= 12 || valueScore >= 7) return 'warm';
  return 'cold';
}

export function enrichLeadDto<T extends Record<string, unknown>>(lead: Lead & { metadata?: unknown }): T & {
  lead_score: LeadScore | null;
  tags: string[];
  source_detail: string | null;
  intent: string | null;
  lost_reason: string | null;
} {
  const meta = parseLeadMetadata(lead.metadata);
  return {
    ...(lead as unknown as T),
    lead_score: meta.lead_score ?? null,
    tags: meta.tags ?? [],
    source_detail: meta.source_detail ?? null,
    intent: meta.intent ?? null,
    lost_reason: meta.lost_reason ?? null,
  };
}
