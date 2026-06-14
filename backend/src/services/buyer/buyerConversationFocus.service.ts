import config from '../../config';
import logger from '../../config/logger';

export type BuyerFocusCommitments = {
  focusedProjectId?: string | null;
  focusUpdatedAt?: string;
  previousFocusedPropertyId?: string | null;
  /** Legacy key written by interactive browse — read when flag OFF path */
  selectedProjectId?: string | null;
};

export type BuyerConversationFocus = {
  focusedProjectId: string | null;
  focusedPropertyId: string | null;
  recommendedPropertyIds: string[];
  allowedPropertyIds: string[];
};

const ALLOWED_PROPERTY_IDS_MAX = 10;

function parseCommitments(raw: unknown): BuyerFocusCommitments {
  if (!raw || typeof raw !== 'object') return {};
  return raw as BuyerFocusCommitments;
}

function normalizeRecommendedIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === 'string').slice(0, ALLOWED_PROPERTY_IDS_MAX);
}

function buildAllowedPropertyIds(
  focusedPropertyId: string | null,
  recommendedPropertyIds: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  add(focusedPropertyId);
  for (const id of recommendedPropertyIds.slice(0, ALLOWED_PROPERTY_IDS_MAX)) {
    add(id);
  }
  return out.slice(0, ALLOWED_PROPERTY_IDS_MAX);
}

function cleanCommitmentsPatch(patch: BuyerFocusCommitments): BuyerFocusCommitments {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as BuyerFocusCommitments;
}

export function readBuyerConversationFocus(conversation: {
  selectedPropertyId: string | null;
  recommendedPropertyIds: unknown;
  commitments: unknown;
}): BuyerConversationFocus {
  const recommendedPropertyIds = normalizeRecommendedIds(conversation.recommendedPropertyIds);
  const commitments = parseCommitments(conversation.commitments);

  if (!config.features.buyerFocusStack) {
    return {
      focusedProjectId: null,
      focusedPropertyId: conversation.selectedPropertyId,
      recommendedPropertyIds,
      allowedPropertyIds: buildAllowedPropertyIds(conversation.selectedPropertyId, recommendedPropertyIds),
    };
  }

  const focusedProjectId =
    commitments.focusedProjectId
    ?? commitments.selectedProjectId
    ?? null;

  const focusedPropertyId = conversation.selectedPropertyId;

  return {
    focusedProjectId: focusedProjectId ?? null,
    focusedPropertyId,
    recommendedPropertyIds,
    allowedPropertyIds: buildAllowedPropertyIds(focusedPropertyId, recommendedPropertyIds),
  };
}

export function patchBuyerConversationFocus(
  current: BuyerConversationFocus,
  patch: Partial<{
    focusedProjectId: string | null;
    focusedPropertyId: string | null;
    recommendedPropertyIds: string[];
  }>,
): {
  focus: BuyerConversationFocus;
  commitmentsPatch: BuyerFocusCommitments;
  columnPatch: {
    selectedPropertyId?: string | null;
    recommendedPropertyIds?: string[];
  };
} {
  const nextProjectId = patch.focusedProjectId !== undefined
    ? patch.focusedProjectId
    : current.focusedProjectId;
  const nextPropertyId = patch.focusedPropertyId !== undefined
    ? patch.focusedPropertyId
    : current.focusedPropertyId;
  const nextRecommended = patch.recommendedPropertyIds !== undefined
    ? normalizeRecommendedIds(patch.recommendedPropertyIds)
    : current.recommendedPropertyIds;

  const focus: BuyerConversationFocus = {
    focusedProjectId: nextProjectId,
    focusedPropertyId: nextPropertyId,
    recommendedPropertyIds: nextRecommended,
    allowedPropertyIds: buildAllowedPropertyIds(nextPropertyId, nextRecommended),
  };

  const commitmentsPatch = cleanCommitmentsPatch({
    focusedProjectId: nextProjectId,
    focusUpdatedAt: new Date().toISOString(),
    previousFocusedPropertyId:
      patch.focusedPropertyId !== undefined && patch.focusedPropertyId !== current.focusedPropertyId
        ? current.focusedPropertyId
        : undefined,
    selectedProjectId: nextProjectId,
  });

  const columnPatch: {
    selectedPropertyId?: string | null;
    recommendedPropertyIds?: string[];
  } = {};

  if (patch.focusedPropertyId !== undefined) {
    columnPatch.selectedPropertyId = patch.focusedPropertyId;
  }
  if (patch.recommendedPropertyIds !== undefined) {
    columnPatch.recommendedPropertyIds = nextRecommended;
  }

  return { focus, commitmentsPatch, columnPatch };
}

const SWITCH_PHRASES = [
  'other project',
  'different project',
  'different one',
  'not that one',
  'another project',
];

export function detectProjectOrPropertySwitch(input: {
  messageText: string;
  current: BuyerConversationFocus;
  resolvedPropertyId: string | null;
  resolvedProjectId: string | null;
}): 'none' | 'property_switch' | 'project_switch' | 'ambiguous' {
  if (!config.features.buyerFocusStack) return 'none';

  const lower = input.messageText.toLowerCase();
  if (SWITCH_PHRASES.some((p) => lower.includes(p))) {
    return 'ambiguous';
  }

  if (
    input.resolvedProjectId
    && input.current.focusedProjectId
    && input.resolvedProjectId !== input.current.focusedProjectId
  ) {
    return 'project_switch';
  }

  if (
    input.resolvedPropertyId
    && input.current.focusedPropertyId
    && input.resolvedPropertyId !== input.current.focusedPropertyId
  ) {
    return 'property_switch';
  }

  return 'none';
}

export function logBuyerFocusUpdated(input: {
  conversationId: string;
  focus: BuyerConversationFocus;
  switchResult?: ReturnType<typeof detectProjectOrPropertySwitch>;
}): void {
  if (!config.features.buyerFocusStack) return;
  logger.info('buyerFocus.updated', {
    conversationId: input.conversationId,
    focusedProjectId: input.focus.focusedProjectId,
    focusedPropertyId: input.focus.focusedPropertyId,
    allowedCount: input.focus.allowedPropertyIds.length,
    switch: input.switchResult ?? 'none',
  });
}
