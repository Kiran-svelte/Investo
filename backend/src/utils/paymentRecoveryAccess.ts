import { RESOLUTION_IDS } from '../constants/resolutionIds';

type CompanyBillingRecoveryShape = {
  status: string;
  subscription?: { billingStatus: string } | null;
};

const BILLING_RECOVERY_STATUSES = new Set(['past_due', 'suspended']);

/**
 * INVESTO-20260629-PAYMENT-LOCKOUT:
 * Billing-suspended companies must still authenticate so they can reach Billing.
 * The app-level subscription gate blocks product APIs after authentication.
 */
export function canAuthenticateCompanyForBillingRecovery(company: CompanyBillingRecoveryShape | null): boolean {
  if (!company) return false;
  if (company.status === 'active') return true;
  return BILLING_RECOVERY_STATUSES.has(company.subscription?.billingStatus ?? '');
}

export const PAYMENT_RECOVERY_ACCESS_RESOLUTION_ID = RESOLUTION_IDS.PAYMENT_LOCKOUT;
