/**
 * INVESTO-20260630-PRODUCTION-BILLING-BYPASS:
 * Billing and checkout remain visible, but workspace access is not blocked
 * unless this flag is explicitly enabled after payments are production-ready.
 */
export function isSubscriptionAccessEnforcementEnabled(): boolean {
  return import.meta.env.VITE_SUBSCRIPTION_ACCESS_ENFORCEMENT === 'true';
}
