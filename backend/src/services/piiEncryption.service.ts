import crypto from 'crypto';

import config from '../config';

const ALGORITHM = 'aes-256-gcm';

function resolveKey(version = 1): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY || process.env.MFA_ENCRYPTION_KEY || config.jwt.secret;
  return crypto.createHash('sha256').update(`${raw}:v${version}`).digest();
}

export function blindIndex(value: string): string {
  const normalized = value.trim().toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

export function encryptField(plain: string, keyVersion = 1): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, resolveKey(keyVersion), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${keyVersion}:${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptField(payload: string): string {
  const [versionPart, rest] = payload.includes(':') ? payload.split(':', 2) : ['v1', payload];
  const keyVersion = Number.parseInt(versionPart.replace(/^v/, ''), 10) || 1;
  const [ivB64, tagB64, dataB64] = (rest || payload).split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted field payload');
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    resolveKey(keyVersion),
    Buffer.from(ivB64, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function isPiiEncryptionEnabled(): boolean {
  return config.features.piiEncryption === true;
}

export async function upsertEncryptedField(params: {
  companyId: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  plain: string;
}): Promise<void> {
  if (!isPiiEncryptionEnabled()) return;

  const prisma = (await import('../config/prisma')).default as any;
  const ciphertext = encryptField(params.plain);
  await prisma.encryptedField.upsert({
    where: {
      entityType_entityId_fieldName: {
        entityType: params.entityType,
        entityId: params.entityId,
        fieldName: params.fieldName,
      },
    },
    create: {
      companyId: params.companyId,
      entityType: params.entityType,
      entityId: params.entityId,
      fieldName: params.fieldName,
      ciphertext,
    },
    update: { ciphertext },
  });
}

export async function readEncryptedField(params: {
  companyId: string;
  entityType: string;
  entityId: string;
  fieldName: string;
}): Promise<string | null> {
  if (!isPiiEncryptionEnabled()) return null;

  const prisma = (await import('../config/prisma')).default as any;
  const row = await prisma.encryptedField.findFirst({
    where: {
      companyId: params.companyId,
      entityType: params.entityType,
      entityId: params.entityId,
      fieldName: params.fieldName,
    },
  });
  if (!row?.ciphertext) return null;
  return decryptField(row.ciphertext);
}
