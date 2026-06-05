/**
 * Staff copilot WhatsApp shortcut buttons — id → canonical CRM command.
 * Button titles vary by client; interactive ids are stable.
 */

export const COPILOT_SHORTCUT_BUTTONS = [
  { id: 'copilot-visits-today', title: 'Visits today', command: 'visits today' },
  { id: 'copilot-new-leads', title: 'New leads today', command: 'new leads today' },
  { id: 'copilot-visits-tomorrow', title: 'Visits tomorrow', command: 'visits tomorrow' },
] as const;

const COPILOT_BUTTON_COMMANDS: Readonly<Record<string, string>> = Object.fromEntries(
  COPILOT_SHORTCUT_BUTTONS.map((button) => [button.id, button.command]),
);

/**
 * Resolve staff inbound text from a shortcut button id and/or visible title.
 */
export function resolveCopilotInboundCommand(input: {
  interactiveId?: string | null;
  messageText?: string | null;
}): string {
  const interactiveId = input.interactiveId?.trim();
  if (interactiveId && interactiveId.startsWith('copilot-')) {
    const mapped = COPILOT_BUTTON_COMMANDS[interactiveId];
    if (mapped) return mapped;
  }

  const messageText = (input.messageText ?? '').trim();
  if (!messageText) return '';

  const byTitle = COPILOT_SHORTCUT_BUTTONS.find(
    (button) => button.title.toLowerCase() === messageText.toLowerCase(),
  );
  if (byTitle) return byTitle.command;

  return messageText;
}

export function isCopilotShortcutInteractiveId(interactiveId?: string | null): boolean {
  return Boolean(interactiveId?.trim().startsWith('copilot-'));
}

/** Shortcut menu is shown on welcome/help only — not after every CRM reply. */
export function shouldSendCopilotShortcutMenu(reason: CopilotReplyKind): boolean {
  return reason === 'welcome' || reason === 'help_fallback';
}

export type CopilotReplyKind =
  | 'welcome'
  | 'help_fallback'
  | 'crm'
  | 'workflow'
  | 'intent'
  | 'agent'
  | 'confirmation'
  | 'error';
