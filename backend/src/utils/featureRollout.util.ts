import config from '../config';

export type FeatureKey =
  | 'advancedLeadUx'
  | 'contextualCopilotButtons'
  | 'customGreetingTemplate';

const FEATURE_KEYS: FeatureKey[] = [
  'advancedLeadUx',
  'contextualCopilotButtons',
  'customGreetingTemplate',
];

function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as string[]).includes(value);
}

/**
 * Stable 0–99 bucket for gradual rollout (same lead always maps to same bucket).
 */
export function stableLeadHashBucket(leadId: string): number {
  let hash = 0;
  for (let i = 0; i < leadId.length; i += 1) {
    hash = ((hash << 5) - hash + leadId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 100;
}

export function isGlobalFeatureEnabled(featureKey: FeatureKey | string): boolean {
  if (!isFeatureKey(featureKey)) return false;
  return config.features[featureKey] === true;
}

/**
 * Feature is active when globally enabled AND the lead falls within rollout percentage.
 */
export function isFeatureEnabledForLead(leadId: string, featureKey: FeatureKey | string): boolean {
  if (!leadId?.trim() || !isFeatureKey(featureKey)) return false;
  if (!isGlobalFeatureEnabled(featureKey)) return false;
  return stableLeadHashBucket(leadId.trim()) < config.features.rolloutPercentage;
}
