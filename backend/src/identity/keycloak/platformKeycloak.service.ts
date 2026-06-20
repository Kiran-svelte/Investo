import config from '../../config';
import prisma from '../../config/prisma';
import { normalizeAuthEmail } from '../../services/auth.service';
import {
  getCompanyIdentityConfig,
  resolveCompanyByEmailDomain,
  type CompanyIdentityConfigView,
} from '../identityConfig.service';

export interface PlatformKeycloakOidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  publicUrl: string;
  realm: string;
}

export function isPlatformKeycloakEnabled(): boolean {
  return config.keycloak.enabled === true
    && Boolean(config.keycloak.baseUrl)
    && Boolean(config.keycloak.clientId)
    && Boolean(config.keycloak.clientSecret);
}

export function getPlatformKeycloakOidcConfig(): PlatformKeycloakOidcConfig | null {
  if (!isPlatformKeycloakEnabled()) {
    return null;
  }

  const baseUrl = config.keycloak.baseUrl.replace(/\/+$/, '');
  const realm = config.keycloak.realm;
  return {
    publicUrl: baseUrl,
    realm,
    issuer: `${baseUrl}/realms/${realm}`,
    clientId: config.keycloak.clientId,
    clientSecret: config.keycloak.clientSecret,
  };
}

export function getPublicSsoConfig(): {
  keycloak_enabled: boolean;
  keycloak_url: string | null;
  realm: string | null;
  login_hint_supported: boolean;
} {
  const platform = getPlatformKeycloakOidcConfig();
  return {
    keycloak_enabled: Boolean(platform),
    keycloak_url: platform?.publicUrl ?? null,
    realm: platform?.realm ?? null,
    login_hint_supported: true,
  };
}

/**
 * Resolve tenant for SSO login. Platform Keycloak accepts any active user whose
 * company has SSO enabled (or SSO-all-tenants flag).
 */
export async function resolveCompanyForSsoLogin(
  email: string,
): Promise<{ companyId: string; config: CompanyIdentityConfigView } | null> {
  const normalized = normalizeAuthEmail(email);

  if (isPlatformKeycloakEnabled()) {
    const user = await prisma.user.findFirst({
      where: { email: normalized, status: 'active' },
      select: { companyId: true },
    });
    if (!user) {
      return null;
    }

    const companyConfig = await getCompanyIdentityConfig(user.companyId);
    if (!companyConfig.sso_enabled && !config.keycloak.ssoAllTenants) {
      return null;
    }

    return { companyId: user.companyId, config: companyConfig };
  }

  return resolveCompanyByEmailDomain(normalized);
}

export async function resolveOidcCredentialsForCompany(
  companyId: string,
  row: {
    ssoOidcIssuer?: string | null;
    ssoOidcClientId?: string | null;
    ssoOidcClientSecretEnc?: string | null;
  } | null,
  decryptSecret: (enc: string) => string,
): Promise<{ issuer: string; clientId: string; clientSecret: string } | null> {
  const platform = getPlatformKeycloakOidcConfig();
  if (platform) {
    return {
      issuer: platform.issuer,
      clientId: platform.clientId,
      clientSecret: platform.clientSecret,
    };
  }

  if (!row?.ssoOidcIssuer || !row?.ssoOidcClientId || !row.ssoOidcClientSecretEnc) {
    return null;
  }

  return {
    issuer: row.ssoOidcIssuer,
    clientId: row.ssoOidcClientId,
    clientSecret: decryptSecret(row.ssoOidcClientSecretEnc),
  };
}
