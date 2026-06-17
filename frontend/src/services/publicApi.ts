import api from './api';

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}

export interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const { data } = await api.get<{ keys: ApiKeyRow[] }>('/v1/keys');
  return data.keys;
}

export async function createApiKey(payload: {
  name: string;
  scopes: string[];
}): Promise<{ key: ApiKeyRow; raw_key: string; warning?: string }> {
  const { data } = await api.post<{ key: ApiKeyRow; raw_key: string; warning?: string }>('/v1/keys', payload);
  return data;
}

export async function revokeApiKey(id: string): Promise<boolean> {
  const { data } = await api.delete<{ revoked: boolean }>(`/v1/keys/${id}`);
  return data.revoked;
}

export async function listWebhooks(): Promise<WebhookSubscription[]> {
  const { data } = await api.get<{ subscriptions: WebhookSubscription[] }>('/v1/webhooks');
  return data.subscriptions;
}

export async function createWebhook(payload: {
  url: string;
  events: string[];
}): Promise<{ subscription: WebhookSubscription; secret: string }> {
  const { data } = await api.post<{ subscription: WebhookSubscription; secret: string }>('/v1/webhooks', payload);
  return data;
}

export async function testWebhook(secret?: string): Promise<{ dispatched: boolean }> {
  const { data } = await api.post<{ dispatched: boolean }>('/v1/webhooks/test', secret ? { secret } : {});
  return data;
}

export async function getPublicApiHealth(): Promise<{ status: string; version: string; public_api_enabled: boolean }> {
  const { data } = await api.get<{ status: string; version: string; public_api_enabled: boolean }>('/v1/health');
  return data;
}
