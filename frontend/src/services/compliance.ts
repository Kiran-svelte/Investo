import api from './api';

export type DsrRequestType = 'export' | 'delete' | 'access';
export type DsrStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface DsrRequest {
  id: string;
  requestType: DsrRequestType;
  subjectPhone?: string | null;
  subjectEmail?: string | null;
  status: DsrStatus;
  createdAt: string;
  updatedAt?: string;
}

export interface RetentionPolicy {
  messageDays?: number;
  leadInactiveDays?: number;
  auditDays?: number;
  enabled?: boolean;
}

export interface ComplianceFeatureStatus {
  dsr: boolean;
  retention: boolean;
  legal_hold: boolean;
  dpa: boolean;
}

export interface DpaStatus {
  latest: {
    version: string;
    acceptedAt: string;
    acceptedBy: string;
  } | null;
  current_version_accepted: boolean;
}

export async function getComplianceStatus(): Promise<ComplianceFeatureStatus> {
  const { data } = await api.get<ComplianceFeatureStatus>('/compliance/status');
  return data;
}

export async function listDsrRequests(): Promise<DsrRequest[]> {
  const { data } = await api.get<{ requests: DsrRequest[] }>('/compliance/dsr');
  return data.requests;
}

export async function createDsrRequest(payload: {
  request_type: DsrRequestType;
  subject_phone?: string;
  subject_email?: string;
}): Promise<DsrRequest> {
  const { data } = await api.post<{ request: DsrRequest }>('/compliance/dsr', payload);
  return data.request;
}

export async function processDsrRequest(id: string): Promise<{ status: string; artifact_path?: string }> {
  const { data } = await api.post<{ status: string; artifact_path?: string }>(`/compliance/dsr/${id}/process`);
  return data;
}

export async function getRetentionPolicy(): Promise<RetentionPolicy | null> {
  const { data } = await api.get<{ policy: RetentionPolicy | null }>('/compliance/retention');
  return data.policy;
}

export async function updateRetentionPolicy(policy: RetentionPolicy): Promise<RetentionPolicy> {
  const { data } = await api.put<{ policy: RetentionPolicy }>('/compliance/retention', policy);
  return data.policy;
}

export async function getDpaStatus(): Promise<DpaStatus> {
  const { data } = await api.get<DpaStatus>('/compliance/dpa/status');
  return data;
}

export async function acceptDpa(version?: string): Promise<{ acceptance: { version: string; acceptedAt: string } }> {
  const { data } = await api.post<{ acceptance: { version: string; acceptedAt: string } }>(
    '/compliance/dpa/accept',
    version ? { version } : {},
  );
  return data;
}
