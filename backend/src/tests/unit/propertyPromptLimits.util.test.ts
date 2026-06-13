import config from '../../config';
import {
  getPropertyPromptLimits,
  resetPropertyPromptLimitsShadowLogForTests,
} from '../../utils/propertyPromptLimits.util';

describe('propertyPromptLimits.util', () => {
  const originalExpanded = config.features.expandedPropertyPrompts;
  const originalShadow = config.features.shadowMode;

  afterEach(() => {
    config.features.expandedPropertyPrompts = originalExpanded;
    config.features.shadowMode = originalShadow;
    resetPropertyPromptLimitsShadowLogForTests();
  });

  test('returns default limits when flag is off', () => {
    config.features.expandedPropertyPrompts = false;
    const limits = getPropertyPromptLimits();
    expect(limits.knowledgeChunksMax).toBe(10);
    expect(limits.availablePropertiesMax).toBe(10);
    expect(limits.listAmenitiesMax).toBe(5);
    expect(limits.moreInfoKnowledgeAppend).toBe(2);
  });

  test('returns expanded limits when flag is on', () => {
    config.features.expandedPropertyPrompts = true;
    const limits = getPropertyPromptLimits();
    expect(limits.knowledgeChunksMax).toBe(20);
    expect(limits.availablePropertiesMax).toBe(20);
    expect(limits.listAmenitiesMax).toBe(12);
    expect(limits.moreInfoKnowledgeAppend).toBe(5);
    expect(limits.focusedDescriptionMax).toBe(1800);
  });
});
