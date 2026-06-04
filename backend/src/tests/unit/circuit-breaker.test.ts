import { CircuitBreaker } from '../../utils/circuit-breaker';

describe('CircuitBreaker', () => {
  it('opens after consecutive failures', async () => {
    const breaker = new CircuitBreaker({
      name: 'test',
      failureThreshold: 2,
      recoveryTimeoutMs: 60_000,
    });

    const fail = () => breaker.execute(async () => {
      throw new Error('down');
    });

    await expect(fail()).rejects.toThrow('down');
    await expect(fail()).rejects.toThrow('down');
    await expect(fail()).rejects.toThrow(/Circuit breaker open/);
  });

  it('resets on success', async () => {
    const breaker = new CircuitBreaker({ name: 'test2', failureThreshold: 3 });
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.getState()).toBe('closed');
  });
});
