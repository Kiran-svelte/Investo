import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

if ((process.env.NODE_ENV || 'development') !== 'production' && fs.existsSync(envPath)) {
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  // Only override critical Neon-related keys to avoid stale shell env bugs,
  // while preserving explicit runtime overrides for things like PORT.
  const keysToPin = ['DATABASE_URL', 'DIRECT_URL', 'NEON_AUTH_URL'] as const;
  for (const key of keysToPin) {
    if (parsed[key]) {
      process.env[key] = parsed[key];
    }
  }
}

function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
}

export function isNeonDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsedUrl = new URL(databaseUrl);
    return parsedUrl.hostname.toLowerCase().includes('neon');
  } catch {
    return false;
  }
}

export function isPostgresDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsedUrl = new URL(databaseUrl);
    return parsedUrl.protocol === 'postgres:' || parsedUrl.protocol === 'postgresql:';
  } catch {
    return false;
  }
}

export function isNeonPoolerDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsedUrl = new URL(databaseUrl);
    const host = parsedUrl.hostname.toLowerCase();
    return host.includes('neon') && host.includes('pooler');
  } catch {
    return false;
  }
}

export function resolveDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;

  // Tests may run without real infrastructure; keep them isolated from runtime validation.
  if (isTestEnvironment()) {
    return databaseUrl || 'postgresql://test:test@127.0.0.1:5432/investo_test';
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required and must be a valid PostgreSQL connection string');
  }

  if (!isPostgresDatabaseUrl(databaseUrl)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string (postgres:// or postgresql://)');
  }

  try {
    const parsed = new URL(databaseUrl);
    // Some environments send channel_binding=require which can cause abrupt connection closes
    // with certain drivers/network paths. We normalize it out centrally.
    if (parsed.searchParams.get('channel_binding')) {
      parsed.searchParams.delete('channel_binding');
    }
    return parsed.toString();
  } catch {
    return databaseUrl;
  }
}

function normalizeNeonAuthUrl(rawUrl: string): string {
  if (!rawUrl) return '';

  try {
    const parsed = new URL(rawUrl);
    // Convert Data API hosts to Auth hosts when users paste the wrong endpoint.
    parsed.hostname = parsed.hostname.replace('.apirest.', '.neonauth.');

    // Convert Data API path to Auth path when needed.
    if (parsed.pathname.endsWith('/rest/v1')) {
      parsed.pathname = parsed.pathname.replace(/\/rest\/v1$/, '/auth');
    } else if (!parsed.pathname.endsWith('/auth')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') + '/auth';
    }

    parsed.search = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return rawUrl.replace(/\/+$/, '');
  }
}

function resolveJwtSecret(envName: 'JWT_SECRET' | 'JWT_REFRESH_SECRET', testDefault: string): string {
  const value = process.env[envName];

  if (value) {
    return value;
  }

  if (isTestEnvironment()) {
    return testDefault;
  }

  throw new Error(`${envName} is required when NODE_ENV is not test`);
}

function parseByteSize(value: string | undefined, fallbackBytes: number): number {
  if (!value) {
    return fallbackBytes;
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return fallbackBytes;
  }

  // Raw integer bytes.
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackBytes;
  }

  // Accept values like "50mb", "25 mb", "1gb".
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(b|bytes|kb|mb|gb)$/);
  if (!match) {
    return fallbackBytes;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return fallbackBytes;
  }

  const unit = match[2];
  const multiplier = unit === 'gb'
    ? 1024 * 1024 * 1024
    : unit === 'mb'
      ? 1024 * 1024
      : unit === 'kb'
        ? 1024
        : 1;

  return Math.floor(amount * multiplier);
}

function firstNonEmptyEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function normalizeOrigin(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.replace(/\/+$/, '');
  }
}

function buildCorsOrigins(): string[] {
  const defaultOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:4180',
    'http://localhost:5181',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4180',
    'http://127.0.0.1:5181',
    'https://investo-frontend-in3m.onrender.com',
    'https://investo-frontend-v2.onrender.com',
    'https://investo-six.vercel.app',
    'https://investo.vercel.app',
    'https://frontend-navy-eight-37.vercel.app',
  ];

  const envOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Array.from(
    new Set([...defaultOrigins, ...envOrigins].map(normalizeOrigin))
  );
}

export function isAllowedCorsOrigin(origin?: string | null): boolean {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = normalizeOrigin(origin);

  if (normalizedOrigin.startsWith('http://localhost:') || normalizedOrigin.startsWith('http://127.0.0.1:')) {
    return true;
  }

  return buildCorsOrigins().includes(normalizedOrigin);
}

export function assertValidDatabaseUrl(databaseUrl: string): void {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required and must be a valid PostgreSQL connection string');
  }

  if (!isPostgresDatabaseUrl(databaseUrl)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string (postgres:// or postgresql://)');
  }
}

type WhatsAppProvider = 'meta' | 'greenapi';

function resolveWhatsAppProvider(): WhatsAppProvider {
  const raw = (process.env.WHATSAPP_PROVIDER || 'meta').trim().toLowerCase();
  if (!raw) {
    return 'meta';
  }
  if (raw === 'meta' || raw === 'greenapi') {
    return raw;
  }
  throw new Error("WHATSAPP_PROVIDER must be one of: 'meta', 'greenapi'");
}

const nodeEnv = process.env.NODE_ENV || 'development';
const whatsappProvider = resolveWhatsAppProvider();

if (nodeEnv === 'production' && whatsappProvider !== 'meta') {
  throw new Error(`WHATSAPP_PROVIDER='${whatsappProvider}' is not allowed when NODE_ENV='production'`);
}

const databaseUrl = resolveDatabaseUrl();
const neonPoolerConfigured = isNeonPoolerDatabaseUrl(databaseUrl);

const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
const smtpSecure = process.env.SMTP_SECURE !== undefined
  ? process.env.SMTP_SECURE === 'true'
  : smtpPort === 465;

const config = {
  env: nodeEnv,
  port: parseInt(process.env.PORT || '3001', 10),

  neonAuth: {
    // Backend-facing Neon Auth URL. VITE_NEON_AUTH_URL is accepted as fallback
    // to keep local setup friction low while migration is in progress.
    url: normalizeNeonAuthUrl(process.env.NEON_AUTH_URL || process.env.VITE_NEON_AUTH_URL || ''),
  },

  frontend: {
    // Trusted base URL used for user-facing links generated by the backend.
    baseUrl: (process.env.FRONTEND_BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  },

  mail: {
    // Email "From" address for transactional emails (password reset, invites, etc.)
    from: (process.env.MAIL_FROM || '').trim(),
    smtp: {
      host: (process.env.SMTP_HOST || '').trim(),
      port: smtpPort,
      secure: smtpSecure,
      user: (process.env.SMTP_USER || '').trim(),
      pass: process.env.SMTP_PASS || '',
    },
  },

  db: {
    url: databaseUrl,
    poolMin: parseInt(process.env.DB_POOL_MIN || '10', 10),
    poolMax: parseInt(process.env.DB_POOL_MAX || '50', 10),
    neonPoolerConfigured,
    keepAliveEnabled: process.env.NEON_KEEPALIVE_ENABLED !== 'false',
    keepAliveIntervalMs: parseInt(process.env.NEON_KEEPALIVE_INTERVAL_MS || '240000', 10),
    autoMigrate: process.env.DB_AUTO_MIGRATE !== 'false',
    autoSeed: process.env.DB_AUTO_SEED !== 'false',
  },

  redis: {
    url: process.env.UPSTASH_REDIS_REST_URL || '',
    token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
  },

  jwt: {
    secret: resolveJwtSecret('JWT_SECRET', 'test-jwt-secret'),
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshSecret: resolveJwtSecret('JWT_REFRESH_SECRET', 'test-jwt-refresh-secret'),
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  whatsapp: {
    provider: whatsappProvider,
    apiUrl: process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v18.0',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    // Security settings
    ipWhitelistEnabled: process.env.WHATSAPP_IP_WHITELIST_ENABLED === 'true',
    skipIpWhitelist: process.env.SKIP_IP_WHITELIST === 'true',
    webhookMaxSize: process.env.WHATSAPP_WEBHOOK_MAX_SIZE || '1mb',
    dedupTtlSeconds: parseInt(process.env.WHATSAPP_DEDUP_TTL_SECONDS || '300', 10),
  },

  greenapi: {
    apiUrl: (process.env.GREENAPI_API_URL || 'https://api.green-api.com').replace(/\/+$/, ''),
    idInstance: process.env.GREENAPI_ID_INSTANCE || '',
    apiTokenInstance: process.env.GREENAPI_API_TOKEN_INSTANCE || '',
    webhookUrlToken: process.env.GREENAPI_WEBHOOK_URL_TOKEN || '',
  },

  ai: {
    provider: process.env.AI_PROVIDER || 'kimi',
    kimiApiBaseUrl: process.env.KIMI_API_BASE_URL || 'https://api.moonshot.ai/v1',
    kimiApiKey: process.env.KIMI_API_KEY || '',
    // Explicit Kimi 2.5 default model for the primary provider.
    kimi25Model: process.env.KIMI_2_5_MODEL || 'kimi-k2-2504',
    claudeApiKey: process.env.CLAUDE_API_KEY || '',
    claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
  },

  storage: {
    provider: process.env.STORAGE_PROVIDER || 'r2',
    // Optional: override the S3 endpoint completely (useful for MinIO / other S3-compatible providers).
    // When set, R2_ACCOUNT_ID is not required.
    r2Endpoint: firstNonEmptyEnv('R2_ENDPOINT', 'S3_ENDPOINT', 'AWS_ENDPOINT_URL', 'AWS_S3_ENDPOINT', 'B2_ENDPOINT')
      .replace(/\/+$/, ''),
    r2AccountId: firstNonEmptyEnv('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID'),
    r2AccessKeyId: firstNonEmptyEnv('R2_ACCESS_KEY_ID', 'S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID', 'B2_APPLICATION_KEY_ID'),
    r2SecretAccessKey: firstNonEmptyEnv(
      'R2_SECRET_ACCESS_KEY',
      'S3_SECRET_ACCESS_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'B2_APPLICATION_KEY',
    ),
    r2Bucket: firstNonEmptyEnv('R2_BUCKET', 'S3_BUCKET', 'AWS_S3_BUCKET', 'B2_BUCKET'),
    r2PublicBaseUrl: firstNonEmptyEnv('R2_PUBLIC_BASE_URL', 'S3_PUBLIC_BASE_URL', 'PUBLIC_ASSETS_BASE_URL'),
    r2Region: firstNonEmptyEnv('R2_REGION', 'S3_REGION', 'AWS_REGION', 'AWS_DEFAULT_REGION') || 'auto',
    // Default raised to support real-world brochures and price lists.
    propertyUploadMaxBytes: parseByteSize(process.env.PROPERTY_UPLOAD_MAX_BYTES, 50 * 1024 * 1024),
    allowedMimeTypes: (process.env.PROPERTY_ALLOWED_MIME_TYPES || 'image/jpeg,image/png,image/webp,application/pdf,video/mp4')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  },

  geocoding: {
    provider: process.env.GEOCODING_PROVIDER || 'nominatim', // 'google' | 'nominatim'
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    nominatimUserAgent: process.env.NOMINATIM_USER_AGENT || 'Investo-RealEstate/1.0',
    cacheEnabled: process.env.GEOCODING_CACHE_ENABLED !== 'false',
    cacheTtlSeconds: parseInt(process.env.GEOCODING_CACHE_TTL_SECONDS || '86400', 10), // 24 hours
  },

  cors: {
    origins: buildCorsOrigins(),
  },

  rateLimit: {
    perUser: parseInt(process.env.RATE_LIMIT_USER || '100', 10),
    perCompany: parseInt(process.env.RATE_LIMIT_COMPANY || '1000', 10),
  },
};

export default config;
