export type QuotaTier = 'starter' | 'pro' | 'enterprise';

export type QuotaDimension =
  | 'whatsapp_outbound_min'
  | 'ai_call_hour'
  | 'ai_tokens_day'
  | 'import_concurrent'
  | 'bulk_send_daily'
  | 'api_requests_min';

export interface QuotaLimits {
  whatsapp_outbound_min: number;
  ai_call_hour: number;
  ai_tokens_day: number;
  import_concurrent: number;
  bulk_send_daily: number;
  api_requests_min: number;
}

export const QUOTA_TIER_DEFAULTS: Record<QuotaTier, QuotaLimits> = {
  starter: {
    whatsapp_outbound_min: 20,
    ai_call_hour: 100,
    ai_tokens_day: 500_000,
    import_concurrent: 1,
    bulk_send_daily: 50,
    api_requests_min: 100,
  },
  pro: {
    whatsapp_outbound_min: 80,
    ai_call_hour: 500,
    ai_tokens_day: 2_000_000,
    import_concurrent: 3,
    bulk_send_daily: 500,
    api_requests_min: 300,
  },
  enterprise: {
    whatsapp_outbound_min: 200,
    ai_call_hour: 2000,
    ai_tokens_day: 10_000_000,
    import_concurrent: 10,
    bulk_send_daily: 5000,
    api_requests_min: 1000,
  },
};

export const QUOTA_WINDOW_SECONDS: Record<QuotaDimension, number> = {
  whatsapp_outbound_min: 60,
  ai_call_hour: 3600,
  ai_tokens_day: 86400,
  import_concurrent: 0,
  bulk_send_daily: 86400,
  api_requests_min: 60,
};

export const QUOTA_DIMENSION_LABELS: Record<QuotaDimension, string> = {
  whatsapp_outbound_min: 'WhatsApp outbound (per minute)',
  ai_call_hour: 'AI calls (per hour)',
  ai_tokens_day: 'AI tokens (per day)',
  import_concurrent: 'Concurrent property imports',
  bulk_send_daily: 'Bulk send recipients (per day)',
  api_requests_min: 'API requests (per minute)',
};

export function resolveQuotaTierFromSettings(settings: unknown): QuotaTier {
  const tier = (settings as { quota_tier?: string } | null)?.quota_tier;
  if (tier === 'pro' || tier === 'enterprise' || tier === 'starter') {
    return tier;
  }
  return 'starter';
}

export function mergeQuotaLimits(
  base: QuotaLimits,
  override: Partial<QuotaLimits> | null | undefined,
): QuotaLimits {
  if (!override) return base;
  return {
    whatsapp_outbound_min: override.whatsapp_outbound_min ?? base.whatsapp_outbound_min,
    ai_call_hour: override.ai_call_hour ?? base.ai_call_hour,
    ai_tokens_day: override.ai_tokens_day ?? base.ai_tokens_day,
    import_concurrent: override.import_concurrent ?? base.import_concurrent,
    bulk_send_daily: override.bulk_send_daily ?? base.bulk_send_daily,
    api_requests_min: override.api_requests_min ?? base.api_requests_min,
  };
}
