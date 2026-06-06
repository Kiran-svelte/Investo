import type { WhatsAppComponent } from '../../types/whatsapp-turn.types';
import {
  resolveStaffCopilotQuickActions,
  shouldSendCopilotShortcutMenu,
  type CopilotQuickActionInput,
  type CopilotReplyKind,
} from '../../utils/copilotShortcut.util';

export type { CopilotReplyKind, CopilotQuickActionInput };

export { shouldSendCopilotShortcutMenu };

/**
 * Resolve staff copilot quick-action buttons for one turn.
 * Returns at most one button component, or empty when no menu fits.
 */
export function resolveCopilotComponents(input: CopilotQuickActionInput): WhatsAppComponent[] {
  const actions = resolveStaffCopilotQuickActions(input);
  if (!actions?.length) return [];
  return [{ kind: 'buttons', buttons: actions }];
}
