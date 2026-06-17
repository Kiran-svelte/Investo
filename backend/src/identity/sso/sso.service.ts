import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

import config from '../../config';
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import { authService } from '../../services/auth.service';
import { normalizeAuthEmail } from '../../services/auth.service';
import { resolveCompanyByEmailDomain } from '../identityConfig.service';

function prismaClient(): any {
  return prisma as any;
}

export interface SsoStartResult {
  redirect_url: string;
  state: string;
}

export interface SsoProfile {
  external_id: string;
  email: string;
  name: string;
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

    if (config.identity.ssoTestIdp) {
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

    const resolution = await resolveCompanyByEmailDomain(normalizedEmail);
    if (!resolution?.config.sso_enabled) {
      throw new Error('SSO is not configured for this email domain');
    }

    const row = await prismaClient().companyIdentityConfig.findUnique({
      where: { companyId: resolution.companyId },
    });
    if (!row?.ssoOidcIssuer || !row?.ssoOidcClientId) {
      throw new Error('OIDC issuer/client not configured for company');
    }

    const redirectUri = `${config.identity.ssoCallbackBaseUrl}/api/auth/sso/callback`;
    const authorizeUrl = new URL(`${row.ssoOidcIssuer.replace(/\/+$/, '')}/authorize`);
    authorizeUrl.searchParams.set('client_id', row.ssoOidcClientId);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'openid email profile');
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('nonce', nonce);

    return { redirect_url: authorizeUrl.toString(), state };
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
      const resolution = await resolveCompanyByEmailDomain(normalizedEmail);
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
      if (config.identity.ssoTestIdp) {
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
        details: { external_id: params.external_id },
      },
    });

    logger.info('SSO login completed', { userId: user.id, companyId });
    return authService.issueTokensForUser(user.id);
  }
}

export const ssoService = new SsoService();
