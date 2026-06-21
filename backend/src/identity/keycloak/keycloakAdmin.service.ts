import config from '../../config';
import logger from '../../config/logger';

type KeycloakUserPayload = {
  username: string;
  email: string;
  emailVerified: boolean;
  enabled: boolean;
  firstName: string;
  lastName: string;
  attributes?: Record<string, string[]>;
};

function isKeycloakAdminConfigured(): boolean {
  return config.keycloak.enabled
    && Boolean(config.keycloak.baseUrl)
    && Boolean(config.keycloak.adminPassword);
}

async function getAdminToken(): Promise<string | null> {
  if (!isKeycloakAdminConfigured()) {
    return null;
  }

  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: config.keycloak.adminUsername,
    password: config.keycloak.adminPassword,
  });

  const res = await fetch(
    `${config.keycloak.baseUrl}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );

  if (!res.ok) {
    logger.error('Keycloak admin token request failed', { status: res.status });
    return null;
  }

  const payload = (await res.json()) as { access_token?: string };
  return payload.access_token || null;
}

async function adminFetch(
  token: string,
  method: string,
  pathSuffix: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${config.keycloak.baseUrl}${pathSuffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: 'Investo', lastName: 'User' };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ') || 'User',
  };
}

export type SyncKeycloakUserInput = {
  email: string;
  name: string;
  investoUserId: string;
  password?: string;
  temporaryPassword?: boolean;
};

/**
 * Ensure an active Investo user exists in the Keycloak SSO realm.
 * Without this, Keycloak forgot-password shows success but sends nothing (user_not_found).
 */
export async function syncKeycloakUser(input: SyncKeycloakUserInput): Promise<boolean> {
  if (!isKeycloakAdminConfigured()) {
    return false;
  }

  const email = input.email.trim().toLowerCase();
  if (!email) {
    return false;
  }

  try {
    const token = await getAdminToken();
    if (!token) {
      return false;
    }

    const realm = config.keycloak.realm;
    const listRes = await adminFetch(
      token,
      'GET',
      `/admin/realms/${realm}/users?email=${encodeURIComponent(email)}&exact=true`,
    );
    if (!listRes.ok) {
      logger.warn('Keycloak user lookup failed', { email, status: listRes.status });
      return false;
    }

    const existing = (await listRes.json()) as Array<{ id?: string }>;
    const { firstName, lastName } = splitName(input.name);

    if (existing.length === 0) {
      const payload: KeycloakUserPayload = {
        username: email,
        email,
        emailVerified: true,
        enabled: true,
        firstName,
        lastName,
        attributes: { investo_user_id: [input.investoUserId] },
      };
      const createRes = await adminFetch(token, 'POST', `/admin/realms/${realm}/users`, payload);
      if (!createRes.ok && createRes.status !== 409) {
        logger.warn('Keycloak user create failed', { email, status: createRes.status });
        return false;
      }
    }

    const refreshed = await adminFetch(
      token,
      'GET',
      `/admin/realms/${realm}/users?email=${encodeURIComponent(email)}&exact=true`,
    );
    const kcUser = ((await refreshed.json()) as Array<{ id?: string }>)[0];
    if (!kcUser?.id) {
      logger.warn('Keycloak user missing after sync', { email });
      return false;
    }

    if (input.password) {
      const credRes = await adminFetch(
        token,
        'PUT',
        `/admin/realms/${realm}/users/${kcUser.id}/reset-password`,
        {
          type: 'password',
          value: input.password,
          temporary: input.temporaryPassword === true,
        },
      );
      if (!credRes.ok) {
        logger.warn('Keycloak password sync failed', { email, status: credRes.status });
        return false;
      }
    }

    logger.info('Keycloak user synced', { email });
    return true;
  } catch (err) {
    logger.warn('Keycloak user sync error', {
      email,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function testKeycloakEmailDelivery(toEmail: string): Promise<{ ok: boolean; detail: string }> {
  if (!isKeycloakAdminConfigured()) {
    return { ok: false, detail: 'Keycloak admin credentials not configured on backend' };
  }

  try {
    const token = await getAdminToken();
    if (!token) {
      return { ok: false, detail: 'Keycloak admin token unavailable' };
    }

    const realm = config.keycloak.realm;
    const realmRes = await adminFetch(token, 'GET', `/admin/realms/${realm}`);
    if (!realmRes.ok) {
      return { ok: false, detail: `Failed to load realm (${realmRes.status})` };
    }

    const realmPayload = await realmRes.json() as { smtpServer?: Record<string, string> };
    const smtp = realmPayload.smtpServer || {};
    const testRes = await adminFetch(token, 'POST', `/admin/realms/${realm}/testSMTPConnection`, {
      ...smtp,
      to: toEmail,
    });

    if (testRes.ok) {
      return { ok: true, detail: 'Keycloak email test accepted' };
    }

    return {
      ok: false,
      detail: `Keycloak email test failed (${testRes.status}): ${(await testRes.text()).slice(0, 200)}`,
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
