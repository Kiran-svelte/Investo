const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'secret',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'apitokeninstance',
  'api_token_instance',
  'appsecret',
  'app_secret',
  'smtp_pass',
  'authorization',
  'apikey',
  'api_key',
]);

function maskSecretValue(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  if (value.length <= 4) return '****';
  return `${'*'.repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

export function redactSensitiveData<T>(input: T, depth = 0): T {
  if (depth > 8 || input === null || input === undefined) {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveData(item, depth + 1)) as T;
  }

  if (typeof input !== 'object') {
    return input;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    if (SENSITIVE_KEYS.has(normalized)) {
      result[key] = typeof value === 'string' && value.length > 0 ? maskSecretValue(value) : '[redacted]';
      continue;
    }
    result[key] = redactSensitiveData(value, depth + 1);
  }
  return result as T;
}

/** Strip WhatsApp/Meta secrets from company settings for API responses. */
export function sanitizeCompanySettings(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return {};
  }

  const copy = redactSensitiveData({ ...(settings as Record<string, unknown>) });
  const whatsapp = copy.whatsapp;
  if (whatsapp && typeof whatsapp === 'object' && !Array.isArray(whatsapp)) {
    const wa = whatsapp as Record<string, unknown>;
    for (const nestedKey of ['meta', 'greenapi']) {
      const nested = wa[nestedKey];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        wa[nestedKey] = redactSensitiveData(nested);
      }
    }
    copy.whatsapp = wa;
  }
  return copy;
}

export function sanitizeCompanyRecord<T extends Record<string, unknown>>(company: T): T {
  if (!company.settings) return company;
  return {
    ...company,
    settings: sanitizeCompanySettings(company.settings),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMaskedSecret(value: unknown): boolean {
  return typeof value === 'string' && /^\*+[A-Za-z0-9]{4}$/.test(value);
}

/** Deep-merge incoming settings; keep existing secrets when client sends masked placeholders. */
export function mergeSettingsPreservingSecrets(
  existing: unknown,
  incoming: unknown,
): Record<string, unknown> {
  const base = isPlainObject(existing) ? { ...existing } : {};
  if (!isPlainObject(incoming)) return base;

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (isMaskedSecret(value)) {
      continue;
    }
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeSettingsPreservingSecrets(result[key], value);
      continue;
    }
    if (SENSITIVE_KEYS.has(key.toLowerCase()) && (value === '' || value === null)) {
      continue;
    }
    result[key] = value;
  }
  return result;
}
