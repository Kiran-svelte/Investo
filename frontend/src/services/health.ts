import api, { ApiResponse } from './api';

export interface SystemHealthDependencies {
  db?: { status: string; latency_ms?: number };
  storage?: Record<string, unknown>;
  property_knowledge_embeddings?: {
    status: 'ok' | 'degraded' | 'error';
    provider: 'openai' | 'local_hash';
    detail?: string;
  };
}

export interface SystemHealth {
  status: string;
  dependencies?: SystemHealthDependencies;
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const { data } = await api.get<ApiResponse<SystemHealth>>('/health');
  return data.data;
}

export function isOpenAiEmbeddingsReady(health: SystemHealth | null): boolean {
  const emb = health?.dependencies?.property_knowledge_embeddings;
  return emb?.status === 'ok' && emb?.provider === 'openai';
}

export function embeddingHealthMessage(health: SystemHealth | null): string {
  const emb = health?.dependencies?.property_knowledge_embeddings;
  if (!emb) {
    return 'Checking AI indexing…';
  }
  if (emb.status === 'ok' && emb.provider === 'openai') {
    return emb.detail || 'OpenAI embeddings are ready. Publish will index WhatsApp AI knowledge.';
  }
  if (emb.status === 'ok' && emb.provider === 'local_hash') {
    return emb.detail || 'Using backup embeddings. Add a valid OPENAI_API_KEY on the server for best WhatsApp answers.';
  }
  return emb.detail || 'OpenAI API key is not configured correctly on the server.';
}
