const SESSION_MODE_KEY = 'investo_session_mode';
export const COOKIE_SESSION_MODE = 'httpOnly_cookie';

export function isCookieSessionMode(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(SESSION_MODE_KEY) === COOKIE_SESSION_MODE;
}

export function enableCookieSessionMode(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(SESSION_MODE_KEY, COOKIE_SESSION_MODE);
}

export function disableCookieSessionMode(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(SESSION_MODE_KEY);
}
