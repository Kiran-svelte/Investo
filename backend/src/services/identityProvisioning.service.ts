import config from '../config';
import logger from '../config/logger';

type NeonAuthUser = {
  id?: string;
  email?: string;
  name?: string;
};

type NeonAuthResponse = {
  token?: string | null;
  user?: NeonAuthUser;
  message?: string;
  code?: string;
};

export interface ProvisionIdentityInput {
  email: string;
  password: string;
  name: string;
}

export interface ProvisionIdentityResult {
  providerUserId: string | null;
}

const isDuplicateIdentityError = (status: number, payload: NeonAuthResponse): boolean => {
  const message = String(payload?.message || '').toLowerCase();
  const code = String(payload?.code || '').toLowerCase();
  return status === 409 || message.includes('already exists') || code.includes('already');
};

const parseJson = async <T>(response: Response): Promise<T | null> => {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

export async function provisionNeonIdentity(input: ProvisionIdentityInput): Promise<ProvisionIdentityResult> {
  const authUrl = config.neonAuth.url;
  if (!authUrl) {
    throw new Error('NEON_AUTH_URL is required for Neon identity provisioning');
  }

  const callbackURL = `${config.frontend.baseUrl}/login`;

  const signUpResp = await fetch(`${authUrl}/sign-up/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: config.frontend.baseUrl,
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      name: input.name,
      callbackURL,
    }),
  });

  const signUpPayload = (await parseJson<NeonAuthResponse>(signUpResp)) || {};

  if (signUpResp.ok) {
    return {
      providerUserId: signUpPayload.user?.id || null,
    };
  }

  // If user already exists in Neon Auth, sign in to fetch stable provider user id.
  if (isDuplicateIdentityError(signUpResp.status, signUpPayload)) {
    const signInResp = await fetch(`${authUrl}/sign-in/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: config.frontend.baseUrl,
      },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        callbackURL,
      }),
    });

    const signInPayload = (await parseJson<NeonAuthResponse>(signInResp)) || {};
    if (signInResp.ok) {
      return {
        providerUserId: signInPayload.user?.id || null,
      };
    }

    logger.warn('Neon identity exists but sign-in failed during provisioning', {
      email: input.email,
      status: signInResp.status,
      code: signInPayload.code,
      message: signInPayload.message,
    });
    throw new Error('Neon identity exists with a different password. Reset password or use another email.');
  }

  logger.error('Neon identity provisioning failed', {
    email: input.email,
    status: signUpResp.status,
    code: signUpPayload.code,
    message: signUpPayload.message,
  });

  throw new Error(signUpPayload.message || 'Failed to create identity in Neon Auth');
}