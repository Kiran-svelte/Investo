import { describe, it, expect, beforeEach, vi } from 'vitest';
import { withAuthRefreshLock } from './authRefreshLock';

function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => store.delete(key),
    setItem: (key: string, value: string) => store.set(key, value),
  };
}

describe('withAuthRefreshLock', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('sessionStorage', createStorage());
  });

  it('runs the callback and releases the lock', async () => {
    const result = await withAuthRefreshLock(async () => 42);
    expect(result).toBe(42);
    expect(localStorage.getItem('investo_auth_refresh_lock')).toBeNull();
  });

  it('serializes concurrent refresh attempts', async () => {
    const order: number[] = [];
    const first = withAuthRefreshLock(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 50));
      return 'a';
    });
    const second = withAuthRefreshLock(async () => {
      order.push(2);
      return 'b';
    });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(order).toEqual([1, 2]);
  });
});
