import {
  resolveCopilotInboundCommand,
  shouldSendCopilotShortcutMenu,
} from '../../utils/copilotShortcut.util';

describe('copilotShortcut.util', () => {
  it('maps shortcut button ids to canonical CRM commands', () => {
    expect(
      resolveCopilotInboundCommand({
        interactiveId: 'copilot-visits-today',
        messageText: 'Visits today',
      }),
    ).toBe('visits today');
  });

  it('only shows shortcut menu on welcome/help replies', () => {
    expect(shouldSendCopilotShortcutMenu('welcome')).toBe(true);
    expect(shouldSendCopilotShortcutMenu('help_fallback')).toBe(true);
    expect(shouldSendCopilotShortcutMenu('crm')).toBe(false);
    expect(shouldSendCopilotShortcutMenu('agent')).toBe(false);
  });
});
