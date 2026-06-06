/**
 * Staff copilot WhatsApp shortcut buttons — id → canonical CRM command.
 * Button titles vary by client; interactive ids are stable.
 */

export const COPILOT_WELCOME_BUTTONS = [
  { id: 'copilot-visits-today', title: 'Visits today', command: 'visits today' },
  { id: 'copilot-new-leads', title: 'New leads today', command: 'new leads today' },
  { id: 'copilot-visits-tomorrow', title: 'Visits tomorrow', command: 'visits tomorrow' },
] as const;

/** @deprecated Use COPILOT_WELCOME_BUTTONS */
export const COPILOT_SHORTCUT_BUTTONS = COPILOT_WELCOME_BUTTONS;

export const COPILOT_CONTEXT_BUTTONS = [
  { id: 'copilot-confirm-visit', title: 'Confirm visit', command: 'confirm visit' },
  { id: 'copilot-reschedule-visit', title: 'Reschedule visit', command: 'reschedule visit' },
  { id: 'copilot-complete-visit', title: 'Mark completed', command: 'complete visit' },
  { id: 'copilot-cancel-visit', title: 'Cancel visit', command: 'cancel visit' },
  { id: 'copilot-dashboard', title: 'Dashboard stats', command: 'dashboard stats' },
  { id: 'copilot-my-performance', title: 'My performance', command: 'my performance' },
  { id: 'copilot-list-leads', title: 'List leads', command: 'list leads' },
] as const;

const ALL_COPILOT_BUTTONS = [...COPILOT_WELCOME_BUTTONS, ...COPILOT_CONTEXT_BUTTONS];

const COPILOT_BUTTON_COMMANDS: Readonly<Record<string, string>> = Object.fromEntries(
  ALL_COPILOT_BUTTONS.map((button) => [button.id, button.command]),
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

  const byTitle = ALL_COPILOT_BUTTONS.find(
    (button) => button.title.toLowerCase() === messageText.toLowerCase(),
  );
  if (byTitle) return byTitle.command;

  return messageText;
}

export function isCopilotShortcutInteractiveId(interactiveId?: string | null): boolean {
  return Boolean(interactiveId?.trim().startsWith('copilot-'));
}

/** Welcome/help always get the default CRM shortcut row. */
export function shouldSendCopilotShortcutMenu(reason: CopilotReplyKind): boolean {
  return reason === 'welcome' || reason === 'help_fallback';
}

export type CopilotQuickActionInput = {
  replyKind: CopilotReplyKind;
  outboundText: string;
};

/**
 * Contextual staff copilot buttons — never the same 3 shortcuts on every reply.
 * Returns null when no menu should be sent.
 */
export function resolveStaffCopilotQuickActions(
  input: CopilotQuickActionInput,
): Array<{ id: string; title: string }> | null {
  if (shouldSendCopilotShortcutMenu(input.replyKind)) {
    return COPILOT_WELCOME_BUTTONS.map(({ id, title }) => ({ id, title }));
  }

  const text = input.outboundText.toLowerCase();

  if (/\b(updated|scheduled|rescheduled|cancelled|completed|confirmed|marked|sent)\b/i.test(text)) {
    return null;
  }

  if (input.replyKind === 'confirmation') {
    return null;
  }

  if (
    input.replyKind === 'workflow' &&
    (/\bescalat|urgent|human takeover|takeover\b/i.test(text) || text.includes('🚨'))
  ) {
    return [
      { id: 'copilot-list-leads', title: 'List leads' },
      { id: 'copilot-visits-today', title: 'Visits today' },
      { id: 'copilot-dashboard', title: 'Dashboard stats' },
    ];
  }

  if (
    /\b(which visit|share visit|what date|what time|when should|choose a visit)\b/i.test(text) &&
    (input.replyKind === 'workflow' || input.replyKind === 'crm' || input.replyKind === 'intent')
  ) {
    return [
      { id: 'copilot-confirm-visit', title: 'Confirm visit' },
      { id: 'copilot-reschedule-visit', title: 'Reschedule visit' },
      { id: 'copilot-complete-visit', title: 'Mark completed' },
    ];
  }

  if (input.replyKind === 'crm' && /\blead/i.test(text)) {
    return [
      { id: 'copilot-new-leads', title: 'New leads today' },
      { id: 'copilot-list-leads', title: 'List leads' },
      { id: 'copilot-dashboard', title: 'Dashboard stats' },
    ];
  }

  return null;
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
