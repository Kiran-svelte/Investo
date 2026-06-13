import { describe, expect, it } from 'vitest';
import { ensureArray } from './safeApiData';

describe('ensureArray', () => {
  it('returns arrays unchanged', () => {
    expect(ensureArray([1, 2])).toEqual([1, 2]);
  });

  it('returns empty array for nullish and objects', () => {
    expect(ensureArray(null)).toEqual([]);
    expect(ensureArray(undefined)).toEqual([]);
    expect(ensureArray({ items: [] })).toEqual([]);
  });
});
