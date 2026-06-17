import api from './api';

export interface TenantHealthSignals {
  quota_warnings: number;
  open_dsr: number;
  pending_ai_reviews: number;
  failed_webhooks: number;
}

export interface TenantHealthScore {
  id: string;
  companyId: string;
  score: number;
  signals: TenantHealthSignals;
  computedAt: string;
}

export interface TenantHealthResponse {
  health: TenantHealthScore | null;
  enabled: boolean;
}

export interface AdminCompanyRow {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export interface ImpersonationSession {
  id: string;
  companyId: string;
  targetUserId: string;
  ticketId: string;
  expiresAt: string;
}

export async function listAdminCompanies(): Promise<AdminCompanyRow[]> {
  const { data } = await api.get<{ data: AdminCompanyRow[] }>('/admin/companies');
  return data.data;
}

export async function getTenantHealth(companyId: string): Promise<TenantHealthResponse> {
  const { data } = await api.get<TenantHealthResponse>(`/support-ops/health/${companyId}`);
  return data;
}

export async function computeTenantHealth(companyId: string): Promise<TenantHealthScore> {
  const { data } = await api.post<{ health: TenantHealthScore }>(`/support-ops/health/${companyId}/compute`);
  return data.health;
}

export async function startImpersonation(payload: {
  company_id: string;
  target_user_id: string;
  ticket_id: string;
  ttl_minutes?: number;
}): Promise<ImpersonationSession> {
  const { data } = await api.post<{ session: ImpersonationSession }>('/support-ops/impersonate', payload);
  return data.session;
}

export async function revokeImpersonation(sessionId: string, companyId: string): Promise<boolean> {
  const { data } = await api.post<{ revoked: boolean }>(`/support-ops/impersonate/${sessionId}/revoke`, {
    company_id: companyId,
  });
  return data.revoked;
}
