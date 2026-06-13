import crypto from 'crypto';
import config from '../config';

const UPLOAD_TTL_MS = 15 * 60 * 1000;

function signingSecret(): string {
  return config.jwt.secret || config.jwt.refreshSecret || 'investo-upload-fallback';
}

export function buildPropertyImportUploadExpiry(createdAt: Date = new Date()): number {
  return createdAt.getTime() + UPLOAD_TTL_MS;
}

export function signPropertyImportUploadToken(
  uploadToken: string,
  companyId: string,
  expiresAtMs: number,
): string {
  const payload = `${uploadToken}:${companyId}:${expiresAtMs}`;
  return crypto.createHmac('sha256', signingSecret()).update(payload).digest('hex');
}

export function verifyPropertyImportUploadToken(
  uploadToken: string,
  companyId: string,
  expiresAtMs: number,
  signature: string,
): boolean {
  if (!signature || !Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
    return false;
  }
  const expected = signPropertyImportUploadToken(uploadToken, companyId, expiresAtMs);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function appendSignedUploadQuery(uploadUrl: string, companyId: string, expiresAtMs: number): string {
  const url = new URL(uploadUrl);
  const uploadToken = url.pathname.split('/').pop() || '';
  url.searchParams.set('exp', String(expiresAtMs));
  url.searchParams.set('sig', signPropertyImportUploadToken(uploadToken, companyId, expiresAtMs));
  return url.toString();
}

export function parseSignedUploadQuery(query: Record<string, unknown>): {
  expiresAtMs: number;
  signature: string;
} {
  const expiresAtMs = Number(query.exp);
  const signature = typeof query.sig === 'string' ? query.sig.trim() : '';
  return { expiresAtMs, signature };
}
