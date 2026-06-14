import config from '../../config';
import {
  detectProjectOrPropertySwitch,
  patchBuyerConversationFocus,
  readBuyerConversationFocus,
} from '../../services/buyer/buyerConversationFocus.service';

describe('buyerConversationFocus.service', () => {
  const originalFlag = config.features.buyerFocusStack;

  afterEach(() => {
    config.features.buyerFocusStack = originalFlag;
  });

  test('flag OFF returns legacy shape with null focusedProjectId', () => {
    config.features.buyerFocusStack = false;
    const focus = readBuyerConversationFocus({
      selectedPropertyId: 'prop-1',
      recommendedPropertyIds: ['prop-1', 'prop-2'],
      commitments: { selectedProjectId: 'proj-legacy' },
    });
    expect(focus.focusedProjectId).toBeNull();
    expect(focus.focusedPropertyId).toBe('prop-1');
    expect(focus.allowedPropertyIds).toEqual(['prop-1', 'prop-2']);
  });

  test('flag ON reads commitments.selectedProjectId as focusedProjectId', () => {
    config.features.buyerFocusStack = true;
    const focus = readBuyerConversationFocus({
      selectedPropertyId: 'prop-1',
      recommendedPropertyIds: ['prop-2'],
      commitments: { selectedProjectId: 'proj-a', focusedProjectId: 'proj-b' },
    });
    expect(focus.focusedProjectId).toBe('proj-b');
    expect(focus.allowedPropertyIds).toEqual(['prop-1', 'prop-2']);
  });

  test('patch property id updates column patch and commitments timestamp', () => {
    config.features.buyerFocusStack = true;
    const current = readBuyerConversationFocus({
      selectedPropertyId: 'prop-1',
      recommendedPropertyIds: [],
      commitments: {},
    });
    const { focus, commitmentsPatch, columnPatch } = patchBuyerConversationFocus(current, {
      focusedPropertyId: 'prop-2',
    });
    expect(focus.focusedPropertyId).toBe('prop-2');
    expect(columnPatch.selectedPropertyId).toBe('prop-2');
    expect(commitmentsPatch.focusUpdatedAt).toBeDefined();
    expect(commitmentsPatch.previousFocusedPropertyId).toBe('prop-1');
  });

  test('patch omits undefined commitment fields for Prisma JSON writes', () => {
    config.features.buyerFocusStack = true;
    const current = readBuyerConversationFocus({
      selectedPropertyId: 'prop-1',
      recommendedPropertyIds: [],
      commitments: {},
    });
    const { commitmentsPatch } = patchBuyerConversationFocus(current, {
      recommendedPropertyIds: ['prop-1'],
    });
    expect(Object.values(commitmentsPatch)).not.toContain(undefined);
    expect(commitmentsPatch.previousFocusedPropertyId).toBeUndefined();
  });

  test('detectProjectOrPropertySwitch detects property switch', () => {
    config.features.buyerFocusStack = true;
    const current = readBuyerConversationFocus({
      selectedPropertyId: 'prop-1',
      recommendedPropertyIds: [],
      commitments: { focusedProjectId: 'proj-a' },
    });
    expect(detectProjectOrPropertySwitch({
      messageText: 'Tell me about Lake Vista 304',
      current,
      resolvedPropertyId: 'prop-9',
      resolvedProjectId: 'proj-a',
    })).toBe('property_switch');
  });

  test('detectProjectOrPropertySwitch returns ambiguous for switch phrases', () => {
    config.features.buyerFocusStack = true;
    const current = readBuyerConversationFocus({
      selectedPropertyId: 'prop-1',
      recommendedPropertyIds: [],
      commitments: {},
    });
    expect(detectProjectOrPropertySwitch({
      messageText: 'Actually I meant a different project',
      current,
      resolvedPropertyId: null,
      resolvedProjectId: null,
    })).toBe('ambiguous');
  });

  test('allowedPropertyIds dedupes focused first and caps at 10', () => {
    config.features.buyerFocusStack = true;
    const ids = Array.from({ length: 12 }, (_, i) => `prop-${i}`);
    const focus = readBuyerConversationFocus({
      selectedPropertyId: 'prop-5',
      recommendedPropertyIds: ids,
      commitments: {},
    });
    expect(focus.allowedPropertyIds[0]).toBe('prop-5');
    expect(focus.allowedPropertyIds.length).toBeLessThanOrEqual(10);
    expect(new Set(focus.allowedPropertyIds).size).toBe(focus.allowedPropertyIds.length);
  });
});
