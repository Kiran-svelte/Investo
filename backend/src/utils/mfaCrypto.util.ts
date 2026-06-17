import crypto from 'crypto';

import config from '../config';

const ALGORITHM = 'aes-256-gcm';

function resolveKey(): Buffer {
  const raw = process.env.MFA_ENCRYPTION_KEY || config.jwt.secret;
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptMfaSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, resolveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptMfaSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted MFA secret payload');
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    resolveKey(),
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
