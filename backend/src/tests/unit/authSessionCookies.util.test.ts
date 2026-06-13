/// <reference types="jest" />

import {
  readAccessTokenFromCookies,
  readRefreshTokenFromCookies,
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '../../utils/authSessionCookies.util';

describe('authSessionCookies.util', () => {
  it('reads access and refresh tokens from cookie header', () => {
    const header = `${ACCESS_TOKEN_COOKIE}=access-abc; ${REFRESH_TOKEN_COOKIE}=refresh-xyz; other=1`;
    expect(readAccessTokenFromCookies(header)).toBe('access-abc');
    expect(readRefreshTokenFromCookies(header)).toBe('refresh-xyz');
  });

  it('returns null when cookies are absent', () => {
    expect(readAccessTokenFromCookies(undefined)).toBeNull();
    expect(readRefreshTokenFromCookies('other=1')).toBeNull();
  });
});
