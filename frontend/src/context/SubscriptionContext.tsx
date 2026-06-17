/**
 * SubscriptionContext
 *
 * Provides global billing/subscription state to all authenticated components.
 * Fetches subscription status once on mount and exposes it via context.
 * Only fetches for non-super-admin users who have a company.
 *
 * Usage:
 *   const { billingStatus, trialDaysRemaining, hasAccess, needsPayment } = useSubscription();
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

export type BillingStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'cancelled'
  | null;

export interface SubscriptionSummary {
  billingStatus: BillingStatus;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialDaysRemaining: number | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  graceUntil: string | null;
  paymentMethod: string | null;
  basePriceMonthly: number;
  negotiatedMonthlyPrice: number | null;
  includedSeats: number;
  perSeatPriceInr: number;
  seatCount: number;
  extraSeats: number;
  monthlyTotal: number;
  nextBillingDate: string | null;
  hasAccess: boolean;
  isTrial: boolean;
  needsPayment: boolean;
}

interface SubscriptionContextValue {
  /** Whether the subscription data is being loaded. */
  isLoading: boolean;
  /** The full subscription summary from the API, or null if not yet loaded. */
  subscription: SubscriptionSummary | null;
  /** Convenience: current billing status string. */
  billingStatus: BillingStatus;
  /** Days remaining in trial, or null if not trialing. */
  trialDaysRemaining: number | null;
  /** Whether the company currently has full platform access. */
  hasAccess: boolean;
  /** Whether payment is urgently needed (trial expired, past_due). */
  needsPayment: boolean;
  /** Refetch subscription status from the API. */
  refresh: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

/**
 * SubscriptionProvider
 *
 * Wraps authenticated parts of the app to provide subscription state.
 * Skips fetching for super_admin users who don't have a company subscription.
 *
 * @param children - React children to wrap.
 */
export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);

  const shouldFetch =
    isAuthenticated &&
    user != null &&
    user.role !== 'super_admin';

  const fetchSubscription = useCallback(async () => {
    if (!shouldFetch) return;

    setIsLoading(true);
    try {
      const response = await api.get<{ data: SubscriptionSummary }>('/subscriptions/status');
      setSubscription(response.data.data ?? null);
    } catch {
      // Subscription may not exist yet for newly onboarded companies.
      // Fail silently — the UI handles the null case gracefully.
      setSubscription(null);
    } finally {
      setIsLoading(false);
    }
  }, [shouldFetch]);

  useEffect(() => {
    void fetchSubscription();
  }, [fetchSubscription]);

  const billingStatus: BillingStatus = subscription?.billingStatus ?? null;
  const trialDaysRemaining = subscription?.trialDaysRemaining ?? null;
  const hasAccess = subscription?.hasAccess ?? true;
  const needsPayment = subscription?.needsPayment ?? false;

  return (
    <SubscriptionContext.Provider
      value={{
        isLoading,
        subscription,
        billingStatus,
        trialDaysRemaining,
        hasAccess,
        needsPayment,
        refresh: fetchSubscription,
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
};

/**
 * useSubscription
 *
 * Hook to access the SubscriptionContext.
 * Must be used inside a SubscriptionProvider.
 *
 * @throws Error if used outside SubscriptionProvider.
 * @returns SubscriptionContextValue
 */
export function useSubscription(): SubscriptionContextValue {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error('useSubscription must be used inside a SubscriptionProvider');
  }
  return ctx;
}
