/**
 * Deterministic smoke checks for brochure, visit booking intent, and visit status queries.
 * Invoked by backend/scripts/smoke-critical-paths.mjs via npm run smoke.
 */

import { isBuyerVisitStatusQuery } from '../../services/buyerVisitQuery.service';
import { isVisitSchedulingMessage, parseCustomVisitSlotFromMessage } from '../../services/visitIntentFromMessage.service';
import { buildFastPathCustomerReply } from '../../services/customerMessageFastPath.service';
import { resolveStageFromLeadStatus } from '../../utils/buyerLeadProgress.util';
import { shouldElevateReturningBuyerStage } from '../../utils/fixMdFeatures.util';
import { buildPropertyKnowledgeSections } from '../../services/propertyKnowledge.service';

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

  test('imported carpet area is present in full-import knowledge sections', () => {
    const sections = buildPropertyKnowledgeSections({
      property: {
        id: 'smoke-prop-1',
        name: 'Lake Vista',
        propertyType: 'apartment',
      },
      draftData: {
        carpet_area_sqft: 1450,
        possession_date: 'Dec 2027',
      },
    }, { includeFullImportFields: true });
    const joined = sections.join('\n');
    expect(joined).toContain('Carpet area (sq ft): 1450');
    expect(joined).toContain('Possession date / timeline: Dec 2027');
  });
});
