import prisma from '../../config/prisma';
import type { InteractiveActionResult } from '../../types/whatsapp-turn.types';
import { transitionLeadStatus, transitionLeadToVisitScheduled } from '../leadTransition.service';

/**
 * Persist DB side-effects from an interactive button/list action.
 * Shared by whatsapp.service (primary path) and orchestrator safety net.
 */
export async function applyInteractiveActionSideEffects(
  actionResult: InteractiveActionResult,
  leadId: string,
  conversationId: string,
  conversation: {
    selectedPropertyId?: string | null;
    proposedVisitTime?: Date | null;
  },
): Promise<void> {
  if (actionResult.newState) {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        stage: actionResult.newState.stage as never,
        selectedPropertyId: actionResult.newState.selectedPropertyId || conversation.selectedPropertyId,
        proposedVisitTime: actionResult.newState.proposedVisitTime || conversation.proposedVisitTime,
        ...(actionResult.newState.recommendedPropertyIds && {
          recommendedPropertyIds: actionResult.newState.recommendedPropertyIds as never,
        }),
      },
    });
  }

  if (actionResult.leadStatus === 'visit_scheduled') {
    await transitionLeadToVisitScheduled(leadId);
  } else if (actionResult.leadStatus) {
    await transitionLeadStatus(leadId, actionResult.leadStatus as never);
  }
}
