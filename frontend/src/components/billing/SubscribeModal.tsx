/**
 * SubscribeModal
 *
 * Payment method selection modal. Shown when an agency admin clicks "Subscribe Now".
 * Handles four payment methods:
 *   - card: Redirects to Cashfree hosted checkout (card payment)
 *   - upi: Redirects to Cashfree hosted checkout (UPI)
 *   - invoice: Trust-based Net-30. Account activates immediately.
 *   - bank_transfer: Shows bank details. Account activates after payment confirmation.
 *
 * @param isOpen - Whether the modal is visible.
 * @param onClose - Callback to close the modal.
 * @param monthlyTotal - Amount to display to the user.
 * @param onSuccess - Callback invoked after a successful payment or invoice selection.
 */
import React, { useState } from 'react';
import {
  X,
  CreditCard,
  Smartphone,
  FileText,
  Building2,
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import api from '../../services/api';
import { useSubscription } from '../../context/SubscriptionContext';

type PaymentMethod = 'card' | 'upi' | 'invoice' | 'bank_transfer';

interface CheckoutResponse {
  paymentId: string;
  orderId?: string;
  checkoutUrl?: string;
  devMode?: boolean;
  invoiceId?: string;
  instructions?: string;
  amount: number;
}

interface SubscribeModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthlyTotal: number;
  onSuccess: () => void;
}

/** Formats a number as Indian Rupees with no decimals. */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

interface MethodOption {
  id: PaymentMethod;
  label: string;
  description: string;
  icon: React.ElementType;
  badge?: string;
}

const PAYMENT_METHODS: MethodOption[] = [
  {
    id: 'card',
    label: 'Credit / Debit Card',
    description: 'Instant activation. Secure payment via Cashfree.',
    icon: CreditCard,
    badge: 'Recommended',
  },
  {
    id: 'upi',
    label: 'UPI',
    description: 'Pay with any UPI app — GPay, PhonePe, Paytm, etc.',
    icon: Smartphone,
  },
  {
    id: 'invoice',
    label: 'Invoice (Net 30)',
    description: 'Receive a formal invoice. Account stays active on trust.',
    icon: FileText,
    badge: 'Enterprise',
  },
  {
    id: 'bank_transfer',
    label: 'Bank Transfer / NEFT',
    description: 'Transfer directly to our account. Activates after confirmation.',
    icon: Building2,
  },
];

const SubscribeModal: React.FC<SubscribeModalProps> = ({
  isOpen,
  onClose,
  monthlyTotal,
  onSuccess,
}) => {
  const { refresh } = useSubscription();
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('card');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successState, setSuccessState] = useState<{
    message: string;
    instructions?: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await api.post<{ data: CheckoutResponse }>('/subscriptions/checkout', {
        method: selectedMethod,
      });
      const result = response.data.data;

      if (selectedMethod === 'card' || selectedMethod === 'upi') {
        if (result.checkoutUrl) {
          // Redirect to Cashfree hosted checkout page
          window.location.href = result.checkoutUrl;
          return;
        }
        if (result.devMode) {
          // Dev mode: simulate payment success
          await api.post('/subscriptions/confirm', { order_id: result.orderId });
          await refresh();
          setSuccessState({
            message: 'Payment confirmed! (Dev mode)',
            instructions: 'Your account is now active.',
          });
          onSuccess();
          return;
        }
      }

      if (selectedMethod === 'invoice' || selectedMethod === 'bank_transfer') {
        await refresh();
        setSuccessState({
          message:
            selectedMethod === 'invoice'
              ? 'Invoice created. Your account is active!'
              : 'Request received. Account activates after payment confirmation.',
          instructions: result.instructions,
        });
        onSuccess();
        return;
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Payment initiation failed. Please try again.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="subscribe-modal-title"
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h2
                id="subscribe-modal-title"
                className="text-lg font-bold text-white"
              >
                Subscribe to Investo Pro
              </h2>
              <p className="text-blue-100 text-sm mt-0.5">
                {formatCurrency(monthlyTotal)} / month
              </p>
            </div>
            <button
              type="button"
              id="subscribe-modal-close-btn"
              onClick={onClose}
              className="rounded-lg p-1.5 text-blue-100 hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close subscribe modal"
              disabled={isSubmitting}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {successState ? (
            <div className="text-center py-6">
              <CheckCircle className="h-14 w-14 text-green-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-gray-900">{successState.message}</h3>
              {successState.instructions && (
                <p className="text-sm text-gray-500 mt-2 leading-relaxed">
                  {successState.instructions}
                </p>
              )}
              <button
                type="button"
                id="subscribe-modal-done-btn"
                onClick={onClose}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-4">
                Choose how you'd like to pay. All plans include the same features.
              </p>

              {/* Payment method selector */}
              <div className="space-y-2.5">
                {PAYMENT_METHODS.map((method) => {
                  const Icon = method.icon;
                  const isSelected = selectedMethod === method.id;
                  return (
                    <button
                      key={method.id}
                      type="button"
                      id={`payment-method-${method.id}`}
                      onClick={() => setSelectedMethod(method.id)}
                      className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`flex-shrink-0 rounded-lg p-2 ${
                            isSelected
                              ? 'bg-blue-100 text-blue-600'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-sm font-semibold ${
                                isSelected ? 'text-blue-700' : 'text-gray-800'
                              }`}
                            >
                              {method.label}
                            </span>
                            {method.badge && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                                {method.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">{method.description}</p>
                        </div>
                        <div
                          className={`h-4 w-4 flex-shrink-0 rounded-full border-2 mt-1 ${
                            isSelected
                              ? 'border-blue-500 bg-blue-500'
                              : 'border-gray-300'
                          }`}
                        >
                          {isSelected && (
                            <div className="h-full w-full rounded-full bg-white scale-50 block" />
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Error message */}
              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Bank transfer info */}
              {selectedMethod === 'bank_transfer' && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 space-y-1">
                  <p className="font-semibold text-gray-700">Bank Transfer Details</p>
                  <p>Bank: HDFC Bank</p>
                  <p>Account Name: Investo Technologies Pvt Ltd</p>
                  <p>Account No: — (provided in invoice)</p>
                  <p>IFSC: — (provided in invoice)</p>
                  <p className="text-gray-400 mt-1">
                    Share UTR with{' '}
                    <a href="mailto:support@investo.in" className="underline">
                      support@investo.in
                    </a>{' '}
                    after transfer.
                  </p>
                </div>
              )}

              {/* Invoice info */}
              {selectedMethod === 'invoice' && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <p className="font-semibold">Net-30 Invoice</p>
                  <p className="mt-0.5">
                    Your account will remain fully active. We'll send a formal invoice
                    to your registered email. Payment is due within 30 days.
                  </p>
                </div>
              )}

              {/* Footer */}
              <div className="mt-5 flex items-center gap-3">
                <button
                  type="button"
                  id="subscribe-modal-cancel-btn"
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="flex-1 rounded-xl border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  id="subscribe-modal-pay-btn"
                  onClick={() => void handleSubmit()}
                  disabled={isSubmitting}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing…
                    </>
                  ) : (
                    <>
                      {(selectedMethod === 'card' || selectedMethod === 'upi') && (
                        <ExternalLink className="h-4 w-4" />
                      )}
                      {selectedMethod === 'card' || selectedMethod === 'upi'
                        ? 'Proceed to Pay'
                        : 'Confirm'}
                    </>
                  )}
                </button>
              </div>

              <p className="mt-3 text-center text-xs text-gray-400">
                Payments are secured by Cashfree Payments Pvt Ltd.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SubscribeModal;
