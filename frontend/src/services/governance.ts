import api from './api';

export type AiReviewStatus = 'pending' | 'approved' | 'rejected';

export interface PromptVersion {
  id: string;
  name: string;
  version: string;
  status: string;
  active?: boolean;
  createdAt?: string;
}

export interface AiReviewQueueItem {
  id: string;
  messageId?: string;
  riskScore: number;
  reason?: string;
  status: AiReviewStatus;
  createdAt: string;
}

export interface AiReviewQueueResponse {
  items: AiReviewQueueItem[];
  enabled: boolean;
  threshold: number;
}

export interface PromptVersionsResponse {
  versions: PromptVersion[];
  enabled: boolean;
}

export async function listPromptVersions(name?: string): Promise<PromptVersionsResponse> {
  const { data } = await api.get<PromptVersionsResponse>('/governance/prompts', {
    params: name ? { name } : undefined,
  });
  return data;
}

export async function listAiReviewQueue(): Promise<AiReviewQueueResponse> {
  const { data } = await api.get<AiReviewQueueResponse>('/governance/ai-review-queue');
  return data;
}

export async function reviewAiQueueItem(
  id: string,
  status: 'approved' | 'rejected',
): Promise<{ updated: number }> {
  const { data } = await api.post<{ updated: number }>(`/governance/ai-review-queue/${id}/review`, { status });
  return data;
}
