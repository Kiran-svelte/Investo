import {
  computeHumanReplyDelayMs,
  isReplyPacingGloballyDisabled,
  simulateHumanReplyPacing,
} from '../../services/whatsappPresence.service';

describe('whatsappPresence.service', () => {
  it('computes bounded human delay from message length (full mode)', () => {
    const short = computeHumanReplyDelayMs(10, 'full');
    const long = computeHumanReplyDelayMs(500, 'full');
    expect(short).toBeGreaterThanOrEqual(200);
    expect(long).toBeLessThanOrEqual(1200);
    expect(long).toBeGreaterThan(short);
  });

  it('uses shorter bounds for minimal mode', () => {
    const delay = computeHumanReplyDelayMs(100, 'minimal');
    expect(delay).toBeGreaterThanOrEqual(100);
    expect(delay).toBeLessThanOrEqual(400);
  });

  it('returns zero delay for none mode', () => {
    expect(computeHumanReplyDelayMs(500, 'none')).toBe(0);
  });

  it('simulateHumanReplyPacing completes without throw with minimal meta config', async () => {
    const start = Date.now();
    await simulateHumanReplyPacing({
      to: '+919876543210',
      whatsappConfig: { provider: 'meta' },
      outboundTextLength: 50,
      pacing: 'minimal',
    });
    expect(Date.now() - start).toBeLessThan(800);
  });

  it('simulateHumanReplyPacing skips delay for none mode', async () => {
    const start = Date.now();
    await simulateHumanReplyPacing({
      to: '+919876543210',
      whatsappConfig: { provider: 'meta', phoneNumberId: 'x', accessToken: 'y' },
      outboundTextLength: 200,
      pacing: 'none',
    });
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('isReplyPacingGloballyDisabled reads env flag', () => {
    const prev = process.env.WHATSAPP_REPLY_PACING_ENABLED;
    try {
      process.env.WHATSAPP_REPLY_PACING_ENABLED = 'false';
      expect(isReplyPacingGloballyDisabled()).toBe(true);
      delete process.env.WHATSAPP_REPLY_PACING_ENABLED;
      expect(isReplyPacingGloballyDisabled()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.WHATSAPP_REPLY_PACING_ENABLED;
      else process.env.WHATSAPP_REPLY_PACING_ENABLED = prev;
    }
  });
});
