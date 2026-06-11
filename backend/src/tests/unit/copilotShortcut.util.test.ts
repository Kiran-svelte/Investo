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

  it('returns welcome shortcuts only on welcome/help', async () => {
    expect(
      (await resolveStaffCopilotQuickActions({ replyKind: 'welcome', outboundText: 'Hi' }))?.length,
    ).toBe(3);
    const crmActions = await resolveStaffCopilotQuickActions({
      replyKind: 'crm',
      outboundText: 'Dashboard stats',
    });
    expect(crmActions?.map((a) => a.id)).toEqual([
      'copilot-visits-today',
      'copilot-new-leads',
      'copilot-visits-tomorrow',
    ]);
  });

  it('returns deterministic visit shortcuts after successful visit mutation replies', async () => {
    const actions = await resolveStaffCopilotQuickActions({
      replyKind: 'workflow',
      outboundText: 'Visit scheduled for tomorrow at 10am',
    });
    expect(actions?.map((a) => a.id)).toEqual([
      'copilot-confirm-visit',
      'copilot-reschedule-visit',
      'copilot-visits-today',
    ]);
  });

  it('returns visit action shortcuts when the reply mentions visits', async () => {
    const actions = await resolveStaffCopilotQuickActions({
      replyKind: 'workflow',
      outboundText: 'Which visit should I update? Share visit ID or describe the booking.',
    });
    expect(actions?.map((a) => a.id)).toEqual([
      'copilot-confirm-visit',
      'copilot-reschedule-visit',
      'copilot-visits-today',
    ]);
  });

  it('returns visit shortcuts after visit list CRM replies', async () => {
    const actions = await resolveStaffCopilotQuickActions({
      replyKind: 'crm',
      outboundText: "*Today's visits (2026-06-07)*\n\n1 visit",
    });
    expect(actions?.map((a) => a.id)).toEqual([
      'copilot-confirm-visit',
      'copilot-reschedule-visit',
      'copilot-visits-today',
    ]);
  });
});
