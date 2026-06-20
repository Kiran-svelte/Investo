import bcrypt from 'bcrypt';
import crypto from 'crypto';

import prisma from '../config/prisma';
import { encryptMfaSecret } from '../utils/mfaCrypto.util';

function prismaClient(): any {
  return prisma as any;
}

export interface CompanyIdentityConfigView {
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

function normalizeConfig(row: any): CompanyIdentityConfigView {
  return {
    sso_enabled: Boolean(row?.ssoEnabled),
    sso_provider: row?.ssoProvider || null,
    sso_oidc_issuer: row?.ssoOidcIssuer || null,
    sso_oidc_client_id: row?.ssoOidcClientId || null,
    has_oidc_client_secret: Boolean(row?.ssoOidcClientSecretEnc),
    scim_enabled: Boolean(row?.scimEnabled),
    mfa_required: Boolean(row?.mfaRequired),
    mfa_methods: Array.isArray(row?.mfaMethods) ? row.mfaMethods : ['totp'],
    allowed_domains: Array.isArray(row?.allowedDomains) ? row.allowedDomains : [],
    ip_allowlist_enabled: Boolean(row?.ipAllowlistEnabled),
    ip_allowlist: Array.isArray(row?.ipAllowlist) ? row.ipAllowlist : [],
    has_scim_token: Boolean(row?.scimTokenHash),
  };
}

const DEFAULT_IDENTITY_CONFIG: CompanyIdentityConfigView = {
  sso_enabled: false,
  sso_provider: null,
  sso_oidc_issuer: null,
  sso_oidc_client_id: null,
  has_oidc_client_secret: false,
  scim_enabled: false,
  mfa_required: false,
  mfa_methods: ['totp'],
  allowed_domains: [],
  ip_allowlist_enabled: false,
  ip_allowlist: [],
  has_scim_token: false,
};

function isMissingIdentityTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('company_identity_configs') && message.includes('does not exist');
}

export async function getCompanyIdentityConfigRow(companyId: string): Promise<any | null> {
  try {
    return await prismaClient().companyIdentityConfig.findUnique({ where: { companyId } });
  } catch (err: unknown) {
    if (isMissingIdentityTableError(err)) {
      return null;
    }
    throw err;
  }
}

export async function getCompanyIdentityConfig(companyId: string): Promise<CompanyIdentityConfigView> {
  try {
    const row = await getCompanyIdentityConfigRow(companyId);
    if (!row) {
      return { ...DEFAULT_IDENTITY_CONFIG };
    }
    return normalizeConfig(row);
  } catch (err: unknown) {
    if (isMissingIdentityTableError(err)) {
      return { ...DEFAULT_IDENTITY_CONFIG };
    }
    throw err;
  }
}

export async function bootstrapCompanyIdentityConfig(companyId: string): Promise<void> {
  try {
    await prismaClient().companyIdentityConfig.upsert({
      where: { companyId },
      create: {
        companyId,
        ssoEnabled: false,
        scimEnabled: false,
        mfaRequired: false,
        allowedDomains: [],
      },
      update: {},
    });
  } catch (err: unknown) {
    if (isMissingIdentityTableError(err)) {
      return;
    }
    throw err;
  }
}

export async function upsertCompanyIdentityConfig(
  companyId: string,
  input: Partial<{
    sso_enabled: boolean;
    sso_provider: string | null;
    sso_oidc_issuer: string | null;
    sso_oidc_client_id: string | null;
    sso_oidc_client_secret: string | null;
    scim_enabled: boolean;
    mfa_required: boolean;
    mfa_methods: string[];
    allowed_domains: string[];
    ip_allowlist_enabled: boolean;
    ip_allowlist: string[];
    rotate_scim_token: boolean;
  }>,
): Promise<{ config: CompanyIdentityConfigView; scim_token_plain?: string }> {
  const data: Record<string, unknown> = {};
  if (input.sso_enabled !== undefined) data.ssoEnabled = input.sso_enabled;
  if (input.sso_provider !== undefined) data.ssoProvider = input.sso_provider;
  if (input.sso_oidc_issuer !== undefined) data.ssoOidcIssuer = input.sso_oidc_issuer;
  if (input.sso_oidc_client_id !== undefined) data.ssoOidcClientId = input.sso_oidc_client_id;
  if (input.sso_oidc_client_secret !== undefined) {
    const trimmed = String(input.sso_oidc_client_secret || '').trim();
    if (trimmed) {
      data.ssoOidcClientSecretEnc = encryptMfaSecret(trimmed);
    }
  }
  if (input.scim_enabled !== undefined) data.scimEnabled = input.scim_enabled;
  if (input.mfa_required !== undefined) data.mfaRequired = input.mfa_required;
  if (input.mfa_methods !== undefined) data.mfaMethods = input.mfa_methods;
  if (input.allowed_domains !== undefined) data.allowedDomains = input.allowed_domains;
  if (input.ip_allowlist_enabled !== undefined) data.ipAllowlistEnabled = input.ip_allowlist_enabled;
  if (input.ip_allowlist !== undefined) data.ipAllowlist = input.ip_allowlist;

  let scimTokenPlain: string | undefined;
  if (input.rotate_scim_token) {
    scimTokenPlain = crypto.randomBytes(32).toString('hex');
    data.scimTokenHash = await bcrypt.hash(scimTokenPlain, 10);
  }

  const row = await prismaClient().companyIdentityConfig.upsert({
    where: { companyId },
    create: { companyId, ...data },
    update: data,
  });

  return {
    config: normalizeConfig(row),
    scim_token_plain: scimTokenPlain,
  };
}

export async function resolveCompanyByEmailDomain(email: string): Promise<{ companyId: string; config: CompanyIdentityConfigView } | null> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;

  let rows: any[];
  try {
    rows = await prismaClient().companyIdentityConfig.findMany({
      where: { ssoEnabled: true },
      include: { company: { select: { id: true, status: true } } },
    });
  } catch (err: unknown) {
    if (isMissingIdentityTableError(err)) {
      return null;
    }
    throw err;
  }

  for (const row of rows) {
    const allowed = Array.isArray(row.allowedDomains) ? row.allowedDomains.map((d: string) => d.toLowerCase()) : [];
    if (allowed.includes(domain) && row.company?.status === 'active') {
      return { companyId: row.companyId, config: normalizeConfig(row) };
    }
  }

  return null;
}

export async function verifyScimBearerToken(companyId: string, token: string): Promise<boolean> {
  const row = await prismaClient().companyIdentityConfig.findUnique({ where: { companyId } });
  if (!row?.scimEnabled || !row.scimTokenHash) return false;
  return bcrypt.compare(token, row.scimTokenHash);
}

export async function findCompanyIdByScimToken(token: string): Promise<string | null> {
  const rows = await prismaClient().companyIdentityConfig.findMany({
    where: { scimEnabled: true, scimTokenHash: { not: null } },
  });

  for (const row of rows) {
    if (await bcrypt.compare(token, row.scimTokenHash)) {
      return row.companyId;
    }
  }
  return null;
}
