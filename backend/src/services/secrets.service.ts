import logger from '../config/logger';
import config from '../config';

const VAULT_ENV_PREFIX = 'VAULT_SECRET_';
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCachedSecret(name: string): string | undefined {
  const hit = cache.get(name);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value;
  }
  return undefined;
}

function setCachedSecret(name: string, value: string): void {
  cache.set(name, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export interface SecretResolution {
  name: string;
  source: 'vault' | 'env' | 'cache';
  present: boolean;
}

export class SecretsService {
  isVaultEnabled(): boolean {
    return config.features.secretsVault === true;
  }

  getSecret(name: string): string | undefined {
    const cached = getCachedSecret(name);
    if (cached) return cached;

    if (this.isVaultEnabled()) {
      const vaultValue = process.env[`${VAULT_ENV_PREFIX}${name.toUpperCase()}`];
      if (vaultValue) {
        setCachedSecret(name, vaultValue);
        logger.debug('Secret loaded from vault shim', { name });
        return vaultValue;
      }
      logger.warn('Vault enabled but secret missing; falling back to env', { name });
    }

    const envValue = process.env[name];
    if (envValue) {
      setCachedSecret(name, envValue);
      return envValue;
    }

    return undefined;
  }

  resolveRequiredSecret(name: string, fallback?: string): string {
    const value = this.getSecret(name) ?? fallback;
    if (!value) {
      throw new Error(`Required secret missing: ${name}`);
    }
    return value;
  }

  async recordRotation(secretName: string, rotatedBy: string): Promise<void> {
    const prisma = (await import('../config/prisma')).default as any;
    await prisma.secretRotationLog.create({
      data: {
        secretName,
        rotatedBy,
      },
    });
    logger.info('Secret rotation recorded', { secretName, rotatedBy });
  }

  async listRecentRotations(limit = 20): Promise<Array<{ secret_name: string; rotated_at: string; rotated_by: string }>> {
    const prisma = (await import('../config/prisma')).default as any;
    const rows = await prisma.secretRotationLog.findMany({
      orderBy: { rotatedAt: 'desc' },
      take: limit,
    });
    return rows.map((row: any) => ({
      secret_name: row.secretName,
      rotated_at: row.rotatedAt.toISOString(),
      rotated_by: row.rotatedBy,
    }));
  }

  selfCheck(): SecretResolution[] {
    const names = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'PII_ENCRYPTION_KEY', 'MFA_ENCRYPTION_KEY'];
    return names.map((name) => {
      const value = this.getSecret(name);
      return {
        name,
        source: this.isVaultEnabled() && process.env[`${VAULT_ENV_PREFIX}${name}`] ? 'vault' : 'env',
        present: Boolean(value),
      };
    });
  }
}

export const secretsService = new SecretsService();
