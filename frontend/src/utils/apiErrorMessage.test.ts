import { describe, expect, it } from 'vitest';
import { getApiErrorMessage, getApiErrorResolutionId } from './apiErrorMessage';

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

  it('returns fallback for generic axios 400 message', () => {
    const err = {
      isAxiosError: true,
      message: 'Request failed with status code 400',
      response: { status: 400, data: {} },
    };
    expect(getApiErrorMessage(err, 'Please fix highlighted fields.')).toBe('Please fix highlighted fields.');
  });

  it('returns fallback for generic axios 403 message', () => {
    const err = {
      isAxiosError: true,
      message: 'Request failed with status code 403',
      response: { status: 403, data: {} },
    };
    expect(getApiErrorMessage(err, 'Only company admins can subscribe.')).toBe('Only company admins can subscribe.');
  });

  it('extracts resolution id from API payloads', () => {
    const err = {
      isAxiosError: true,
      response: {
        data: {
          message: 'Online payments are blocked.',
          resolutionId: 'INVESTO-20260629-CASHFREE-ACTIVATION',
        },
      },
    };

    expect(getApiErrorResolutionId(err)).toBe('INVESTO-20260629-CASHFREE-ACTIVATION');
  });
});
