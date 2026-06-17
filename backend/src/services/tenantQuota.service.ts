import config from '../config';
import prisma from '../config/prisma';
import { cacheIncr, cacheGet, cacheSet, cacheDel } from '../config/redis';
import logger from '../config/logger';
import {
  mergeQuotaLimits,
  QUOTA_TIER_DEFAULTS,
  QUOTA_WINDOW_SECONDS,
  resolveQuotaTierFromSettings,
  type QuotaDimension,
  type QuotaLimits,
  type QuotaTier,
} from '../constants/quotaDefaults';

export interface QuotaCheckResult {
  allowed: boolean;
  dimension: QuotaDimension;
  limit: number;
  used: number;
  remaining: number;
  retryAfterSeconds: number;
  warnOnly: boolean;
}

function prismaClient(): any {
  return prisma as any;
}

function quotaRedisKey(companyId: string, dimension: QuotaDimension): string {
  return `quota:${companyId}:${dimension}`;
}

function windowBucketKey(dimension: QuotaDimension): string {
  const windowSec = QUOTA_WINDOW_SECONDS[dimension];
  if (windowSec <= 0) return 'static';
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  return String(bucket);
}

function buildCounterKey(companyId: string, dimension: QuotaDimension): string {
  return `${quotaRedisKey(companyId, dimension)}:${windowBucketKey(dimension)}`;
}

export class TenantQuotaService {
  private limitsCache = new Map<string, { limits: QuotaLimits; expiresAt: number }>();

  isEnabled(): boolean {
    return config.features.tenantQuotas === true;
  }

  isHardEnforce(): boolean {
    return config.features.quotaHardEnforce === true;
  }

  invalidateCache(companyId: string): void {
    this.limitsCache.delete(companyId);
    void cacheDel(`quota:${companyId}:limits-cache`);
  }

  async getEffectiveLimits(companyId: string): Promise<QuotaLimits> {
    const cached = this.limitsCache.get(companyId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.limits;
    }

    const company = await prismaClient().company.findUnique({
      where: { id: companyId },
      select: {
        settings: true,
        quotaOverride: {
          select: { quotas: true, expiresAt: true },
        },
      },
    });

    if (!company) {
      return QUOTA_TIER_DEFAULTS.starter;
    }

    const tier = resolveQuotaTierFromSettings(company.settings);
    let limits = QUOTA_TIER_DEFAULTS[tier];

    const override = company.quotaOverride;
    if (override && (!override.expiresAt || override.expiresAt > new Date())) {
      limits = mergeQuotaLimits(limits, override.quotas as Partial<QuotaLimits>);
    }

    this.limitsCache.set(companyId, {
      limits,
      expiresAt: Date.now() + 60_000,
    });

    return limits;
  }

  async getUsageSnapshot(companyId: string): Promise<{
    tier: QuotaTier;
    limits: QuotaLimits;
    usage: Record<QuotaDimension, { used: number; remaining: number; limit: number }>;
  }> {
    const company = await prismaClient().company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    const tier = resolveQuotaTierFromSettings(company?.settings);
    const limits = await this.getEffectiveLimits(companyId);
    const usage = {} as Record<QuotaDimension, { used: number; remaining: number; limit: number }>;

    for (const dimension of Object.keys(limits) as QuotaDimension[]) {
      const used = await this.readUsage(companyId, dimension);
      const limit = limits[dimension];
      usage[dimension] = {
        used,
        limit,
        remaining: Math.max(0, limit - used),
      };
    }

    return { tier, limits, usage };
  }

  async check(companyId: string, dimension: QuotaDimension, amount = 1): Promise<QuotaCheckResult> {
    if (!this.isEnabled()) {
      return {
        allowed: true,
        dimension,
        limit: Number.MAX_SAFE_INTEGER,
        used: 0,
        remaining: Number.MAX_SAFE_INTEGER,
        retryAfterSeconds: 0,
        warnOnly: false,
      };
    }

    const limits = await this.getEffectiveLimits(companyId);
    const limit = limits[dimension];

    if (dimension === 'import_concurrent') {
      const active = await this.countActiveImportJobs(companyId);
      const projected = active + amount;
      const allowed = projected <= limit;
      return {
        allowed: this.isHardEnforce() ? allowed : true,
        dimension,
        limit,
        used: active,
        remaining: Math.max(0, limit - active),
        retryAfterSeconds: allowed ? 0 : 300,
        warnOnly: !this.isHardEnforce() && !allowed,
      };
    }

    const used = await this.readUsage(companyId, dimension);
    const projected = used + amount;
    const allowed = projected <= limit;
    const windowSec = QUOTA_WINDOW_SECONDS[dimension] || 60;

    return {
      allowed: this.isHardEnforce() ? allowed : true,
      dimension,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      retryAfterSeconds: allowed ? 0 : windowSec,
      warnOnly: !this.isHardEnforce() && !allowed,
    };
  }

  async consume(companyId: string, dimension: QuotaDimension, amount = 1): Promise<QuotaCheckResult> {
    const result = await this.check(companyId, dimension, amount);
    if (!result.allowed && this.isHardEnforce()) {
      await this.recordQuotaExceededAudit(companyId, dimension, result);
      return result;
    }

    if (dimension === 'import_concurrent') {
      return result;
    }

    if (result.warnOnly) {
      logger.warn('Tenant quota warning (warn-only mode)', {
        companyId,
        dimension,
        used: result.used,
        limit: result.limit,
        amount,
      });
      return result;
    }

    await this.incrementUsage(companyId, dimension, amount);
    const used = result.used + amount;
    return {
      ...result,
      used,
      remaining: Math.max(0, result.limit - used),
    };
  }

  async releaseImportSlot(companyId: string): Promise<void> {
    const key = buildCounterKey(companyId, 'import_concurrent');
    const current = await cacheGet<number>(key);
    if (typeof current === 'number' && current > 0) {
      await cacheSet(key, current - 1, 3600);
    }
  }

  private async readUsage(companyId: string, dimension: QuotaDimension): Promise<number> {
    if (dimension === 'import_concurrent') {
      return this.countActiveImportJobs(companyId);
    }

    const key = buildCounterKey(companyId, dimension);
    const value = await cacheGet<number>(key);
    return typeof value === 'number' ? value : 0;
  }

  private async incrementUsage(
    companyId: string,
    dimension: QuotaDimension,
    amount: number,
  ): Promise<number> {
    const windowSec = QUOTA_WINDOW_SECONDS[dimension] || 60;
    const key = buildCounterKey(companyId, dimension);
    let total = 0;
    for (let i = 0; i < amount; i += 1) {
      total = await cacheIncr(key, windowSec);
    }
    return total;
  }

  private async countActiveImportJobs(companyId: string): Promise<number> {
    return prismaClient().propertyImportJob.count({
      where: {
        companyId,
        status: { in: ['queued', 'processing'] },
      },
    });
  }

  private async recordQuotaExceededAudit(
    companyId: string,
    dimension: QuotaDimension,
    result: QuotaCheckResult,
  ): Promise<void> {
    try {
      await prismaClient().auditLog.create({
        data: {
          companyId,
          userId: null,
          action: 'quota_exceeded',
          resourceType: 'tenant_quota',
          resourceId: null,
          details: {
            dimension,
            limit: result.limit,
            used: result.used,
            retryAfterSeconds: result.retryAfterSeconds,
          },
        },
      });
    } catch (err) {
      logger.error('Failed to write quota_exceeded audit log', {
        companyId,
        dimension,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const tenantQuotaService = new TenantQuotaService();
