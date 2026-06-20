/**
 * AcceptInvitePage
 *
 * Public page accessible at /accept-invite/:token.
 * Allows a prospective agency admin to:
 *   1. View invite details (agency name, email, expiry)
 *   2. Create their account (name + password + optional WhatsApp phone)
 *   3. Automatically starts their 14-day free trial on account creation
 *
 * No authentication required — this is a public onboarding route.
 */
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Building2,
  Lock,
  User,
  Phone,
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  Loader2,
  Clock,
  ArrowRight,
} from 'lucide-react';
import api from '../../services/api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { STAFF_PHONE_REQUIRED_MESSAGE } from '../../constants/staffPhonePolicy';

interface InviteDetails {
  agencyName: string;
  adminEmail: string;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'expired';
  negotiatedMonthlyPrice: number | null;
}

/** Validates password meets minimum requirements. */
function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Must contain at least one uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Must contain at least one number.';
  return null;
}

/** Formats a date string to a friendly display. */
function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

const AcceptInvitePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    adminName: '',
    password: '',
    confirmPassword: '',
    whatsappPhone: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    const fetchInvite = async () => {
      if (!token) {
        setInviteError('Invalid invite link.');
        setLoadingInvite(false);
        return;
      }

      try {
        const response = await api.get<{ data: InviteDetails }>(`/agency-invites/${token}`);
        const data = response.data.data;
        setInvite(data);

        if (data.status === 'accepted') {
          setInviteError('This invite has already been accepted. Please log in instead.');
        } else if (data.status === 'expired') {
          setInviteError('This invite link has expired. Please request a new invite.');
        }
      } catch {
        setInviteError('Invite not found or is no longer valid.');
      } finally {
        setLoadingInvite(false);
      }
    };

    void fetchInvite();
  }, [token]);

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    if (!formData.adminName.trim() || formData.adminName.trim().length < 2) {
      errors.adminName = 'Full name must be at least 2 characters.';
    }

    const pwError = validatePassword(formData.password);
    if (pwError) errors.password = pwError;

    if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    if (!formData.whatsappPhone.trim()) {
      errors.whatsappPhone = STAFF_PHONE_REQUIRED_MESSAGE;
    } else if (!/^\+?[\d\s-]{8,15}$/.test(formData.whatsappPhone)) {
      errors.whatsappPhone = 'Enter a valid phone number (e.g. +91 9876543210).';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      await api.post(`/agency-invites/${token}/accept`, {
        admin_name: formData.adminName.trim(),
        password: formData.password,
        whatsapp_phone: formData.whatsappPhone.trim() || undefined,
      });
      setIsSuccess(true);
    } catch (err: unknown) {
      setSubmitError(getApiErrorMessage(err, 'Could not create account. Please try again or contact support.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFieldChange =
    (field: keyof typeof formData) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormData((prev) => ({ ...prev, [field]: e.target.value }));
      if (formErrors[field]) {
        setFormErrors((prev) => {
          const next = { ...prev };
          delete next[field];
          return next;
        });
      }
    };

  // ─── Loading state ──────────────────────────────────────────────────────────
  if (loadingInvite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="flex items-center gap-3 text-blue-700">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="font-medium">Loading invite…</span>
        </div>
      </div>
    );
  }

  // ─── Success state ──────────────────────────────────────────────────────────
  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-green-100 p-4">
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome to Investo!</h1>
          <p className="text-gray-500 mt-2">
            Your account has been created for{' '}
            <strong className="text-gray-700">{invite?.agencyName}</strong>. You have{' '}
            <strong className="text-green-700">14 days of free access</strong> to explore all
            features.
          </p>
          <div className="mt-6 rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-700 text-left">
            <p className="font-semibold mb-1">What's next?</p>
            <ul className="space-y-1 list-disc list-inside text-blue-600">
              <li>Log in with your email and password</li>
              <li>Complete the onboarding wizard</li>
              <li>Invite your team members</li>
            </ul>
          </div>
          <button
            type="button"
            id="accept-invite-login-btn"
            onClick={() => navigate('/login')}
            className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            Log in to your account
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // ─── Error / invalid invite ──────────────────────────────────────────────────
  if (inviteError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-red-100 p-4">
              <AlertCircle className="h-10 w-10 text-red-500" />
            </div>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Invite Unavailable</h1>
          <p className="text-gray-500 mt-2">{inviteError}</p>
          <Link
            to="/login"
            id="accept-invite-back-login-link"
            className="mt-5 inline-flex items-center gap-2 text-sm text-blue-600 hover:underline"
          >
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  // ─── Main invite form ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4 py-10">
      <div className="w-full max-w-lg">
        {/* Header card */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg mb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/20 p-2.5">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-blue-100 text-xs font-medium uppercase tracking-wider">
                You've been invited to
              </p>
              <h1 className="text-xl font-bold">{invite!.agencyName}</h1>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4 text-sm text-blue-100">
            <span>Account: {invite!.adminEmail}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Expires {formatExpiry(invite!.expiresAt)}
            </span>
          </div>
          <div className="mt-3 rounded-xl bg-white/10 p-3 text-sm">
            🎉 <strong>14 days free</strong> — full access to all features, no credit card required
            to start.
          </div>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl shadow-xl p-7">
          <h2 className="text-lg font-bold text-gray-900 mb-5">Create your account</h2>

          <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
            {/* Full name */}
            <div>
              <label htmlFor="accept-invite-name" className="block text-sm font-medium text-gray-700 mb-1">
                Full name *
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  id="accept-invite-name"
                  type="text"
                  autoComplete="name"
                  value={formData.adminName}
                  onChange={handleFieldChange('adminName')}
                  placeholder="Your full name"
                  className={`w-full rounded-xl border pl-10 pr-4 py-2.5 text-sm outline-none transition-colors ${
                    formErrors.adminName
                      ? 'border-red-300 focus:border-red-400'
                      : 'border-gray-300 focus:border-blue-400'
                  }`}
                />
              </div>
              {formErrors.adminName && (
                <p className="text-xs text-red-500 mt-1">{formErrors.adminName}</p>
              )}
            </div>

            {/* Email (pre-filled, read-only) */}
            <div>
              <label htmlFor="accept-invite-email" className="block text-sm font-medium text-gray-700 mb-1">
                Email address
              </label>
              <input
                id="accept-invite-email"
                type="email"
                value={invite!.adminEmail}
                readOnly
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-500 cursor-not-allowed"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="accept-invite-password" className="block text-sm font-medium text-gray-700 mb-1">
                Password *
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  id="accept-invite-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={formData.password}
                  onChange={handleFieldChange('password')}
                  placeholder="Min 8 chars, 1 uppercase, 1 number"
                  className={`w-full rounded-xl border pl-10 pr-10 py-2.5 text-sm outline-none transition-colors ${
                    formErrors.password
                      ? 'border-red-300 focus:border-red-400'
                      : 'border-gray-300 focus:border-blue-400'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {formErrors.password && (
                <p className="text-xs text-red-500 mt-1">{formErrors.password}</p>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label htmlFor="accept-invite-confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                Confirm password *
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  id="accept-invite-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={formData.confirmPassword}
                  onChange={handleFieldChange('confirmPassword')}
                  placeholder="Re-enter your password"
                  className={`w-full rounded-xl border pl-10 pr-4 py-2.5 text-sm outline-none transition-colors ${
                    formErrors.confirmPassword
                      ? 'border-red-300 focus:border-red-400'
                      : 'border-gray-300 focus:border-blue-400'
                  }`}
                />
              </div>
              {formErrors.confirmPassword && (
                <p className="text-xs text-red-500 mt-1">{formErrors.confirmPassword}</p>
              )}
            </div>

            {/* WhatsApp phone */}
            <div>
              <label htmlFor="accept-invite-phone" className="block text-sm font-medium text-gray-700 mb-1">
                WhatsApp phone *
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  id="accept-invite-phone"
                  type="tel"
                  autoComplete="tel"
                  value={formData.whatsappPhone}
                  onChange={handleFieldChange('whatsappPhone')}
                  placeholder="+91 98765 43210"
                  className={`w-full rounded-xl border pl-10 pr-4 py-2.5 text-sm outline-none transition-colors ${
                    formErrors.whatsappPhone
                      ? 'border-red-300 focus:border-red-400'
                      : 'border-gray-300 focus:border-blue-400'
                  }`}
                />
              </div>
              {formErrors.whatsappPhone && (
                <p className="text-xs text-red-500 mt-1">{formErrors.whatsappPhone}</p>
              )}
            </div>

            {/* Submit error */}
            {submitError && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{submitError}</span>
              </div>
            )}

            <button
              type="submit"
              id="accept-invite-submit-btn"
              disabled={isSubmitting}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-60 mt-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating account…
                </>
              ) : (
                <>
                  Create account &amp; start free trial
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-gray-400">
            By creating an account, you agree to our{' '}
            <Link to="/privacy" className="underline">
              Privacy Policy
            </Link>
            . No credit card required to start your free trial.
          </p>
        </div>
      </div>
    </div>
  );
};

export default AcceptInvitePage;
