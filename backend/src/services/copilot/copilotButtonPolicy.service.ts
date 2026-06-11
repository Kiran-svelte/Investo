import type { WhatsAppComponent } from '../../types/whatsapp-turn.types';
import {
  resolveCopilotComponentsAsync,
  resolveStaffCopilotQuickActions,
  shouldSendCopilotShortcutMenu,
  type CopilotQuickActionInput,
  type CopilotReplyKind,
} from '../../utils/copilotShortcut.util';

export type { CopilotReplyKind, CopilotQuickActionInput };

export { shouldSendCopilotShortcutMenu };

/**
 * Resolve staff copilot quick-action components for one turn.
 * Now async — uses LLM-generated contextual buttons instead of hardcoded rules.
 * Returns at most one button component, or empty when no menu fits.
 *
 * @param input.replyKind - Classification of the outbound reply.
 * @param input.outboundText - Full outbound reply text.
 * @returns Resolved WhatsApp component array (0 or 1 items).
 */
export async function resolveCopilotComponents(
  input: CopilotQuickActionInput,
): Promise<WhatsAppComponent[]> {
  return resolveCopilotComponentsAsync(input);
}

export { resolveStaffCopilotQuickActions };
