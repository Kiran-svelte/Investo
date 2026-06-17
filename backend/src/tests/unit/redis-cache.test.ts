/// <reference types="jest" />

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    env: 'test',
    redis: {
      url: '',
      token: '',
    },
  },
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { cacheDel, cacheGet, cacheIncr } from '../../config/redis';

describe('cacheIncr memory fallback', () => {
  it('stores counters under the same key read by cacheGet and cacheDel', async () => {
    const key = `test:cache-incr:${Date.now()}:${Math.random()}`;

    await cacheDel(key);

    await expect(cacheIncr(key, 60)).resolves.toBe(1);
    await expect(cacheGet<number>(key)).resolves.toBe(1);
    await expect(cacheIncr(key, 60)).resolves.toBe(2);
    await expect(cacheGet<number>(key)).resolves.toBe(2);

    await cacheDel(key);
    await expect(cacheGet<number>(key)).resolves.toBeNull();
  });
});
