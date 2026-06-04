import {
  computeHumanReplyDelayMs,
  simulateHumanReplyPacing,
} from '../../services/whatsappPresence.service';

describe('whatsappPresence.service', () => {
  it('computes bounded human delay from message length', () => {
    const short = computeHumanReplyDelayMs(10);
    const long = computeHumanReplyDelayMs(500);
    expect(short).toBeGreaterThanOrEqual(800);
    expect(long).toBeLessThanOrEqual(4500);
    expect(long).toBeGreaterThan(short);
  });

  it('simulateHumanReplyPacing completes without throw for greenapi', async () => {
    const start = Date.now();
    await simulateHumanReplyPacing({
      to: '+919876543210',
      whatsappConfig: { provider: 'greenapi' },
      outboundTextLength: 50,
    });
    expect(Date.now() - start).toBeGreaterThanOrEqual(800);
  });
});
