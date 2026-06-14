import prisma from '../../config/prisma';
import config from '../../config';
import type { InteractiveActionResult } from '../../types/whatsapp-turn.types';
import { transitionLeadStatus, transitionLeadToVisitScheduled } from '../leadTransition.service';
import {
  logBuyerFocusUpdated,
  patchBuyerConversationFocus,
  readBuyerConversationFocus,
} from '../buyer/buyerConversationFocus.service';

export type InteractiveConversationRow = {
  selectedPropertyId?: string | null;
  recommendedPropertyIds?: unknown;
  commitments?: unknown;
  proposedVisitTime?: Date | null;
};

export type InteractiveStatePatch = {
  stage?: string;
  selectedPropertyId?: string | null;
  focusedProjectId?: string | null;
  focusedPropertyId?: string | null;
  recommendedPropertyIds?: string[];
  proposedVisitTime?: Date;
  commitments?: Record<string, unknown>;
};

export type InteractiveFocusNewState = NonNullable<InteractiveActionResult['newState']> & {
  focusedProjectId?: string | null;
  focusedPropertyId?: string | null;
};

function legacyNewStateFromPatch(
  patch: InteractiveStatePatch,
): NonNullable<InteractiveActionResult['newState']> {
  const legacy: NonNullable<InteractiveActionResult['newState']> = {};
  if (patch.stage) legacy.stage = patch.stage;
  const propertyId = patch.focusedPropertyId ?? patch.selectedPropertyId;
  if (propertyId !== undefined) legacy.selectedPropertyId = propertyId ?? undefined;
  if (patch.recommendedPropertyIds) legacy.recommendedPropertyIds = patch.recommendedPropertyIds;
  if (patch.proposedVisitTime) legacy.proposedVisitTime = patch.proposedVisitTime;
  return legacy;
}

/**
 * Merge interactive handler state with conversation focus when FEATURE_BUYER_FOCUS_STACK is ON.
 * Flag OFF preserves legacy selectedPropertyId-only patches.
 */
export function mergeInteractiveNewState(
  conversation: InteractiveConversationRow,
  patch: InteractiveStatePatch,
): {
  prismaData: {
    stage?: string;
    selectedPropertyId?: string | null;
    recommendedPropertyIds?: string[];
    proposedVisitTime?: Date;
    commitments?: unknown;
  };
  newState: NonNullable<InteractiveActionResult['newState']>;
} {
  if (!config.features.buyerFocusStack) {
    const legacy = legacyNewStateFromPatch(patch);
    const mergedCommitments = patch.commitments
      ? {
        ...(typeof conversation.commitments === 'object' && conversation.commitments
          ? conversation.commitments as object
          : {}),
        ...patch.commitments,
      }
      : undefined;

    return {
      newState: legacy,
      prismaData: {
        ...(patch.stage ? { stage: patch.stage } : {}),
        ...(legacy.selectedPropertyId !== undefined
          ? { selectedPropertyId: legacy.selectedPropertyId ?? null }
          : {}),
        ...(legacy.recommendedPropertyIds
          ? { recommendedPropertyIds: legacy.recommendedPropertyIds }
          : {}),
        ...(legacy.proposedVisitTime ? { proposedVisitTime: legacy.proposedVisitTime } : {}),
        ...(mergedCommitments ? { commitments: mergedCommitments } : {}),
      },
    };
  }

  const current = readBuyerConversationFocus({
    selectedPropertyId: conversation.selectedPropertyId ?? null,
    recommendedPropertyIds: conversation.recommendedPropertyIds,
    commitments: conversation.commitments,
  });

  const focusInput: Partial<{
    focusedProjectId: string | null;
    focusedPropertyId: string | null;
    recommendedPropertyIds: string[];
  }> = {};
  if (patch.focusedProjectId !== undefined) focusInput.focusedProjectId = patch.focusedProjectId;
  if (patch.focusedPropertyId !== undefined) focusInput.focusedPropertyId = patch.focusedPropertyId;
  else if (patch.selectedPropertyId !== undefined) focusInput.focusedPropertyId = patch.selectedPropertyId;
  if (patch.recommendedPropertyIds !== undefined) {
    focusInput.recommendedPropertyIds = patch.recommendedPropertyIds;
  }

  const { focus, commitmentsPatch, columnPatch } = patchBuyerConversationFocus(current, focusInput);
  const mergedCommitments = {
    ...(typeof conversation.commitments === 'object' && conversation.commitments
      ? conversation.commitments as object
      : {}),
    ...commitmentsPatch,
    ...(patch.commitments ?? {}),
  };

  const newState: NonNullable<InteractiveActionResult['newState']> = {
    ...(patch.stage ? { stage: patch.stage } : {}),
    ...(columnPatch.selectedPropertyId !== undefined
      ? { selectedPropertyId: columnPatch.selectedPropertyId ?? undefined }
      : patch.selectedPropertyId !== undefined
        ? { selectedPropertyId: patch.selectedPropertyId ?? undefined }
        : {}),
    ...(columnPatch.recommendedPropertyIds
      ? { recommendedPropertyIds: columnPatch.recommendedPropertyIds }
      : patch.recommendedPropertyIds
        ? { recommendedPropertyIds: patch.recommendedPropertyIds }
        : {}),
    ...(patch.proposedVisitTime ? { proposedVisitTime: patch.proposedVisitTime } : {}),
  };

  return {
    newState,
    prismaData: {
      ...(patch.stage ? { stage: patch.stage } : {}),
      ...columnPatch,
      ...(patch.proposedVisitTime ? { proposedVisitTime: patch.proposedVisitTime } : {}),
      commitments: mergedCommitments,
    },
  };
}

export function buildInteractiveFocusNewState(
  conversation: InteractiveConversationRow,
  patch: InteractiveStatePatch,
): InteractiveFocusNewState {
  const { newState } = mergeInteractiveNewState(conversation, patch);
  return {
    ...newState,
    ...(patch.focusedProjectId !== undefined ? { focusedProjectId: patch.focusedProjectId } : {}),
    ...(patch.focusedPropertyId !== undefined ? { focusedPropertyId: patch.focusedPropertyId } : {}),
  };
}

/**
 * Persist DB side-effects from an interactive button/list action.
 * Shared by whatsapp.service (primary path) and orchestrator safety net.
 */
export async function applyInteractiveActionSideEffects(
  actionResult: InteractiveActionResult,
  leadId: string,
  conversationId: string,
  conversation: InteractiveConversationRow,
): Promise<void> {
  if (actionResult.newState) {
    const extended = actionResult.newState as InteractiveFocusNewState;
    const patch: InteractiveStatePatch = {
      stage: extended.stage,
      selectedPropertyId: extended.selectedPropertyId,
      focusedProjectId: extended.focusedProjectId,
      focusedPropertyId: extended.focusedPropertyId,
      recommendedPropertyIds: extended.recommendedPropertyIds,
      proposedVisitTime: extended.proposedVisitTime,
    };
    const { prismaData } = mergeInteractiveNewState(conversation, patch);

    if (config.features.buyerFocusStack) {
      const focus = readBuyerConversationFocus({
        selectedPropertyId: prismaData.selectedPropertyId ?? conversation.selectedPropertyId ?? null,
        recommendedPropertyIds: prismaData.recommendedPropertyIds ?? conversation.recommendedPropertyIds,
        commitments: prismaData.commitments ?? conversation.commitments,
      });
      logBuyerFocusUpdated({ conversationId, focus });
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(prismaData.stage ? { stage: prismaData.stage as never } : {}),
        ...(prismaData.selectedPropertyId !== undefined
          ? { selectedPropertyId: prismaData.selectedPropertyId }
          : {}),
        ...(prismaData.proposedVisitTime
          ? { proposedVisitTime: prismaData.proposedVisitTime }
          : conversation.proposedVisitTime
            ? { proposedVisitTime: conversation.proposedVisitTime }
            : {}),
        ...(prismaData.recommendedPropertyIds
          ? { recommendedPropertyIds: prismaData.recommendedPropertyIds as never }
          : {}),
        ...(prismaData.commitments
          ? { commitments: prismaData.commitments as never }
          : {}),
      },
    });
  }

  if (actionResult.leadStatus === 'visit_scheduled') {
    await transitionLeadToVisitScheduled(leadId);
  } else if (actionResult.leadStatus) {
    await transitionLeadStatus(leadId, actionResult.leadStatus as never);
  }
}
