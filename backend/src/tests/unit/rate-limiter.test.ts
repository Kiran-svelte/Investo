import { buildLimitMessage } from '../../middleware/rateLimiter';

describe('rateLimiter helpers', () => {
  it('buildLimitMessage includes retryAfter', () => {
    const msg = buildLimitMessage(100, 'per user');
    expect(msg.retryAfter).toBe(60);
    expect(msg.error).toContain('100');
    expect(msg.error).toContain('per user');
  });
});
