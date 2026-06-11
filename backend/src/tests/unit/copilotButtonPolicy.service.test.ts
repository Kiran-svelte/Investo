import {
  resolveCopilotComponents,
  shouldSendCopilotShortcutMenu,
} from '../../services/copilot/copilotButtonPolicy.service';

describe('copilotButtonPolicy.service', () => {
  test('welcome reply gets shortcut buttons', async () => {
    const components = await resolveCopilotComponents({ replyKind: 'welcome', outboundText: 'Hi' });
    expect(components).toHaveLength(1);
    expect(components[0].kind).toBe('buttons');
    expect((components[0] as any).buttons).toHaveLength(3);
  });

  test('workflow reply gets deterministic visit buttons when LLM unavailable', async () => {
    const components = await resolveCopilotComponents({
      replyKind: 'workflow',
      outboundText: 'Visit scheduled successfully.',
    });
    expect(components).toHaveLength(1);
    expect((components[0] as { buttons: Array<{ id: string }> }).buttons.map((b) => b.id)).toEqual([
      'copilot-confirm-visit',
      'copilot-reschedule-visit',
      'copilot-visits-today',
    ]);
  });

  test('shouldSendCopilotShortcutMenu only for welcome/help', () => {
    expect(shouldSendCopilotShortcutMenu('welcome')).toBe(true);
    expect(shouldSendCopilotShortcutMenu('crm')).toBe(false);
  });
});
