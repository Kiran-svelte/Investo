import api, {
  ApiResponse,
  applyAuthSessionFromLoginResponse,
  AuthTokens,
  setTokens,
  isCookieSessionMode,
} from './api';
import type { AuthUser } from '../context/AuthContext';

export interface CompanyIdentityConfig {
  sso_enabled: boolean;
  sso_provider: string | null;
  sso_oidc_issuer: string | null;
  sso_oidc_client_id: string | null;
  has_oidc_client_secret: boolean;
  scim_enabled: boolean;
  mfa_required: boolean;
  mfa_methods: string[];
  allowed_domains: string[];
  ip_allowlist_enabled: boolean;
  ip_allowlist: string[];
  has_scim_token: boolean;
}

export interface PlatformIdentityFeatures {
  sso: boolean;
  mfa: boolean;
  scim: boolean;
  ip_allowlist: boolean;
}

export interface PublicSsoConfig {
  keycloak_enabled: boolean;
  keycloak_url: string | null;
  realm: string | null;
  login_hint_supported: boolean;
}

export interface SsoStartResult {
  redirect_url: string;
  state: string;
}

export interface BranchNode {
  id: string;
  company_id: string;
  name: string;
  parent_id: string | null;
  settings: Record<string, unknown>;
  member_count?: number;
  children?: BranchNode[];
}

export interface MfaEnrollResult {
  device_id: string;
  otpauth_url: string;
  secret: string;
}

export interface LoginMfaPending {
  mfa_required: true;
  mfa_token: string;
  mfa_purpose: 'mfa_enroll' | 'mfa_verify';
  user: AuthUser;
}

export interface LoginSuccessPayload {
  user: AuthUser;
  tokens: AuthTokens;
  session?: { storage?: string };
}

function applySession(payload: LoginSuccessPayload): AuthUser {
  applyAuthSessionFromLoginResponse(payload.session);
  if (!isCookieSessionMode()) {
    setTokens(payload.tokens.access_token, payload.tokens.refresh_token);
  }
  return payload.user;
}

export async function loginWithPassword(
  email: string,
  password: string,
): Promise<LoginSuccessPayload | LoginMfaPending> {
  const { data } = await api.post<
    ApiResponse<LoginSuccessPayload | LoginMfaPending>
  >('/auth/login', { email, password });

  const payload = data.data;
  if ('mfa_required' in payload && payload.mfa_required === true) {
    return payload as LoginMfaPending;
  }

  return payload as LoginSuccessPayload;
}

export async function getPublicSsoConfig(): Promise<PublicSsoConfig> {
  const { data } = await api.get<ApiResponse<PublicSsoConfig>>('/auth/sso/config');
  return data.data;
}

export async function startSsoLogin(email: string): Promise<SsoStartResult> {
  const { data } = await api.get<ApiResponse<SsoStartResult>>('/auth/sso/start', {
    params: { email },
  });
  return data.data;
}

export async function verifyMfaLogin(mfaToken: string, code: string): Promise<AuthUser> {
  const { data } = await api.post<
    ApiResponse<{ tokens: AuthTokens; session?: { storage?: string } }>
  >('/auth/mfa/verify', { mfa_token: mfaToken, code });

  const tokens = data.data.tokens;
  applyAuthSessionFromLoginResponse(data.data.session);
  if (!isCookieSessionMode()) {
    setTokens(tokens.access_token, tokens.refresh_token);
  }

  const me = await api.get<ApiResponse<AuthUser>>('/auth/me');
  return me.data.data;
}

export async function enrollMfaPending(mfaToken: string): Promise<MfaEnrollResult> {
  const { data } = await api.post<ApiResponse<MfaEnrollResult>>('/auth/mfa/enroll-pending', {
    mfa_token: mfaToken,
  });
  return data.data;
}

export async function verifyMfaEnrollmentPending(
  mfaToken: string,
  deviceId: string,
  code: string,
): Promise<AuthUser> {
  const { data } = await api.post<
    ApiResponse<{ tokens: AuthTokens; session?: { storage?: string } }>
  >('/auth/mfa/verify-enrollment-pending', {
    mfa_token: mfaToken,
    device_id: deviceId,
    code,
  });

  const tokens = data.data.tokens;
  applyAuthSessionFromLoginResponse(data.data.session);
  if (!isCookieSessionMode()) {
    setTokens(tokens.access_token, tokens.refresh_token);
  }

  const me = await api.get<ApiResponse<AuthUser>>('/auth/me');
  return me.data.data;
}

export async function getIdentitySettings(): Promise<{
  config: CompanyIdentityConfig;
  platformFeatures: PlatformIdentityFeatures;
}> {
  const { data } = await api.get<
    ApiResponse<CompanyIdentityConfig> & { platform_features?: PlatformIdentityFeatures }
  >('/settings/identity');
  return {
    config: data.data,
    platformFeatures: data.platform_features ?? {
      sso: false,
      mfa: false,
      scim: false,
      ip_allowlist: false,
    },
  };
}

export async function updateIdentitySettings(
  payload: Partial<CompanyIdentityConfig> & {
    sso_oidc_client_secret?: string | null;
    rotate_scim_token?: boolean;
  },
): Promise<{
  config: CompanyIdentityConfig;
  scim_token_plain: string | null;
  platformFeatures: PlatformIdentityFeatures;
}> {
  const { data } = await api.put<
    ApiResponse<CompanyIdentityConfig> & {
      scim_token_plain?: string | null;
      platform_features?: PlatformIdentityFeatures;
    }
  >('/settings/identity', payload);
  return {
    config: data.data,
    scim_token_plain: data.scim_token_plain ?? null,
    platformFeatures: data.platform_features ?? {
      sso: false,
      mfa: false,
      scim: false,
      ip_allowlist: false,
    },
  };
}

export async function listBranches(): Promise<BranchNode[]> {
  const { data } = await api.get<ApiResponse<BranchNode[]>>('/branches');
  return data.data;
}

export async function createBranch(input: {
  name: string;
  parent_id?: string | null;
}): Promise<BranchNode> {
  const { data } = await api.post<ApiResponse<BranchNode>>('/branches', input);
  return data.data;
}

export async function updateBranch(
  id: string,
  input: { name?: string; parent_id?: string | null },
): Promise<BranchNode> {
  const { data } = await api.patch<ApiResponse<BranchNode>>(`/branches/${id}`, input);
  return data.data;
}

export async function deleteBranch(id: string): Promise<void> {
  await api.delete(`/branches/${id}`);
}

export function isMfaPending(value: unknown): value is LoginMfaPending {
  return (
    typeof value === 'object'
    && value !== null
    && 'mfa_required' in value
    && (value as LoginMfaPending).mfa_required === true
  );
}

export { applySession };
