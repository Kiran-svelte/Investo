import type { NextBestAction } from '../services/conversationStateMachine';

/** Outbound text that already asks the user a direct question — skip stacked menus. */
const OUTBOUND_ASKS_QUESTION =
  /\b(would you like|let me know|does this work|shall i|when would you|preferred time|just to confirm|reply\s*["']?(yes|no)|anything specific)\b/i;

const OUTBOUND_SCHEDULING_PROMPT =
  /\b(schedule your visit|when would you prefer|pick a time|preferred time|site visit for)\b/i;

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

  if (OUTBOUND_ASKS_QUESTION.test(text)) return false;

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
