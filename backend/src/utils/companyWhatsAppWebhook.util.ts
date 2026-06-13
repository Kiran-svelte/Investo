import prisma from '../config/prisma';
import config from '../config';
import {
  allowPlatformWhatsAppCredentialFallback,
  extractCompanyWhatsAppSettings,
  isCompanyWhatsAppConfigured,
  resolvePlatformWebhookAppSecret,
} from './companyWhatsAppConfig.util';
import { isPlatformCompany } from '../constants/platformCompany.constants';

function normalizeStringLike(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

export function extractWebhookPhoneNumberIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const root = body as Record<string, unknown>;
  const entries = Array.isArray(root.entry) ? root.entry : [];
  const ids = new Set<string>();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const changes = Array.isArray((entry as Record<string, unknown>).changes)
      ? (entry as Record<string, unknown>).changes as unknown[]
      : [];

    for (const change of changes) {
      if (!change || typeof change !== 'object') continue;
      const value = (change as Record<string, unknown>).value;
      if (!value || typeof value !== 'object') continue;
      const metadata = (value as Record<string, unknown>).metadata;
      if (!metadata || typeof metadata !== 'object') continue;
      const phoneNumberId = normalizeStringLike((metadata as Record<string, unknown>).phone_number_id);
      if (phoneNumberId) ids.add(phoneNumberId);
    }
  }

  return [...ids];
}

type CompanyWhatsAppRow = {
  id: string;
  slug?: string | null;
  settings: unknown;
};

async function loadActiveCompaniesWithWhatsApp(): Promise<CompanyWhatsAppRow[]> {
  const companies = await prisma.company.findMany({
    where: { status: 'active' },
    select: { id: true, slug: true, settings: true },
  });
  return companies.filter((company) => !isPlatformCompany(company));
}

function companyMatchesPhoneNumberId(settings: unknown, phoneNumberId: string): boolean {
  const parsed = extractCompanyWhatsAppSettings(settings);
  return parsed.phoneNumberId === phoneNumberId;
}

export async function resolveWebhookAppSecrets(body?: unknown): Promise<string[]> {
  const secrets = new Set<string>();
  const phoneNumberIds = body ? extractWebhookPhoneNumberIds(body) : [];

  const companies = await loadActiveCompaniesWithWhatsApp();

  if (phoneNumberIds.length > 0) {
    for (const company of companies) {
      for (const phoneNumberId of phoneNumberIds) {
        if (!companyMatchesPhoneNumberId(company.settings, phoneNumberId)) continue;
        const secret = resolvePlatformWebhookAppSecret(company.settings);
        if (secret) secrets.add(secret);
      }
    }
  } else {
    for (const company of companies) {
      if (!isCompanyWhatsAppConfigured(company.settings)) continue;
      const secret = resolvePlatformWebhookAppSecret(company.settings);
      if (secret) secrets.add(secret);
    }
  }

  if (secrets.size === 0 && allowPlatformWhatsAppCredentialFallback()) {
    const platformSecret = config.whatsapp.appSecret?.trim();
    if (platformSecret) secrets.add(platformSecret);
  }

  return [...secrets];
}

export async function matchesWebhookVerifyToken(token: string): Promise<boolean> {
  const normalized = token.trim();
  if (!normalized) return false;

  const companies = await loadActiveCompaniesWithWhatsApp();
  for (const company of companies) {
    const parsed = extractCompanyWhatsAppSettings(company.settings);
    if (parsed.verifyToken && parsed.verifyToken === normalized) {
      return true;
    }
  }

  if (allowPlatformWhatsAppCredentialFallback()) {
    return normalized === (config.whatsapp.verifyToken || '').trim();
  }

  return false;
}

export async function getProductionWhatsAppInboundHealth(): Promise<{
  status: 'ok' | 'blocked' | 'warn';
  reason: string;
}> {
  if (config.env !== 'production') {
    return { status: 'ok', reason: 'non-production' };
  }

  const companies = await loadActiveCompaniesWithWhatsApp();
  const configured = companies.filter((company) => isCompanyWhatsAppConfigured(company.settings));
  const withSecret = configured.filter((company) => Boolean(
    resolvePlatformWebhookAppSecret(company.settings),
  ));

  if (configured.length === 0) {
    return {
      status: 'warn',
      reason: 'No active company has Meta WhatsApp credentials in AI Settings',
    };
  }

  if (withSecret.length === 0) {
    return {
      status: 'blocked',
      reason: 'Meta app secret missing in company settings — webhooks rejected',
    };
  }

  return {
    status: 'ok',
    reason: `${withSecret.length} tenant(s) ready for Meta webhooks`,
  };
}

export async function resolveProductionWhatsAppAccessToken(companyId?: string): Promise<string | null> {
  if (companyId) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    if (!company) return null;
    const parsed = extractCompanyWhatsAppSettings(company.settings);
    if (parsed.accessToken) return parsed.accessToken;
    return allowPlatformWhatsAppCredentialFallback() ? config.whatsapp.accessToken || null : null;
  }

  const companies = await loadActiveCompaniesWithWhatsApp();
  for (const company of companies) {
    const parsed = extractCompanyWhatsAppSettings(company.settings);
    if (parsed.accessToken) return parsed.accessToken;
  }

  return allowPlatformWhatsAppCredentialFallback() ? config.whatsapp.accessToken || null : null;
}
