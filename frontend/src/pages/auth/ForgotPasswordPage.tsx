import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import { Mail, ArrowLeft, Loader2, CheckCircle } from 'lucide-react';

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email) {
      setError(t('auth.email_required') || 'Email is required');
      return;
    }

    try {
      setLoading(true);
      await api.post('/auth/forgot-password', { email });
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100 py-12 px-4">
        <div className="max-w-md w-full space-y-8 text-center">
          <div className="investo-card-pad shadow-xl">
            <CheckCircle className="mx-auto h-16 w-16 text-green-500 mb-4" />
            <h2 className="text-2xl font-bold text-ink-primary mb-2">
              {t('auth.check_email') || 'Check Your Email'}
            </h2>
            <p className="text-ink-secondary mb-6">
              {t('auth.reset_email_sent') || 'If an account exists with this email, you will receive a password reset link shortly.'}
            </p>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-brand-600 hover:text-brand-700 font-medium"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('auth.back_to_login') || 'Back to Login'}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="text-center text-3xl font-bold text-brand-600">INVESTO</h1>
          <h2 className="mt-6 text-center text-2xl font-bold text-ink-primary">
            {t('auth.forgot_password_title') || 'Forgot Password?'}
          </h2>
          <p className="mt-2 text-center text-sm text-ink-secondary">
            {t('auth.forgot_password_subtitle') || 'Enter your email and we\'ll send you a reset link'}
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-ink-secondary">
              {t('auth.email') || 'Email Address'}
            </label>
            <div className="mt-1 relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-ink-faint" />
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full pl-10 pr-3 py-3 investo-input"
                placeholder={t('auth.email_placeholder') || 'name@company.com'}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="investo-btn-primary w-full py-3"
          >
            {loading ? (
              <span className="flex items-center">
                <Loader2 className="animate-spin -ml-1 mr-3 h-5 w-5" />
                {t('common.sending') || 'Sending...'}
              </span>
            ) : (
              t('auth.send_reset_link') || 'Send Reset Link'
            )}
          </button>

          <div className="text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-sm text-brand-600 hover:text-brand-700 font-medium"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('auth.back_to_login') || 'Back to Login'}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
