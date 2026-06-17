/**
 * Single commercial plan — 14-day trial, then ₹12,999/mo incl. 5 seats.
 * Additional seats: ₹499/seat/month.
 * Super admin can negotiate a custom base price per agency at invite creation.
 *
 * IMPORTANT: Do not change these values without a corresponding pricing announcement.
 * Existing `company_subscriptions` rows store prices at the time of subscription creation.
 */
export const SUBSCRIPTION_PRICING = {
  planName: 'Investo Pro',
  planSlug: 'investo-pro',
  /** Free trial duration in calendar days. */
  trialDays: 14,
  /** Default monthly base price in INR — includes `includedSeats` active users. */
  basePriceMonthlyInr: 12999,
  /** Number of seats included in the base price. */
  includedSeats: 5,
  /** Price in INR per additional active user per month. */
  perSeatPriceInr: 499,
  /** Days after invoice generation before it becomes overdue. */
  invoiceNetDays: 30,
  /** Days of grace period after trial expiry or missed payment before suspension. */
  gracePeriodDays: 15,
  /** Days before trial end to send reminder emails (descending order). */
  trialReminderDays: [7, 3, 1] as const,
} as const;

export type SubscriptionPaymentMethodType = 'card' | 'invoice' | 'upi' | 'bank_transfer';

export const BILLABLE_USER_ROLES = [
  'company_admin',
  'sales_agent',
  'operations',
  'viewer',
] as const;
