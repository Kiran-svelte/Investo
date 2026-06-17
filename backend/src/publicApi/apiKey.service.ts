import crypto from 'crypto';
import bcrypt from 'bcrypt';

import config from '../config';
import prisma from '../config/prisma';

function prismaClient(): any {
  return prisma as any;
}

const KEY_PREFIX = 'inv_live_';

export class ApiKeyService {
  isEnabled(): boolean {
    return config.features.publicApi === true;
  }

  generateRawKey(): string {
    return `${KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
  }

  extractPrefix(rawKey: string): string {
    return rawKey.slice(0, 12);
  }

  async createKey(input: {
    companyId: string;
    name: string;
    scopes: string[];
    createdBy: string;
    expiresAt?: Date;
  }) {
    if (!this.isEnabled()) {
      throw new Error('Public API feature is disabled');
    }

    const rawKey = this.generateRawKey();
    const keyHash = await bcrypt.hash(rawKey, 10);

    const row = await prismaClient().apiKey.create({
      data: {
        companyId: input.companyId,
        name: input.name,
        keyPrefix: this.extractPrefix(rawKey),
        keyHash,
        scopes: input.scopes,
        createdBy: input.createdBy,
        expiresAt: input.expiresAt,
      },
    });

    return { apiKey: row, rawKey };
  }

  async validateKey(rawKey: string): Promise<{ companyId: string; scopes: string[]; keyId: string } | null> {
    if (!this.isEnabled()) return null;
    if (!rawKey.startsWith(KEY_PREFIX)) return null;

    const prefix = this.extractPrefix(rawKey);
    const candidates = await prismaClient().apiKey.findMany({
      where: {
        keyPrefix: prefix,
        revokedAt: null,
      },
    });

    for (const candidate of candidates) {
      if (candidate.expiresAt && candidate.expiresAt < new Date()) continue;
      const match = await bcrypt.compare(rawKey, candidate.keyHash);
      if (match) {
        await prismaClient().apiKey.update({
          where: { id: candidate.id },
          data: { lastUsedAt: new Date() },
        });
        return {
          companyId: candidate.companyId,
          scopes: (candidate.scopes as string[]) || [],
          keyId: candidate.id,
        };
      }
    }

    return null;
  }

  async revokeKey(companyId: string, keyId: string) {
    return prismaClient().apiKey.updateMany({
      where: { id: keyId, companyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async listKeys(companyId: string) {
    return prismaClient().apiKey.findMany({
      where: { companyId, revokedAt: null },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const apiKeyService = new ApiKeyService();
