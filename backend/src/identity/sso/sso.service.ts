import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import config from '../../config';
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { authService } from '../../services/auth.service';
import { normalizeAuthEmail } from '../../services/auth.service';
import { getCompanyIdentityConfigRow } from '../identityConfig.service';
import {
  isPlatformKeycloakEnabled,
  resolveCompanyForSsoLogin,
  resolveOidcCredentialsForCompany,
} from '../keycloak/platformKeycloak.service';
import { decryptMfaSecret } from '../../utils/mfaCrypto.util';
import {
  buildOidcAuthorizeUrl,
  exchangeAuthorizationCode,
  resolveOidcUserProfile,
} from './ssoOidc.service';
import { consumeSsoState, storeSsoState } from './ssoState.service';

function prismaClient(): any {
  return prisma as any;
}

export interface SsoStartResult {
  redirect_url: string;
  state: string;
}

export class SsoService {
  isEnabled(): boolean {
    return config.features.sso === true;
  }

  async startLogin(email: string): Promise<SsoStartResult> {
    if (!this.isEnabled()) {
      throw new Error('SSO is not enabled');
    }

    const normalizedEmail = normalizeAuthEmail(email);
    const state = crypto.randomBytes(24).toString('hex');
    const nonce = crypto.randomBytes(16).toString('hex');

    if (config.identity.ssoTestIdp && !isPlatformKeycloakEnabled()) {
      const existingUser = await prismaClient().user.findFirst({
        where: { email: normalizedEmail, status: 'active' },
        select: { id: true, companyId: true },
      });
      if (!existingUser) {
        throw new Error('No active account found for this email. Use password login or ask your admin to invite you.');
      }

      const redirectUrl = `${config.identity.ssoCallbackBaseUrl}/api/auth/sso/callback?state=${state}&test=1&email=${encodeURIComponent(normalizedEmail)}&name=${encodeURIComponent(normalizedEmail.split('@')[0])}&external_id=${encodeURIComponent(`test:${normalizedEmail}`)}`;
      return { redirect_url: redirectUrl, state };
    }

    const resolution = await resolveCompanyForSsoLogin(normalizedEmail);
    if (!resolution) {
      throw new Error('No active account found for this email. Use password login or ask your admin to invite you.');
    }
    if (!resolution.config.sso_enabled && !config.keycloak.ssoAllTenants) {
      throw new Error('SSO is not enabled for your organization');
    }

    const row = await getCompanyIdentityConfigRow(resolution.companyId);
    const oidc = await resolveOidcCredentialsForCompany(
      resolution.companyId,
      row,
      decryptMfaSecret,
    );
    if (!oidc) {
      throw new Error('OIDC is not configured for this company');
    }

    await storeSsoState(state, {
      email: normalizedEmail,
      companyId: resolution.companyId,
      nonce,
    });

    const redirectUri = `${config.identity.ssoCallbackBaseUrl}/api/auth/sso/callback`;
    const redirectUrl = await buildOidcAuthorizeUrl({
      issuer: oidc.issuer,
      clientId: oidc.clientId,
      redirectUri,
      state,
      nonce,
      loginHint: normalizedEmail,
    });

    return { redirect_url: redirectUrl, state };
  }

  async completeOidcCallback(code: string, state: string): Promise<{
    tokens: Awaited<ReturnType<typeof authService.issueTokensForUser>>;
    email: string;
  }> {
    const statePayload = await consumeSsoState(state);
    if (!statePayload) {
      throw new Error('Invalid or expired SSO state');
    }

    const row = await getCompanyIdentityConfigRow(statePayload.companyId);
    const oidc = await resolveOidcCredentialsForCompany(
      statePayload.companyId,
      row,
      decryptMfaSecret,
    );
    if (!oidc) {
      throw new Error('OIDC not configured for company');
    }

    const redirectUri = `${config.identity.ssoCallbackBaseUrl}/api/auth/sso/callback`;
    const tokens = await exchangeAuthorizationCode({
      issuer: oidc.issuer,
      clientId: oidc.clientId,
      clientSecret: oidc.clientSecret,
      redirectUri,
      code,
    });

    const profile = await resolveOidcUserProfile({
      issuer: oidc.issuer,
      accessToken: tokens.accessToken,
      idToken: tokens.idToken,
    });

    if (normalizeAuthEmail(profile.email) !== statePayload.email) {
      throw new Error('OIDC email does not match requested login email');
    }

    const authTokens = await this.completeCallback({
      email: profile.email,
      name: profile.name,
      external_id: profile.external_id,
      company_id: statePayload.companyId,
    });

    return { tokens: authTokens, email: profile.email };
  }

  async completeCallback(params: {
    email: string;
    name: string;
    external_id: string;
    company_id?: string;
  }): Promise<Awaited<ReturnType<typeof authService.issueTokensForUser>>> {
    const normalizedEmail = normalizeAuthEmail(params.email);

    let user = await prismaClient().user.findFirst({
      where: { email: normalizedEmail, status: 'active' },
    });

    let companyId = user?.companyId || params.company_id;

    if (!companyId && !config.identity.ssoTestIdp) {
      const resolution = await resolveCompanyForSsoLogin(normalizedEmail);
      if (!resolution) throw new Error('No SSO company mapping for email domain');
      companyId = resolution.companyId;
    }

    if (!companyId && config.identity.ssoTestIdp) {
      throw new Error('No active account found for this email');
    }

    if (!user && companyId) {
      user = await prismaClient().user.findFirst({
        where: {
          companyId,
          OR: [
            { externalId: params.external_id },
            { email: normalizedEmail },
          ],
        },
      });
    }

    if (!user) {
      if (config.identity.ssoTestIdp || isPlatformKeycloakEnabled()) {
        throw new Error('No active account found for this email. Ask your admin to invite you first.');
      }
      user = await prismaClient().user.create({
        data: {
          id: uuidv4(),
          companyId: companyId!,
          email: normalizedEmail,
          name: params.name || normalizedEmail.split('@')[0],
          authProvider: 'sso',
          externalId: params.external_id,
          role: 'viewer',
          status: 'active',
        },
      });
    } else {
      user = await prismaClient().user.update({
        where: { id: user.id },
        data: {
          authProvider: 'sso',
          externalId: params.external_id,
          name: params.name || user.name,
        },
      });
      companyId = user.companyId;
    }

    await prismaClient().auditLog.create({
      data: {
        companyId,
        userId: user.id,
        action: 'sso_login',
        resourceType: 'user',
        resourceId: user.id,
        details: {
          external_id: params.external_id,
          provider: isPlatformKeycloakEnabled() ? 'keycloak' : 'oidc',
        },
      },
    });

    logger.info('SSO login completed', { userId: user.id, companyId });
    return authService.issueTokensForUser(user.id);
  }
}

export const ssoService = new SsoService();
