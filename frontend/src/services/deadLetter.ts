import api from './api';

export interface WhatsAppDeadLetter {
  id: string;
  jobId: string;
  companyId: string;
  payload: unknown;
  error: string;
  createdAt: string;
}

export async function listWhatsAppDeadLetters(): Promise<WhatsAppDeadLetter[]> {
  const { data } = await api.get<{ data: WhatsAppDeadLetter[] }>('/dead-letter/whatsapp');
  return data.data || [];
}

export async function replayWhatsAppDeadLetter(id: string): Promise<{ jobId: string; idempotencyKey: string }> {
  const { data } = await api.post<{ data: { jobId: string; idempotencyKey: string } }>(`/dead-letter/whatsapp/${id}/replay`);
  return data.data;
}
