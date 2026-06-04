import { withRetry } from '../../utils/retry';

describe('withRetry', () => {
  it('returns on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { maxAttempts: 3 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable errors then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry auth errors', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('401 invalid api key'));
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow('401');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
