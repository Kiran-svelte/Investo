import { CookieOptions, Response } from 'express';
import config from '../config';
import type { TokenPair } from '../services/auth.service';

export const ACCESS_TOKEN_COOKIE = 'investo_access_token';
export const REFRESH_TOKEN_COOKIE = 'investo_refresh_token';

function isProductionEnv(): boolean {
  return config.env === 'production';
}

function baseCookieOptions(): CookieOptions {
  const secure = isProductionEnv();
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    domain: process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined,
  };
}

function accessTokenMaxAgeMs(): number {
  const raw = config.jwt.expiresIn;
  if (typeof raw === 'string' && raw.endsWith('h')) {
    const hours = Number.parseInt(raw, 10);
    if (Number.isFinite(hours)) return hours * 60 * 60 * 1000;
  }
  if (typeof raw === 'string' && raw.endsWith('m')) {
    const minutes = Number.parseInt(raw, 10);
    if (Number.isFinite(minutes)) return minutes * 60 * 1000;
  }
  return 24 * 60 * 60 * 1000;
}

function refreshTokenMaxAgeMs(): number {
  const raw = config.jwt.refreshExpiresIn;
  if (typeof raw === 'string' && raw.endsWith('d')) {
    const days = Number.parseInt(raw, 10);
    if (Number.isFinite(days)) return days * 24 * 60 * 60 * 1000;
  }
  return 7 * 24 * 60 * 60 * 1000;
}

export function setAuthSessionCookies(res: Response, tokens: TokenPair): void {
  const base = baseCookieOptions();
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...base,
    path: '/api',
    maxAge: accessTokenMaxAgeMs(),
  });
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...base,
    path: '/api/auth',
    maxAge: refreshTokenMaxAgeMs(),
  });
}

export function clearAuthSessionCookies(res: Response): void {
  const base = baseCookieOptions();
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...base, path: '/api' });
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...base, path: '/api/auth' });
}

export function readAccessTokenFromCookies(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [name, ...rest] = part.trim().split('=');
    if (name === ACCESS_TOKEN_COOKIE) {
      const value = rest.join('=').trim();
      return value || null;
    }
  }
  return null;
}

export function readRefreshTokenFromCookies(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [name, ...rest] = part.trim().split('=');
    if (name === REFRESH_TOKEN_COOKIE) {
      const value = rest.join('=').trim();
      return value || null;
    }
  }
  return null;
}

export function authSessionResponseMeta() {
  return {
    storage: 'httpOnly_cookie' as const,
    access_cookie_path: '/api',
    refresh_cookie_path: '/api/auth',
    access_max_age_seconds: Math.floor(accessTokenMaxAgeMs() / 1000),
    refresh_max_age_seconds: Math.floor(refreshTokenMaxAgeMs() / 1000),
  };
}
