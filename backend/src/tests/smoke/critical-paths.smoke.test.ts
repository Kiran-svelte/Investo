/**
 * Deterministic smoke checks for brochure, visit booking intent, and visit status queries.
 * Invoked by backend/scripts/smoke-critical-paths.mjs via npm run smoke.
 */

import { isBuyerVisitStatusQuery } from '../../services/buyerVisitQuery.service';
import { isVisitSchedulingMessage, parseCustomVisitSlotFromMessage } from '../../services/visitIntentFromMessage.service';
import { buildFastPathCustomerReply } from '../../services/customerMessageFastPath.service';
import { resolveStageFromLeadStatus } from '../../utils/buyerLeadProgress.util';
import { shouldElevateReturningBuyerStage } from '../../utils/fixMdFeatures.util';

describe('critical-path smoke scenarios', () => {
  test('visit status query is recognized', () => {
    expect(isBuyerVisitStatusQuery('When is my visit?')).toBe(true);
    expect(isBuyerVisitStatusQuery('When is my site visit scheduled?')).toBe(true);
  });

  test('visit booking intent parses Saturday 4pm', () => {
    const message = 'Book visit Saturday 4pm';
    expect(isVisitSchedulingMessage(message)).toBe(true);
    const slot = parseCustomVisitSlotFromMessage(message);
    expect(slot).toBeTruthy();
  });

  test('brochure request matches explicit intent pattern', () => {
    const message = 'Send brochure for Sunset Heights';
    expect(/\b(brochure|pdf|send me)\b/i.test(message)).toBe(true);
  });

  test('custom greeting template is applied for first-contact Hi', () => {
    const reply = buildFastPathCustomerReply({
      customerMessage: 'Hi',
      companyName: 'Lake Vista',
      aiSettings: { greetingTemplate: 'Namaste from {business_name}!', defaultLanguage: 'en' },
      conversationHistory: [],
    });
    expect(reply?.text).toBe('Namaste from Lake Vista!');
  });

  test('visited lead stage resolves to shortlist not rapport', () => {
    expect(resolveStageFromLeadStatus('visited')).toBe('shortlist');
    expect(shouldElevateReturningBuyerStage('lead-123')).toBe(true);
  });

  test('expanded property prompt limits increase context caps', () => {
    process.env.FEATURE_EXPANDED_PROPERTY_PROMPTS = 'true';
    jest.resetModules();
    const { getPropertyPromptLimits } = require('../../utils/propertyPromptLimits.util');
    const limits = getPropertyPromptLimits();
    expect(limits.knowledgeChunksMax).toBeGreaterThan(10);
    delete process.env.FEATURE_EXPANDED_PROPERTY_PROMPTS;
    jest.resetModules();
  });
});
