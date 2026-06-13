import { describe, expect, it } from 'vitest';
import { getApiErrorMessage } from './apiErrorMessage';

describe('getApiErrorMessage', () => {
  it('reads nested bulk import error message', () => {
    const err = {
      isAxiosError: true,
      message: 'Request failed',
      response: {
        data: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Some rows have extra columns or malformed cells.',
          },
        },
      },
    };

    expect(getApiErrorMessage(err, 'Fallback')).toBe('Some rows have extra columns or malformed cells.');
  });

  it('reads flat string error', () => {
    const err = {
      isAxiosError: true,
      response: { data: { error: 'Validation failed' } },
    };

    expect(getApiErrorMessage(err, 'Fallback')).toBe('Validation failed');
  });

  it('returns fallback for unknown errors', () => {
    expect(getApiErrorMessage({}, 'Fallback')).toBe('Fallback');
  });
});
