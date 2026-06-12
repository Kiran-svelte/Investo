import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

if (
  (process.env.NODE_ENV || 'development') !== 'production' &&
  fs.existsSync(envPath) &&
  !process.env.JEST_WORKER_ID
) {
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  // Only override critical Neon-related keys to avoid stale shell env bugs,
  // while preserving explicit runtime overrides for things like PORT.
  const keysToPin = ['DATABASE_URL', 'DIRECT_URL', 'NEON_AUTH_URL', 'SUPABASE_URL'] as const;
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

export function isSupabaseDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsedUrl = new URL(databaseUrl);
    const host = parsedUrl.hostname.toLowerCase();
    return host.includes('supabase.com') || host.includes('supabase.co');
  } catch {
    return false;
  }
}

export function isSupabasePoolerDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsedUrl = new URL(databaseUrl);
    const host = parsedUrl.hostname.toLowerCase();
    return host.includes('pooler.supabase.com') || parsedUrl.port === '6543';
  } catch {
    return false;
  }
}

export function resolveDirectUrl(databaseUrl: string): string {
  const directUrl = process.env.DIRECT_URL;
  if (directUrl && isPostgresDatabaseUrl(directUrl)) {
    try {
      const parsed = new URL(directUrl);
      if (parsed.searchParams.get('channel_binding')) {
        parsed.searchParams.delete('channel_binding');
      }
      return parsed.toString();
    } catch {
      return directUrl;
    }
  }
  return databaseUrl;
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
    'https://biginvesto.online',
    'https://www.biginvesto.online',
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

type WhatsAppProvider = 'meta';

function resolveWhatsAppProvider(): WhatsAppProvider {
  const raw = (process.env.WHATSAPP_PROVIDER || 'meta').trim().toLowerCase();
  if (!raw) {
    return 'meta';
  }
  if (raw === 'meta') {
    return 'meta';
  }
  throw new Error("WHATSAPP_PROVIDER must be 'meta'");
}

const nodeEnv = process.env.NODE_ENV || 'development';
const whatsappProvider = resolveWhatsAppProvider();

const databaseUrl = resolveDatabaseUrl();
const directUrl = resolveDirectUrl(databaseUrl);
const neonPoolerConfigured = isNeonPoolerDatabaseUrl(databaseUrl);
const supabasePoolerConfigured = isSupabasePoolerDatabaseUrl(databaseUrl);
const databaseSslRequired = isSupabaseDatabaseUrl(databaseUrl) || databaseUrl.includes('sslmode=require');

const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
const smtpSecure = process.env.SMTP_SECURE !== undefined
  ? process.env.SMTP_SECURE === 'true'
  : smtpPort === 465;

const mailFrom = (process.env.MAIL_FROM || '').trim();
const awsAccessKeyId = firstNonEmptyEnv('AWS_ACCESS_KEY_ID');
const awsSecretAccessKey = firstNonEmptyEnv('AWS_SECRET_ACCESS_KEY');

/**
 * Railway and many cloud hosts block outbound SMTP (port 587).
 * In production, prefer SES API (HTTPS) when IAM credentials and MAIL_FROM are available.
 */
function resolveMailTransport(): 'smtp' | 'ses-api' {
  const explicit = (process.env.MAIL_TRANSPORT || '').trim().toLowerCase();
  if (explicit === 'ses-api' || explicit === 'smtp') {
    return explicit;
  }

  if (
    nodeEnv === 'production'
    && awsAccessKeyId
    && awsSecretAccessKey
    && mailFrom
  ) {
    return 'ses-api';
  }

  return 'smtp';
}

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

  selfService: {
    signupEnabled: process.env.SELF_SERVICE_SIGNUP_ENABLED === 'true',
  },

  mail: {
    // "smtp" or "ses-api" (AWS SES SendEmail — uses IAM keys; required on Railway)
    transport: resolveMailTransport(),
    // Email "From" address for transactional emails (password reset, invites, etc.)
    from: mailFrom,
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
    directUrl,
    ssl: databaseSslRequired,
    poolMin: parseInt(process.env.DB_POOL_MIN || '10', 10),
    poolMax: parseInt(process.env.DB_POOL_MAX || '50', 10),
    neonPoolerConfigured,
    supabasePoolerConfigured,
    keepAliveEnabled:
      process.env.NEON_KEEPALIVE_ENABLED === 'false'
        ? false
        : process.env.NEON_KEEPALIVE_ENABLED === 'true' || neonPoolerConfigured,
    keepAliveIntervalMs: parseInt(process.env.NEON_KEEPALIVE_INTERVAL_MS || '240000', 10),
    autoMigrate: process.env.DB_AUTO_MIGRATE !== 'false',
    autoSeed: process.env.DB_AUTO_SEED !== 'false',
  },

  supabase: {
    url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    projectRef: (process.env.SUPABASE_PROJECT_REF || '').trim(),
  },

  redis: {
    url: (process.env.UPSTASH_REDIS_REST_URL || '').trim(),
    token: (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim(),
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
    /** When false, skips typing indicator and artificial reply delay entirely. */
    replyPacingEnabled: process.env.WHATSAPP_REPLY_PACING_ENABLED !== 'false',
    /** Buyer H9 LLM wall timeout (ms). Default 12s fast / 28s when fast replies off. */
    buyerLlmTimeoutMs: (() => {
      const raw = process.env.WHATSAPP_BUYER_LLM_TIMEOUT_MS;
      if (raw === undefined || raw.trim() === '') {
        return process.env.FEATURE_FAST_WHATSAPP_REPLIES === 'false' ? 28_000 : 12_000;
      }
      const parsed = parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 12_000;
    })(),
    /** Shared secret for signed production handset E2E proofs (X-Investo-E2E-Token header). */
    e2eWebhookProofToken: process.env.E2E_WEBHOOK_PROOF_TOKEN || '',
  },

  ai: {
    provider: process.env.AI_PROVIDER || 'openai',
    kimiApiBaseUrl: process.env.KIMI_API_BASE_URL || 'https://api.moonshot.ai/v1',
    kimiApiKey: process.env.KIMI_API_KEY || '',
    // Explicit Kimi 2.5 default model for the primary provider.
    kimi25Model: process.env.KIMI_2_5_MODEL || 'kimi-k2-2504',
    claudeApiKey: process.env.CLAUDE_API_KEY || '',
    claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    openaiApiKey: (process.env.OPENAI_API_KEY || '').trim(),
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  },

  agentAi: {
    /**
     * Backward-compatible copilot switch.
     * AGENT_AI_ENABLED=false now disables only LLM features unless
     * AGENT_AI_COPILOT_ENABLED=false is also set.
     */
    enabled: process.env.AGENT_AI_COPILOT_ENABLED !== 'false',
    /**
     * LLM-specific switch — disables AI model calls only.
     * When false, deterministic CRM + regex workflow paths still run.
     * Env: AGENT_AI_LLM_ENABLED (default: follows legacy AGENT_AI_ENABLED)
     * Ops note: set AGENT_AI_LLM_ENABLED=false for zero-UI hardening without
     * breaking "visits today" and other deterministic staff commands.
     */
    llmEnabled:
      process.env.AGENT_AI_LLM_ENABLED !== undefined
        ? process.env.AGENT_AI_LLM_ENABLED !== 'false'
        : process.env.AGENT_AI_ENABLED !== 'false',
    /**
     * Copilot-specific switch — disables the WhatsApp copilot entirely.
     * When false, staff get a static "use the dashboard" notice.
     * Env: AGENT_AI_COPILOT_ENABLED (default: true)
     */
    copilotEnabled: process.env.AGENT_AI_COPILOT_ENABLED !== 'false',
    provider: (process.env.AGENT_AI_PROVIDER || 'openai').toLowerCase(),
    model: process.env.AGENT_AI_MODEL || 'gpt-4o',
    maxToolCalls: parseInt(process.env.AGENT_AI_MAX_TOOL_CALLS || '10', 10),
    threadTtlHours: parseInt(process.env.AGENT_AI_THREAD_TTL_HOURS || '24', 10),
    confirmationTtlMinutes: parseInt(process.env.AGENT_AI_CONFIRMATION_TTL_MINUTES || '5', 10),
    messageWindowSize: parseInt(process.env.AGENT_AI_MESSAGE_WINDOW || '10', 10),
    cronEnabled: process.env.AGENT_AI_CRON_ENABLED !== 'false',
    temperature: parseFloat(process.env.AGENT_AI_TEMPERATURE || '0'),
    copilotTimeoutMs: (() => {
      const raw = process.env.AGENT_AI_COPILOT_TIMEOUT_MS;
      if (raw === undefined || raw.trim() === '') {
        return process.env.FEATURE_FAST_WHATSAPP_REPLIES === 'false' ? 30_000 : 18_000;
      }
      const parsed = parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 18_000;
    })(),
  },

  storage: {
    provider: process.env.STORAGE_PROVIDER || 'aws',
    /** AWS S3 (primary) — eu-north-1 bucket with investo/ prefix */
    awsRegion: firstNonEmptyEnv('AWS_REGION') || 'eu-north-1',
    awsBucket: firstNonEmptyEnv('AWS_S3_BUCKET') || 'biginvesto-668764275363-eu-north-1-an',
    awsKeyPrefix: (() => {
      const raw = firstNonEmptyEnv('AWS_S3_PREFIX') || 'investo';
      const trimmed = raw.replace(/^\/+|\/+$/g, '');
      return trimmed ? `${trimmed}/` : '';
    })(),
    awsAccessKeyId: firstNonEmptyEnv('AWS_ACCESS_KEY_ID'),
    awsSecretAccessKey: firstNonEmptyEnv('AWS_SECRET_ACCESS_KEY'),
    awsPublicBaseUrl: firstNonEmptyEnv('AWS_S3_PUBLIC_BASE_URL'),
    /** Cloudflare R2 (secondary fallback) — use R2_* only, not AWS_* */
    r2Endpoint: firstNonEmptyEnv('R2_ENDPOINT').replace(/\/+$/, ''),
    r2AccountId: firstNonEmptyEnv('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID'),
    r2AccessKeyId: firstNonEmptyEnv('R2_ACCESS_KEY_ID'),
    r2SecretAccessKey: firstNonEmptyEnv('R2_SECRET_ACCESS_KEY'),
    r2Bucket: firstNonEmptyEnv('R2_BUCKET'),
    r2PublicBaseUrl: firstNonEmptyEnv('R2_PUBLIC_BASE_URL'),
    r2Region: firstNonEmptyEnv('R2_REGION') || 'auto',
    // Default raised to support real-world brochures and price lists.
    propertyUploadMaxBytes: parseByteSize(process.env.PROPERTY_UPLOAD_MAX_BYTES, 50 * 1024 * 1024),
    allowedMimeTypes: (process.env.PROPERTY_ALLOWED_MIME_TYPES || 'image/jpeg,image/png,image/webp,application/pdf,video/mp4,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    /** R2 presigned PUT is primary. DB blob upload is emergency fallback only (PROPERTY_IMPORT_DB_UPLOAD=true forces DB). */
    propertyImportUseDbUpload: process.env.PROPERTY_IMPORT_DB_UPLOAD === 'true',
    /** Public API base for browser PUT fallback (defaults to Render backend). */
    publicApiBaseUrl: (process.env.API_PUBLIC_BASE_URL || process.env.BACKEND_PUBLIC_URL || '').replace(/\/+$/, ''),
    supabasePropertyBucket: process.env.SUPABASE_PROPERTY_BUCKET || 'property-media',
    supabaseAiKnowledgeBucket: process.env.SUPABASE_AI_KNOWLEDGE_BUCKET || 'ai-knowledge',
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
    perUserAi: parseInt(process.env.RATE_LIMIT_USER_AI || '40', 10),
    perCompanyAi: parseInt(process.env.RATE_LIMIT_COMPANY_AI || '120', 10),
    webhookPerMinute: parseInt(process.env.RATE_LIMIT_WEBHOOK || '300', 10),
    whatsappAiPerMinute: parseInt(process.env.RATE_LIMIT_WHATSAPP_AI || '60', 10),
    sensitivePerMinute: parseInt(process.env.RATE_LIMIT_SENSITIVE || '10', 10),
  },
  langgraph: {
    enabled: process.env.LANGGRAPH_ENABLED === 'true',
    url: (process.env.LANGGRAPH_URL || 'http://localhost:8000').replace(/\/+$/, ''),
    mode: (process.env.LANGGRAPH_MODE || 'augment') as 'augment' | 'replace',
    timeoutMs: parseInt(process.env.LANGGRAPH_TIMEOUT_MS || '5000', 10),
  },
  enterpriseAgent: {
    enabled: process.env.ENTERPRISE_AGENT_ENABLED === 'true',
    mode: (process.env.ENTERPRISE_AGENT_MODE || 'augment') as 'augment' | 'replace',
  },

  features: {
    /**
     * Buyer WhatsApp UX (buttons, post-visit, returning buyer, property browse media).
     * ON by default — set FEATURE_*=false to disable without redeploying code.
     */
    advancedLeadUx: process.env.FEATURE_ADVANCED_LEAD_UX !== 'false',
    /** Staff copilot only — stays opt-in. */
    contextualCopilotButtons: process.env.FEATURE_CONTEXTUAL_COPILOT_BUTTONS === 'true',
    customGreetingTemplate: process.env.FEATURE_CUSTOM_GREETING_TEMPLATE !== 'false',
    /** 0–100 rollout bucket; default 100 so all leads get buyer UX unless tuned down. */
    rolloutPercentage: (() => {
      const raw = process.env.FEATURE_ROLLOUT_PERCENTAGE;
      if (raw === undefined || raw.trim() === '') return 100;
      const parsed = parseInt(raw, 10);
      if (!Number.isFinite(parsed)) return 100;
      return Math.min(100, Math.max(0, parsed));
    })(),
    /** When true, compare old vs new paths and log mismatches even when serving old behavior. */
    shadowMode: process.env.FEATURE_SHADOW_MODE === 'true',
    reliableCustomerNotifications: process.env.FEATURE_RELIABLE_CUSTOMER_NOTIFICATIONS !== 'false',
    /** fix.md PR-3: visited/negotiation leads skip rapport re-interrogation (no rollout bucket). */
    fixMdReturningBuyerStage: process.env.FEATURE_FIX_MD_RETURNING_BUYER_STAGE !== 'false',
    /** fix.md PR-3: ensure greetingTemplate is loaded on all buyer fast paths. */
    fixMdCustomGreetingSelect: process.env.FEATURE_FIX_MD_CUSTOM_GREETING_SELECT !== 'false',
    /** fix.md PR-4: structured log when staff phone matches buyer lead. */
    fixMdStaffBuyerCollisionLog: process.env.FEATURE_FIX_MD_STAFF_BUYER_COLLISION_LOG !== 'false',
    /** fix.md PR-4: block write intents for viewer before execution. */
    fixMdCopilotRoleFilter: process.env.FEATURE_FIX_MD_COPILOT_ROLE_FILTER !== 'false',
    /** fix.md PR-4: bulk_send_to_phones message extraction (prompt already updated). */
    fixMdBulkSendExtract: process.env.FEATURE_FIX_MD_BULK_SEND_EXTRACT !== 'false',
    /** fix.md PR-5: require hero image or brochure before publish/media sends. */
    fixMdPropertyMediaCompleteness: process.env.FEATURE_FIX_MD_PROPERTY_MEDIA_COMPLETENESS !== 'false',
    /** Staff attendance Reschedule button → ask customer → auto-reschedule (F-01). */
    attendanceStaffRescheduleFlow: process.env.FEATURE_ATTENDANCE_STAFF_RESCHEDULE !== 'false',
    /** Skip artificial WhatsApp delays; parallel prefetch; shorter LLM caps (default ON). */
    fastWhatsAppReplies: process.env.FEATURE_FAST_WHATSAPP_REPLIES !== 'false',
  },
};

export default config;
