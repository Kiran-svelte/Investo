import config from '../config';
import { isFeatureEnabledForLead } from './featureRollout.util';

/**
 * Kill-switch flags for fix.md audit items (PR-3/4/5).
 * Default ON — set FEATURE_FIX_MD_*=false on Railway to revert without redeploying code.
 */
export type FixMdFeatureKey =
  | 'fixMdReturningBuyerStage'
  | 'fixMdCustomGreetingSelect'
  | 'fixMdStaffBuyerCollisionLog'
  | 'fixMdCopilotRoleFilter'
  | 'fixMdBulkSendExtract'
  | 'fixMdPropertyMediaCompleteness';

export function isFixMdEnabled(key: FixMdFeatureKey): boolean {
  const features = config.features as { [K in FixMdFeatureKey]?: boolean };
  return features[key] !== false;
}

/**
 * Elevate conversation stage for visited/negotiation leads without rollout bucket
 * when fixMdReturningBuyerStage is ON; otherwise fall back to advancedLeadUx rollout.
 */
export function shouldElevateReturningBuyerStage(leadId: string | undefined): boolean {
  if (isFixMdEnabled('fixMdReturningBuyerStage')) return true;
  if (!leadId?.trim()) return false;
  return isFeatureEnabledForLead(leadId, 'advancedLeadUx');
}
