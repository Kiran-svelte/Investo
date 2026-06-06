import {
  resolveCopilotComponents,
  shouldSendCopilotShortcutMenu,
} from '../../services/copilot/copilotButtonPolicy.service';

describe('copilotButtonPolicy.service', () => {
  test('welcome reply gets shortcut buttons', () => {
    const components = resolveCopilotComponents({ replyKind: 'welcome', outboundText: 'Hi' });
    expect(components).toHaveLength(1);
    expect(components[0].kind).toBe('buttons');
    expect((components[0] as any).buttons).toHaveLength(3);
  });

  test('completed action reply gets no buttons', () => {
    expect(
      resolveCopilotComponents({
        replyKind: 'workflow',
        outboundText: 'Visit scheduled successfully.',
      }),
    ).toEqual([]);
  });

  test('shouldSendCopilotShortcutMenu only for welcome/help', () => {
    expect(shouldSendCopilotShortcutMenu('welcome')).toBe(true);
    expect(shouldSendCopilotShortcutMenu('crm')).toBe(false);
  });
});
