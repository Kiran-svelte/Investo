/**
 * In-process circuit breaker for outbound dependencies (AI providers, webhooks).
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number;
  recoveryTimeoutMs?: number;
  halfOpenMaxAttempts?: number;
}

export class CircuitBreaker {
  readonly name: string;
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly halfOpenMaxAttempts: number;

  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenAttempts = 0;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 30_000;
    this.halfOpenMaxAttempts = options.halfOpenMaxAttempts ?? 2;
  }

  getState(): CircuitState {
    if (this.state === 'open' && Date.now() - this.openedAt >= this.recoveryTimeoutMs) {
      this.state = 'half_open';
      this.halfOpenAttempts = 0;
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();
    if (state === 'open') {
      throw new Error(`Circuit breaker open: ${this.name}`);
    }
    if (state === 'half_open' && this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
      throw new Error(`Circuit breaker half-open probe limit: ${this.name}`);
    }
    if (state === 'half_open') {
      this.halfOpenAttempts += 1;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'closed';
    this.halfOpenAttempts = 0;
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    if (this.state === 'half_open' || this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
      this.consecutiveFailures = 0;
    }
  }
}

const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  const existing = breakers.get(options.name);
  if (existing) return existing;
  const breaker = new CircuitBreaker(options);
  breakers.set(options.name, breaker);
  return breaker;
}

export function resetCircuitBreakersForTests(): void {
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
    breakers.clear();
  }
}
