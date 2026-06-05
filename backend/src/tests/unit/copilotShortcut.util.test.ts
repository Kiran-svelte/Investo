import {
  resolveCopilotInboundCommand,
  resolveStaffCopilotQuickActions,
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

  it('maps contextual visit buttons to commands', () => {
    expect(
      resolveCopilotInboundCommand({
        interactiveId: 'copilot-confirm-visit',
        messageText: 'Confirm visit',
      }),
    ).toBe('confirm visit');
  });

  it('returns welcome shortcuts only on welcome/help', () => {
    expect(resolveStaffCopilotQuickActions({ replyKind: 'welcome', outboundText: 'Hi' })?.length).toBe(3);
    expect(resolveStaffCopilotQuickActions({ replyKind: 'crm', outboundText: 'Dashboard stats' })).toBeNull();
  });

  it('returns visit action shortcuts after visit-related replies', () => {
    const actions = resolveStaffCopilotQuickActions({
      replyKind: 'workflow',
      outboundText: 'Visit scheduled for tomorrow at 10am',
    });
    expect(actions?.map((a) => a.id)).toEqual([
      'copilot-confirm-visit',
      'copilot-reschedule-visit',
      'copilot-complete-visit',
    ]);
  });
});
