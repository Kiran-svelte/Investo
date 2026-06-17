/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    features: { metaCircuitBreaker: true },
  },
}));

import { executeMetaApiWithCircuitBreaker, getMetaApiCircuitState } from '../../services/metaCircuitBreaker.service';
import { resetCircuitBreakersForTests } from '../../utils/circuit-breaker';

describe('metaCircuitBreaker.service', () => {
  beforeEach(() => {
    resetCircuitBreakersForTests();
  });

  it('opens after repeated Meta failures and fails fast while open', async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(executeMetaApiWithCircuitBreaker(async () => {
        throw new Error('Meta 503');
      })).rejects.toThrow('Meta 503');
    }

    expect(getMetaApiCircuitState()).toBe('open');

    const blockedCall = jest.fn(async () => 'sent');
    await expect(executeMetaApiWithCircuitBreaker(blockedCall)).rejects.toThrow('Circuit breaker open');
    expect(blockedCall).not.toHaveBeenCalled();
  });
});
