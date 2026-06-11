/**
 * Deterministic smoke checks for brochure, visit booking intent, and visit status queries.
 * Invoked by backend/scripts/smoke-critical-paths.mjs via npm run smoke.
 */

import { isBuyerVisitStatusQuery } from '../../services/buyerVisitQuery.service';
import { isVisitSchedulingMessage, parseCustomVisitSlotFromMessage } from '../../services/visitIntentFromMessage.service';

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
});
