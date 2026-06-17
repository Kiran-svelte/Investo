/**
 * TrialBanner
 *
 * A persistent top-of-page banner shown to company admins during the trial period.
 * - Green (>7 days remaining): low urgency, subtle
 * - Amber (3–7 days): medium urgency
 * - Red (<3 days or past_due): high urgency, pulsing
 *
 * Dismissed per-session (not persisted across reloads).
 * Never shown to super_admin users.
 *
 * @param onSubscribeClick - Callback invoked when "Subscribe Now" is clicked.
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, X, Zap } from 'lucide-react';
import { useSubscription } from '../../context/SubscriptionContext';
import { useAuth } from '../../context/AuthContext';
import { dashboardPath } from '../../config/navigation.config';

/** Urgency level for the trial banner. */
type BannerUrgency = 'green' | 'amber' | 'red';

function resolveUrgency(
  billingStatus: string | null,
  daysRemaining: number | null,
): BannerUrgency {
  if (billingStatus === 'past_due' || billingStatus === 'suspended') return 'red';
  if (daysRemaining === null) return 'green';
  if (daysRemaining <= 2) return 'red';
  if (daysRemaining <= 7) return 'amber';
  return 'green';
}

function buildMessage(billingStatus: string | null, daysRemaining: number | null): string {
  if (billingStatus === 'suspended') {
    return 'Your account is suspended. Renew your subscription to restore access.';
  }
  if (billingStatus === 'past_due') {
    return 'Your trial has ended. Subscribe now to keep all your data and avoid suspension.';
  }
  if (daysRemaining === 0) return 'Your free trial expires today!';
  if (daysRemaining === 1) return '1 day left in your free trial.';
  return `${daysRemaining} days left in your free trial.`;
}

const URGENCY_STYLES: Record<BannerUrgency, string> = {
  green:
    'bg-emerald-50 border-b border-emerald-200 text-emerald-800',
  amber:
    'bg-amber-50 border-b border-amber-300 text-amber-800',
  red:
    'bg-red-50 border-b border-red-300 text-red-800',
};

const URGENCY_ICON_STYLES: Record<BannerUrgency, string> = {
  green: 'text-emerald-600',
  amber: 'text-amber-600',
  red: 'text-red-600',
};

const URGENCY_BUTTON_STYLES: Record<BannerUrgency, string> = {
  green:
    'bg-emerald-600 hover:bg-emerald-700 text-white',
  amber:
    'bg-amber-600 hover:bg-amber-700 text-white',
  red:
    'bg-red-600 hover:bg-red-700 text-white animate-pulse',
};

const TrialBanner: React.FC = () => {
  const { user } = useAuth();
  const { billingStatus, trialDaysRemaining, subscription } = useSubscription();
  const navigate = useNavigate();
  const [isDismissed, setIsDismissed] = useState(false);

  const isSuperAdmin = user?.role === 'super_admin';
  const isCompanyAdmin = user?.role === 'company_admin';

  const shouldShow =
    !isSuperAdmin &&
    isCompanyAdmin &&
    !isDismissed &&
    subscription !== null &&
    (billingStatus === 'trialing' || billingStatus === 'past_due' || billingStatus === 'suspended');

  if (!shouldShow) return null;

  const urgency = resolveUrgency(billingStatus, trialDaysRemaining);
  const message = buildMessage(billingStatus, trialDaysRemaining);
  const billingPath = dashboardPath('/billing');

  const handleSubscribeClick = () => {
    navigate(billingPath);
  };

  const Icon = urgency === 'green' ? Clock : AlertTriangle;

  return (
    <div
      className={`relative flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium ${URGENCY_STYLES[urgency]}`}
      role="status"
      aria-live="polite"
      id="trial-banner"
    >
      {/* Left section: icon + message */}
      <div className="flex items-center gap-2 min-w-0">
        <Icon
          className={`h-4 w-4 flex-shrink-0 ${URGENCY_ICON_STYLES[urgency]}`}
          aria-hidden="true"
        />
        <span className="truncate">{message}</span>
      </div>

      {/* Right section: CTA + dismiss */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          type="button"
          id="trial-banner-subscribe-btn"
          onClick={handleSubscribeClick}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${URGENCY_BUTTON_STYLES[urgency]}`}
          aria-label="Subscribe to Investo Pro"
        >
          <Zap className="h-3 w-3" aria-hidden="true" />
          Subscribe Now
        </button>

        {/* Only allow dismissing when trial is still active (not past_due/suspended) */}
        {billingStatus === 'trialing' && (
          <button
            type="button"
            id="trial-banner-dismiss-btn"
            onClick={() => setIsDismissed(true)}
            className="rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Dismiss trial reminder"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
};

export default TrialBanner;
