import config from '../config';

export type CompanyWhatsAppCredentials = {
  provider: 'meta';
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
};

export type ParsedCompanyWhatsAppSettings = {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  appSecret: string;
};

function normalizeStringLike(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** Platform env fallback is dev/test only — enterprise tenants must store Meta creds per company. */
export function allowPlatformWhatsAppCredentialFallback(): boolean {
  return config.env !== 'production';
}

export function extractCompanyWhatsAppSettings(settings: unknown): ParsedCompanyWhatsAppSettings {
  const root = (settings && typeof settings === 'object' && !Array.isArray(settings))
    ? (settings as Record<string, unknown>)
    : {};
  const whatsapp = (root.whatsapp && typeof root.whatsapp === 'object' && !Array.isArray(root.whatsapp))
    ? (root.whatsapp as Record<string, unknown>)
    : {};
  const meta = (whatsapp.meta && typeof whatsapp.meta === 'object' && !Array.isArray(whatsapp.meta))
    ? (whatsapp.meta as Record<string, unknown>)
    : whatsapp;

  return {
    phoneNumberId:
      normalizeStringLike(meta.phoneNumberId)
      || normalizeStringLike(meta.phone_number_id)
      || normalizeStringLike(whatsapp.phoneNumberId),
    accessToken:
      normalizeStringLike(meta.accessToken)
      || normalizeStringLike(whatsapp.accessToken),
    verifyToken:
      normalizeStringLike(meta.verifyToken)
      || normalizeStringLike(whatsapp.verifyToken),
    appSecret:
      normalizeStringLike(meta.appSecret)
      || normalizeStringLike(meta.app_secret)
      || normalizeStringLike(whatsapp.appSecret),
  };
}

export function isCompanyWhatsAppConfigured(settings: unknown): boolean {
  const parsed = extractCompanyWhatsAppSettings(settings);
  return Boolean(parsed.phoneNumberId && parsed.accessToken);
}

/**
 * Resolve outbound/inbound Meta credentials for one tenant.
 * In production, returns null when company settings are incomplete (no Railway env fallback).
 */
export function resolveCompanyWhatsAppConfigFromSettings(
  settings: unknown,
  options?: {
    phoneNumberIdHint?: string;
    allowPlatformFallback?: boolean;
  },
): CompanyWhatsAppCredentials | null {
  const parsed = extractCompanyWhatsAppSettings(settings);
  const allowFallback = options?.allowPlatformFallback ?? allowPlatformWhatsAppCredentialFallback();

  const phoneNumberId = parsed.phoneNumberId || (allowFallback ? config.whatsapp.phoneNumberId : '');
  const accessToken = parsed.accessToken || (allowFallback ? config.whatsapp.accessToken : '');
  const verifyToken = parsed.verifyToken || (allowFallback ? config.whatsapp.verifyToken : '');

  const resolvedPhoneNumberId = phoneNumberId || normalizeStringLike(options?.phoneNumberIdHint);

  if (!resolvedPhoneNumberId || !accessToken) {
    return null;
  }

  return {
    provider: 'meta',
    phoneNumberId: resolvedPhoneNumberId,
    accessToken,
    verifyToken,
  };
}

export function resolvePlatformWebhookAppSecret(settings?: unknown): string {
  const companySecret = settings ? extractCompanyWhatsAppSettings(settings).appSecret : '';
  if (companySecret) return companySecret;
  if (allowPlatformWhatsAppCredentialFallback()) {
    return config.whatsapp.appSecret || '';
  }
  return '';
}
