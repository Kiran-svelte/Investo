import type { NextBestAction } from '../services/conversationStateMachine';

/** Hard blocks — yes/no confirm or explicit time-slot collection (not soft "would you like details"). */
const OUTBOUND_HARD_BLOCK_MENU =
  /\b(reply\s*["']?(yes|no)|just to confirm,?\s*(would|do) you|pick a time|when would you prefer to visit|preferred time for your visit)\b/i;

const OUTBOUND_SCHEDULING_PROMPT =
  /\b(schedule your visit|when would you prefer|pick a time|preferred time|site visit for)\b/i;

const OUTBOUND_CALL_CONFIRMATION =
  /\b(callback scheduled|callback rescheduled|callback updated|callback confirmed|specialist will confirm the call)\b/i;

export type QuickReplyRecentAction = 'rescheduled' | 'cancelled' | 'confirmed';

/**
 * Decide whether to attach contextual quick-reply buttons after an AI/workflow turn.
 * Many turns should end with text only (questions, completed actions, scheduling prompts).
 */
export function shouldAttachContextualQuickReplies(input: {
  stage: string;
  outboundText: string;
  nextAction?: NextBestAction;
  recentAction?: QuickReplyRecentAction;
  sentPropertyFilters?: boolean;
}): boolean {
  if (input.recentAction) return false;
  if (input.sentPropertyFilters) return false;
  if (input.stage === 'human_escalated' || input.stage === 'closed_won' || input.stage === 'closed_lost') {
    return false;
  }

  const text = input.outboundText.trim();
  if (!text) return false;

  if (OUTBOUND_HARD_BLOCK_MENU.test(text)) return false;

  // Call confirmations already ship dedicated call action buttons from the interactive handler.
  if (OUTBOUND_CALL_CONFIRMATION.test(text)) return false;

  // Soft follow-ups ("would you like more details?") still get Book Visit / Property Details buttons.

  // Dedicated schedule-visit flows send their own time-slot buttons via handleInteractiveAction.
  if (input.stage === 'visit_booking' && OUTBOUND_SCHEDULING_PROMPT.test(text)) {
    return false;
  }

  // Mid-booking: LLM is collecting a time — don't show generic "Anything else?" menus.
  if (
    input.stage === 'visit_booking' &&
    (input.nextAction?.action === 'continue' || OUTBOUND_SCHEDULING_PROMPT.test(text))
  ) {
    return false;
  }

  return true;
}
