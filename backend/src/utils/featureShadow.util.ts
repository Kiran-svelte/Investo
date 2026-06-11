import logger from '../config/logger';
import config from '../config';
import {
  isFeatureEnabledForLead,
  isGlobalFeatureEnabled,
  type FeatureKey,
} from './featureRollout.util';

function serializeForCompare(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export type ShadowCompareSyncParams<T> = {
  featureName: string;
  featureKey: FeatureKey;
  leadId?: string | null;
  oldFn: () => T;
  newFn: () => T;
};

export type ShadowCompareParams<T> = {
  featureName: string;
  featureKey: FeatureKey;
  leadId?: string | null;
  oldFn: () => T | Promise<T>;
  newFn: () => T | Promise<T>;
};

/**
 * Synchronous variant for pure resolve paths (e.g. button policy).
 */
export function shadowCompareSync<T>(params: ShadowCompareSyncParams<T>): T {
  const { featureName, featureKey, leadId, oldFn, newFn } = params;
  const oldResult = oldFn();
  const globallyEnabled = isGlobalFeatureEnabled(featureKey);
  const leadInRollout = leadId
    ? isFeatureEnabledForLead(leadId, featureKey)
    : globallyEnabled && config.features.rolloutPercentage >= 100;

  if (!globallyEnabled) {
    if (config.features.shadowMode) {
      const newResult = newFn();
      if (serializeForCompare(oldResult) !== serializeForCompare(newResult)) {
        logger.warn('Feature shadow mismatch (global off)', {
          featureName,
          featureKey,
          leadId: leadId ?? null,
        });
      }
    }
    return oldResult;
  }

  if (leadInRollout) {
    return newFn();
  }

  const newResult = newFn();
  if (serializeForCompare(oldResult) !== serializeForCompare(newResult)) {
    logger.warn('Feature shadow mismatch', {
      featureName,
      featureKey,
      leadId: leadId ?? null,
      rolloutPercentage: config.features.rolloutPercentage,
    });
  }
  return oldResult;
}

/**
 * Runs old/new logic for flagged features. Returns old result unless the lead is
 * in the rollout bucket; logs mismatches when shadow mode is active or rollout excludes the lead.
 */
export async function shadowCompare<T>(params: ShadowCompareParams<T>): Promise<T> {
  const { featureName, featureKey, leadId, oldFn, newFn } = params;
  const oldResult = await oldFn();
  const globallyEnabled = isGlobalFeatureEnabled(featureKey);
  const leadInRollout = leadId
    ? isFeatureEnabledForLead(leadId, featureKey)
    : globallyEnabled && config.features.rolloutPercentage >= 100;

  if (!globallyEnabled) {
    if (config.features.shadowMode) {
      const newResult = await newFn();
      if (serializeForCompare(oldResult) !== serializeForCompare(newResult)) {
        logger.warn('Feature shadow mismatch (global off)', {
          featureName,
          featureKey,
          leadId: leadId ?? null,
        });
      }
    }
    return oldResult;
  }

  if (leadInRollout) {
    return await newFn();
  }

  const newResult = await newFn();
  if (serializeForCompare(oldResult) !== serializeForCompare(newResult)) {
    logger.warn('Feature shadow mismatch', {
      featureName,
      featureKey,
      leadId: leadId ?? null,
      rolloutPercentage: config.features.rolloutPercentage,
    });
  }
  return oldResult;
}
