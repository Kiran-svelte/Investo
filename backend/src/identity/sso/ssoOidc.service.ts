import logger from '../../config/logger';

export interface OidcDiscoveryDocument {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  issuer: string;
}

export interface OidcUserProfile {
  external_id: string;
  email: string;
  name: string;
}

const discoveryCache = new Map<string, { doc: OidcDiscoveryDocument; expiresAt: number }>();

function normalizeIssuer(issuer: string): string {
  return issuer.replace(/\/+$/, '');
}

export async function fetchOidcDiscovery(issuer: string): Promise<OidcDiscoveryDocument> {
  const normalized = normalizeIssuer(issuer);
  const cached = discoveryCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.doc;
  }

  const discoveryUrl = `${normalized}/.well-known/openid-configuration`;
  const res = await fetch(discoveryUrl, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed (${res.status}) for ${normalized}`);
  }

  const doc = (await res.json()) as OidcDiscoveryDocument;
  if (!doc.token_endpoint) {
    throw new Error('OIDC discovery missing token_endpoint');
  }

  discoveryCache.set(normalized, { doc, expiresAt: Date.now() + 60 * 60 * 1000 });
  return doc;
}

export async function exchangeAuthorizationCode(params: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{ accessToken: string; idToken?: string }> {
  const discovery = await fetchOidcDiscovery(params.issuer);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });

  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const payload = (await res.json()) as {
    access_token?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !payload.access_token) {
    const detail = payload.error_description || payload.error || `HTTP ${res.status}`;
    throw new Error(`OIDC token exchange failed: ${detail}`);
  }

  return {
    accessToken: payload.access_token,
    idToken: payload.id_token,
  };
}

function decodeJwtPayload(idToken: string): Record<string, unknown> {
  const parts = idToken.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid id_token format');
  }
  const json = Buffer.from(parts[1], 'base64url').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

async function fetchUserInfo(userinfoEndpoint: string, accessToken: string): Promise<OidcUserProfile> {
  const res = await fetch(userinfoEndpoint, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    throw new Error(`OIDC userinfo failed (${res.status})`);
  }
  const data = (await res.json()) as { sub?: string; email?: string; name?: string };
  const email = String(data.email || '').trim().toLowerCase();
  const externalId = String(data.sub || '').trim();
  if (!email || !externalId) {
    throw new Error('OIDC userinfo missing email or sub');
  }
  return {
    external_id: externalId,
    email,
    name: String(data.name || email.split('@')[0]).trim(),
  };
}

export async function resolveOidcUserProfile(params: {
  issuer: string;
  accessToken: string;
  idToken?: string;
}): Promise<OidcUserProfile> {
  if (params.idToken) {
    try {
      const claims = decodeJwtPayload(params.idToken);
      const email = String(claims.email || '').trim().toLowerCase();
      const sub = String(claims.sub || '').trim();
      if (email && sub) {
        return {
          external_id: sub,
          email,
          name: String(claims.name || email.split('@')[0]).trim(),
        };
      }
    } catch (err) {
      logger.warn('OIDC id_token parse failed, falling back to userinfo', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const discovery = await fetchOidcDiscovery(params.issuer);
  if (!discovery.userinfo_endpoint) {
    throw new Error('OIDC userinfo endpoint unavailable');
  }
  return fetchUserInfo(discovery.userinfo_endpoint, params.accessToken);
}

export async function buildOidcAuthorizeUrl(params: {
  issuer: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  loginHint?: string;
}): Promise<string> {
  const discovery = await fetchOidcDiscovery(params.issuer);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  if (params.loginHint) {
    url.searchParams.set('login_hint', params.loginHint);
  }
  return url.toString();
}
