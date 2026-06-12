/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    features: { fastWhatsAppReplies: true },
    whatsapp: { replyPacingEnabled: true, buyerLlmTimeoutMs: 12_000 },
    agentAi: { copilotTimeoutMs: 18_000 },
  },
}));

import {
  FAST_REPLY_BUDGETS_MS,
  getBuyerLlmTimeoutMs,
  getStaffCopilotTimeoutMs,
  isFastWhatsAppRepliesEnabled,
  isReplyPacingDisabled,
  resolveDefaultReplyPacing,
  resolveLlmReplyPacing,
  shouldSkipHeavyBuyerContext,
} from '../../utils/whatsappReplySpeed.util';
import { computeHumanReplyDelayMs } from '../../services/whatsappPresence.service';

describe('whatsappReplySpeed.util', () => {
  test('fast mode enabled by default', () => {
    expect(isFastWhatsAppRepliesEnabled()).toBe(true);
    expect(isReplyPacingDisabled()).toBe(true);
  });

  test('fast mode uses zero artificial pacing', () => {
    expect(resolveDefaultReplyPacing()).toBe('none');
    expect(resolveLlmReplyPacing()).toBe('none');
    expect(computeHumanReplyDelayMs(400, 'none')).toBe(0);
  });

  test('buyer and staff LLM caps match fast budgets', () => {
    expect(getBuyerLlmTimeoutMs()).toBe(12_000);
    expect(getBuyerLlmTimeoutMs()).toBeLessThanOrEqual(FAST_REPLY_BUDGETS_MS.buyerLlmCap);
    expect(getStaffCopilotTimeoutMs()).toBe(18_000);
    expect(getStaffCopilotTimeoutMs()).toBeLessThanOrEqual(FAST_REPLY_BUDGETS_MS.staffCopilotCap);
  });

  test('skips heavy context for simple Hi', () => {
    expect(shouldSkipHeavyBuyerContext('Hi', 0)).toBe(true);
    expect(shouldSkipHeavyBuyerContext('Tell me about Lake Vista 3BHK pricing and amenities', 10)).toBe(false);
  });
});

describe('whatsappReplySpeed pacing under sustained load', () => {
  test('50 sequential none-mode pacing calls stay under budget', async () => {
    const times: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const t0 = Date.now();
      await new Promise((r) => setTimeout(r, computeHumanReplyDelayMs(120, 'none')));
      times.push(Date.now() - t0);
    }
    const sorted = [...times].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    expect(p95).toBeLessThan(FAST_REPLY_BUDGETS_MS.pacingNone);
  });
});
