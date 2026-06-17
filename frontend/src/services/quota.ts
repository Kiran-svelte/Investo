import api from './api';

export type QuotaDimension =
  | 'whatsapp_outbound_min'
  | 'ai_call_hour'
  | 'ai_tokens_day'
  | 'import_concurrent'
  | 'bulk_send_daily'
  | 'api_requests_min';

export interface QuotaUsageEntry {
  used: number;
  remaining: number;
  limit: number;
}

export interface TenantQuotaUsageResponse {
  tier: 'starter' | 'pro' | 'enterprise';
  limits: Record<QuotaDimension, number>;
  usage: Record<QuotaDimension, QuotaUsageEntry>;
  labels: Record<QuotaDimension, string>;
  enforcement: {
    enabled: boolean;
    hard: boolean;
  };
}

export async function getTenantQuotaUsage(): Promise<TenantQuotaUsageResponse> {
  const { data } = await api.get<TenantQuotaUsageResponse>('/quota/usage');
  return data;
}
