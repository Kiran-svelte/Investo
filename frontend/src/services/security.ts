import api from './api';

export interface SecurityScanCheck {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface SecurityScanReport {
  generated_at: string;
  checks: SecurityScanCheck[];
}

export interface SecretRotationRow {
  secret_name: string;
  rotated_at: string;
  rotated_by: string;
}

export async function getSecurityScanReport(): Promise<SecurityScanReport> {
  const { data } = await api.get<{ data: SecurityScanReport }>('/security/scan');
  return data.data;
}

export async function getSecretRotations(): Promise<SecretRotationRow[]> {
  const { data } = await api.get<{ data: SecretRotationRow[] }>('/security/secrets/rotations');
  return data.data;
}

export async function recordSecretRotation(secretName: string): Promise<void> {
  await api.post(`/security/secrets/${encodeURIComponent(secretName)}/rotate`);
}
