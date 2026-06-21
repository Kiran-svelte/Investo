/**
 * Deterministic smoke checks for brochure, visit booking intent, and visit status queries.
 * Invoked by backend/scripts/smoke-critical-paths.mjs via npm run smoke.
 */

import { isBuyerVisitStatusQuery } from '../../services/buyerVisitQuery.service';
import { isVisitSchedulingMessage, parseCustomVisitSlotFromMessage, isVisitNpsScoreMessage, parseVisitDateTimeFromMessage } from '../../services/visitIntentFromMessage.service';
import { parsePostVisitFeedbackMessage } from '../../services/buyer/postVisitFeedback.service';
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

  test('post-visit NPS rating is not treated as visit datetime', () => {
    expect(isVisitNpsScoreMessage('4')).toBe(true);
    expect(parseVisitDateTimeFromMessage('4')).toBeNull();
    expect(isVisitSchedulingMessage('4')).toBe(false);
    expect(parsePostVisitFeedbackMessage('4')).toEqual({ matched: true, kind: 'rating', rating: 4 });
    expect(parsePostVisitFeedbackMessage('Need some time to decide')).toEqual({
      matched: true,
      kind: 'sentiment',
      sentiment: 'defer',
    });
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

  test('admin enterprise modules default ON with kill switches', () => {
    delete process.env.FEATURE_PUBLIC_API;
    delete process.env.FEATURE_AI_REVIEW_QUEUE;
    jest.resetModules();
    const features = require('../../config').default.features;
    expect(features.publicApi).toBe(true);
    expect(features.aiReviewQueue).toBe(true);
    expect(features.orgBranches).toBe(true);
    process.env.FEATURE_PUBLIC_API = 'false';
    jest.resetModules();
    expect(require('../../config').default.features.publicApi).toBe(false);
  });

  test('multi-project enterprise flags load without throw', () => {
    expect(() => require('../../config').default.features).not.toThrow();
    const features = require('../../config').default.features;
    expect(features.multiVisitContext).toBe(false);
    expect(features.buyerFocusStack).toBe(false);
    expect(features.scopedAiCatalog).toBe(false);
  });

  test('readBuyerConversationFocus legacy path when flag off', () => {
    const { readBuyerConversationFocus } = require('../../services/buyer/buyerConversationFocus.service');
    const focus = readBuyerConversationFocus({
      selectedPropertyId: 'prop-1',
      recommendedPropertyIds: ['prop-1'],
      commitments: {},
    });
    expect(focus.focusedProjectId).toBeNull();
    expect(focus.focusedPropertyId).toBe('prop-1');
  });

  test('getLiveLeadContext returns upcomingVisits array shape', async () => {
    const { getLiveLeadContext } = require('../../services/liveLeadContext.service');
    jest.spyOn(require('../../config/prisma').default.lead, 'findFirst').mockResolvedValue(null);
    const ctx = await getLiveLeadContext('lead-x', 'co-x');
    expect(Array.isArray(ctx.upcomingVisits)).toBe(true);
  });
});
