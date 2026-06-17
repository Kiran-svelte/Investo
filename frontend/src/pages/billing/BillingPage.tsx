/**
 * BillingPage
 *
 * Full billing lifecycle UI for agency admins.
 * Renders different views based on subscription status:
 *   - trialing: Trial countdown, subscribe CTA
 *   - past_due: Urgent payment prompt
 *   - active: Plan details, invoices, next billing date
 *   - suspended: Reactivation prompt
 *
 * After Cashfree redirect returns with ?order_id=..., this page confirms
 * the payment by calling POST /subscriptions/confirm.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  CreditCard,
  Download,
  Check,
  Clock,
  AlertCircle,
  Zap,
  CheckCircle,
  XCircle,
  Users,
  Calendar,
  RefreshCw,
  ArrowRight,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import api from '../../services/api';
import { useSubscription } from '../../context/SubscriptionContext';
import { useAuth } from '../../context/AuthContext';
import SubscribeModal from '../../components/billing/SubscribeModal';

/** Formats a number as Indian Rupees with no decimals. */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Formats a date string to a human-readable date. */
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  amount: number;
  status: 'paid' | 'pending' | 'overdue';
  dueDate: string;
  paidAt: string | null;
  periodStart: string;
  periodEnd: string;
}

const STATUS_BADGE: Record<string, React.ReactElement> = {
  paid: (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
      <Check className="h-3 w-3" /> Paid
    </span>
  ),
  pending: (
    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
      <Clock className="h-3 w-3" /> Pending
    </span>
  ),
  overdue: (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
      <AlertCircle className="h-3 w-3" /> Overdue
    </span>
  ),
};

const BillingPage: React.FC = () => {
  const { user } = useAuth();
  const { subscription, isLoading: subLoading, refresh } = useSubscription();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [showSubscribeModal, setShowSubscribeModal] = useState(false);
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [paymentConfirmResult, setPaymentConfirmResult] = useState<
    'success' | 'failed' | null
  >(null);

  const isSuperAdmin = user?.role === 'super_admin';

  // Confirm payment returned from Cashfree redirect
  const confirmPaymentFromUrl = useCallback(async (orderId: string) => {
    setConfirmingPayment(true);
    try {
      await api.post('/subscriptions/confirm', { order_id: orderId });
      await refresh();
      setPaymentConfirmResult('success');
      // Clear the ?order_id= query param from the URL
      navigate(window.location.pathname, { replace: true });
    } catch {
      setPaymentConfirmResult('failed');
    } finally {
      setConfirmingPayment(false);
    }
  }, [refresh, navigate]);

  useEffect(() => {
    const orderId = searchParams.get('order_id');
    if (orderId) {
      void confirmPaymentFromUrl(orderId);
    }
  }, [searchParams, confirmPaymentFromUrl]);

  const loadInvoices = useCallback(async () => {
    if (isSuperAdmin) return;
    setInvoicesLoading(true);
    try {
      const res = await api.get<{ data: Invoice[] }>('/subscriptions/invoices');
      setInvoices(res.data.data ?? []);
    } catch {
      setInvoices([]);
    } finally {
      setInvoicesLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  const handleDownloadInvoice = async (invoiceId: string, invoiceNumber: string) => {
    try {
      const response = await api.get(`/subscriptions/invoices/${invoiceId}/download`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data as BlobPart]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${invoiceNumber}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setPageError('Failed to download invoice. Please try again.');
    }
  };

  if (subLoading || confirmingPayment) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-gray-500">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span>{confirmingPayment ? 'Confirming your payment…' : 'Loading billing details…'}</span>
      </div>
    );
  }

  // ─── Payment confirmation result banner ─────────────────────────────────────
  const PaymentResultBanner = () => {
    if (!paymentConfirmResult) return null;
    if (paymentConfirmResult === 'success') {
      return (
        <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4">
          <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0" />
          <div>
            <p className="font-semibold text-green-800">Payment successful!</p>
            <p className="text-sm text-green-700">Your account is now active. Enjoy Investo Pro.</p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
        <XCircle className="h-6 w-6 text-red-600 flex-shrink-0" />
        <div>
          <p className="font-semibold text-red-800">Payment could not be confirmed</p>
          <p className="text-sm text-red-700">
            If you completed the payment, please contact{' '}
            <a href="mailto:support@investo.in" className="underline">
              support@investo.in
            </a>{' '}
            with your order ID.
          </p>
        </div>
      </div>
    );
  };

  // ─── No subscription yet ─────────────────────────────────────────────────────
  if (!subscription) {
    return (
      <div className="investo-page">
        <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
          <ShieldAlert className="h-12 w-12 text-gray-300" />
          <div>
            <h2 className="text-lg font-semibold text-gray-700">No subscription found</h2>
            <p className="text-sm text-gray-500 mt-1">
              Contact your platform administrator to set up your subscription.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const {
    billingStatus,
    trialDaysRemaining,
    monthlyTotal,
    nextBillingDate,
    paymentMethod,
    seatCount,
    includedSeats,
    extraSeats,
    basePriceMonthly,
    negotiatedMonthlyPrice,
    perSeatPriceInr,
    trialEndsAt,
    graceUntil,
  } = subscription;

  const effectiveBase = negotiatedMonthlyPrice ?? basePriceMonthly;
  const isNegotiated = negotiatedMonthlyPrice !== null;

  // ─── Hero card config by billing status ─────────────────────────────────────
  const heroConfig = {
    trialing: {
      gradient: 'from-blue-600 to-indigo-700',
      label: 'Free Trial',
      description: `${trialDaysRemaining ?? 0} days remaining • Expires ${formatDate(trialEndsAt)}`,
    },
    active: {
      gradient: 'from-green-600 to-emerald-700',
      label: 'Active',
      description: `Next billing: ${formatDate(nextBillingDate)}`,
    },
    past_due: {
      gradient: 'from-orange-500 to-red-600',
      label: 'Payment Required',
      description: `Grace period until ${formatDate(graceUntil)} — subscribe to keep access`,
    },
    suspended: {
      gradient: 'from-gray-600 to-gray-800',
      label: 'Suspended',
      description: 'Your account access is suspended. Subscribe to reactivate.',
    },
    cancelled: {
      gradient: 'from-gray-500 to-gray-700',
      label: 'Cancelled',
      description: 'Your subscription has been cancelled.',
    },
  };

  const hero = heroConfig[billingStatus ?? 'trialing'] ?? heroConfig.trialing;

  return (
    <div className="investo-page space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink-primary">Billing &amp; Subscription</h1>
        <p className="text-ink-muted text-sm mt-1">
          Manage your Investo Pro subscription and payment history.
        </p>
      </div>

      {pageError && (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          role="alert"
        >
          {pageError}
        </div>
      )}

      <PaymentResultBanner />

      {/* ─── Hero Card ─────────────────────────────────────────────────────── */}
      <div className={`bg-gradient-to-br ${hero.gradient} rounded-2xl p-6 text-white shadow-lg`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="rounded-full bg-white/20 px-3 py-0.5 text-xs font-bold uppercase tracking-wider">
                {hero.label}
              </span>
            </div>
            <h2 className="text-2xl font-bold mt-2">Investo Pro</h2>
            <p className="text-white/80 text-sm mt-1">{hero.description}</p>

            {/* Seat usage */}
            <div className="flex items-center gap-2 mt-3 text-white/90 text-sm">
              <Users className="h-4 w-4" />
              <span>
                {seatCount} active user{seatCount !== 1 ? 's' : ''}
                {extraSeats > 0 ? ` (${extraSeats} extra × ${formatCurrency(perSeatPriceInr)}/mo)` : ' (5 included)'}
              </span>
            </div>
          </div>

          <div className="text-right space-y-2">
            <div>
              <p className="text-white/70 text-xs">Monthly total</p>
              <p className="text-3xl font-bold">{formatCurrency(monthlyTotal)}</p>
              {isNegotiated && (
                <p className="text-white/60 text-xs mt-0.5">Custom negotiated price</p>
              )}
            </div>

            {/* CTA based on status */}
            {(billingStatus === 'trialing' || billingStatus === 'past_due' || billingStatus === 'suspended') &&
              !isSuperAdmin && (
                <button
                  type="button"
                  id="billing-subscribe-now-btn"
                  onClick={() => setShowSubscribeModal(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 transition-colors shadow"
                >
                  <Zap className="h-4 w-4" />
                  Subscribe Now
                </button>
              )}

            {billingStatus === 'active' && paymentMethod && (
              <div className="flex items-center justify-end gap-1.5 text-white/80 text-sm">
                <CreditCard className="h-4 w-4" />
                <span className="capitalize">{paymentMethod.replace('_', ' ')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Trial progress bar */}
        {billingStatus === 'trialing' && trialDaysRemaining !== null && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-white/70 mb-1">
              <span>Trial progress</span>
              <span>{14 - (trialDaysRemaining ?? 0)} / 14 days used</span>
            </div>
            <div className="w-full rounded-full bg-white/20 h-1.5">
              <div
                className="h-1.5 rounded-full bg-white transition-all"
                style={{ width: `${Math.min(100, ((14 - (trialDaysRemaining ?? 0)) / 14) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ─── Plan Breakdown ─────────────────────────────────────────────────── */}
      <div className="investo-card p-6">
        <h2 className="text-base font-semibold text-ink-primary mb-4">Plan Breakdown</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-secondary">
              Base plan ({includedSeats} users included)
            </span>
            <span className="font-medium text-ink-primary">{formatCurrency(effectiveBase)}/mo</span>
          </div>
          {extraSeats > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-secondary">
                Extra users ({extraSeats} × {formatCurrency(perSeatPriceInr)})
              </span>
              <span className="font-medium text-ink-primary">
                {formatCurrency(extraSeats * perSeatPriceInr)}/mo
              </span>
            </div>
          )}
          <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
            <span className="font-semibold text-ink-primary">Total</span>
            <span className="font-bold text-lg text-ink-primary">{formatCurrency(monthlyTotal)}/mo</span>
          </div>
        </div>
      </div>

      {/* ─── What's included ────────────────────────────────────────────────── */}
      <div className="investo-card p-6">
        <h2 className="text-base font-semibold text-ink-primary mb-4">What's included</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            'WhatsApp AI Chatbot',
            'Advanced CRM',
            'Calendar & Visits',
            'Analytics Dashboard',
            'Automation Rules',
            'AI Copilot',
            'Property Management',
            'Bulk Import',
            'Email Notifications',
          ].map((feature) => (
            <div key={feature} className="flex items-center gap-2 text-sm text-ink-secondary">
              <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
              {feature}
            </div>
          ))}
        </div>
      </div>

      {/* ─── Upcoming payment info ──────────────────────────────────────────── */}
      {billingStatus === 'active' && nextBillingDate && (
        <div className="investo-card p-5 flex items-center gap-4">
          <div className="rounded-xl bg-blue-50 p-3">
            <Calendar className="h-6 w-6 text-blue-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-ink-primary">Next billing date</p>
            <p className="text-sm text-ink-secondary">{formatDate(nextBillingDate)}</p>
          </div>
          <span className="font-bold text-ink-primary">{formatCurrency(monthlyTotal)}</span>
        </div>
      )}

      {/* ─── Invoices ───────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-ink-primary">Invoice History</h2>
          <button
            type="button"
            id="billing-refresh-invoices-btn"
            onClick={() => void loadInvoices()}
            className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink-primary transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${invoicesLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="investo-table-wrap">
          {invoicesLoading ? (
            <div className="flex items-center justify-center py-10 text-ink-muted gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading invoices…
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-ink-muted gap-2">
              <CreditCard className="h-10 w-10 text-ink-faint" />
              <p className="text-sm">No invoices yet. They appear after your first payment.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="investo-table-head border-b border-surface-border">
                <tr>
                  {['Invoice', 'Period', 'Amount', 'Due Date', 'Status', ''].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-xs font-semibold text-ink-secondary uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-surface-muted">
                    <td className="px-5 py-3 font-medium text-ink-primary text-sm">
                      {inv.invoiceNumber}
                    </td>
                    <td className="px-5 py-3 text-ink-secondary text-sm">
                      {formatDate(inv.periodStart)} – {formatDate(inv.periodEnd)}
                    </td>
                    <td className="px-5 py-3 font-medium text-ink-primary text-sm">
                      {formatCurrency(inv.amount)}
                    </td>
                    <td className="px-5 py-3 text-ink-secondary text-sm">
                      {formatDate(inv.dueDate)}
                    </td>
                    <td className="px-5 py-3">{STATUS_BADGE[inv.status] ?? null}</td>
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        id={`invoice-download-${inv.id}`}
                        onClick={() => void handleDownloadInvoice(inv.id, inv.invoiceNumber)}
                        className="inline-flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 font-medium"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ─── Help / Support section ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 flex items-center gap-4">
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-800">Need help with billing?</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Contact us at{' '}
            <a href="mailto:support@investo.in" className="underline text-brand-600">
              support@investo.in
            </a>{' '}
            and we'll respond within 24 hours.
          </p>
        </div>
        <a
          href="mailto:support@investo.in"
          id="billing-contact-support-link"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Contact Support
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>

      {/* Subscribe Modal */}
      <SubscribeModal
        isOpen={showSubscribeModal}
        onClose={() => setShowSubscribeModal(false)}
        monthlyTotal={monthlyTotal}
        onSuccess={() => {
          setShowSubscribeModal(false);
          void refresh();
          void loadInvoices();
        }}
      />
    </div>
  );
};

export default BillingPage;
