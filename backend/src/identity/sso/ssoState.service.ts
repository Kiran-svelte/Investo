import { cacheGet, cacheDel, cacheSet } from '../../config/redis';

const SSO_STATE_PREFIX = 'sso:state:';
const SSO_STATE_TTL_SECONDS = 15 * 60;

export interface SsoStatePayload {
  email: string;
  companyId: string;
  nonce: string;
}

export async function storeSsoState(state: string, payload: SsoStatePayload): Promise<void> {
  await cacheSet(`${SSO_STATE_PREFIX}${state}`, payload, SSO_STATE_TTL_SECONDS);
}

export async function consumeSsoState(state: string): Promise<SsoStatePayload | null> {
  const key = `${SSO_STATE_PREFIX}${state}`;
  const payload = await cacheGet<SsoStatePayload>(key);
  if (!payload) {
    return null;
  }
  await cacheDel(key);
  return payload;
}
