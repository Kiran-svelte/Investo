/**
 * Unit tests for copilotGreeting.util.ts
 *
 * Covers: happy paths, Unicode edge cases, boundary conditions,
 * and special characters that caused the original regression bug.
 */

import {
  isCopilotGreeting,
  normalizeCopilotInboundText,
} from '../../src/utils/copilotGreeting.util';

describe('normalizeCopilotInboundText', () => {
  it('strips zero-width spaces', () => {
    expect(normalizeCopilotInboundText('hi\u200b')).toBe('hi');
  });

  it('strips soft-hyphen (U+00AD)', () => {
    expect(normalizeCopilotInboundText('hello\u00ad')).toBe('hello');
  });

  it('strips zero-width non-joiner (U+200C)', () => {
    expect(normalizeCopilotInboundText('\u200chi')).toBe('hi');
  });

  it('strips BOM (U+FEFF)', () => {
    expect(normalizeCopilotInboundText('\ufeffhi')).toBe('hi');
  });

  it('strips line separator (U+2028)', () => {
    expect(normalizeCopilotInboundText('hi\u2028')).toBe('hi');
  });

  it('collapses CR+LF into single space', () => {
    expect(normalizeCopilotInboundText('hi\r\nthere')).toBe('hi there');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeCopilotInboundText('  hi  ')).toBe('hi');
  });

  it('returns empty string for all-invisible input', () => {
    expect(normalizeCopilotInboundText('\u200b\u200c\u200d')).toBe('');
  });

  it('does not modify normal text', () => {
    expect(normalizeCopilotInboundText('visits today')).toBe('visits today');
  });
});

describe('isCopilotGreeting', () => {
  // Happy paths
  it('returns true for "hi"', () => {
    expect(isCopilotGreeting('hi')).toBe(true);
  });

  it('returns true for "hello"', () => {
    expect(isCopilotGreeting('hello')).toBe(true);
  });

  it('returns true for "hey"', () => {
    expect(isCopilotGreeting('hey')).toBe(true);
  });

  it('returns true for "namaste"', () => {
    expect(isCopilotGreeting('namaste')).toBe(true);
  });

  it('returns true for "good morning"', () => {
    expect(isCopilotGreeting('good morning')).toBe(true);
  });

  it('returns true for "good evening"', () => {
    expect(isCopilotGreeting('good evening')).toBe(true);
  });

  it('returns true for "help"', () => {
    expect(isCopilotGreeting('help')).toBe(true);
  });

  it('returns true for "start"', () => {
    expect(isCopilotGreeting('start')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isCopilotGreeting('HI')).toBe(true);
    expect(isCopilotGreeting('Hello')).toBe(true);
  });

  // Regression: invisible Unicode characters caused false negatives
  it('returns true for "hi" followed by zero-width space (the original bug)', () => {
    expect(isCopilotGreeting('hi\u200b')).toBe(true);
  });

  it('returns true for "hi" with BOM prefix', () => {
    expect(isCopilotGreeting('\ufeffhi')).toBe(true);
  });

  it('returns true for "hi!" with punctuation', () => {
    expect(isCopilotGreeting('hi!')).toBe(true);
  });

  it('returns true for "hi." with period', () => {
    expect(isCopilotGreeting('hi.')).toBe(true);
  });

  // Negative cases — should NOT be treated as greetings
  it('returns false for CRM command "visits today"', () => {
    expect(isCopilotGreeting('visits today')).toBe(false);
  });

  it('returns false for "update lead status"', () => {
    expect(isCopilotGreeting('update lead status')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isCopilotGreeting('')).toBe(false);
  });

  it('returns false for all-invisible input (zero-width spaces only)', () => {
    expect(isCopilotGreeting('\u200b\u200c')).toBe(false);
  });

  it('returns false for messages longer than 50 chars', () => {
    expect(isCopilotGreeting('hi this is a very long message that should not match at all ever')).toBe(false);
  });

  it('returns false for "visits on 6th june" (the visit reschedule bug)', () => {
    expect(isCopilotGreeting('visits on 6th june')).toBe(false);
  });

  // Edge cases
  it('returns false for null-like input (empty after strip)', () => {
    expect(isCopilotGreeting('\u200b\u200d\ufeff')).toBe(false);
  });

  it('returns false for numbers', () => {
    expect(isCopilotGreeting('123')).toBe(false);
  });
});
