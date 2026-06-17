import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Building2, Loader2, Shield } from 'lucide-react';
import { AxiosError } from 'axios';
import { startSsoLogin } from '../../services/identity';
import { isTransientAuthError } from '../../services/api';

const SsoLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const queryError = new URLSearchParams(window.location.search).get('error');

  useEffect(() => {
    if (queryError) {
      setError(queryError);
    }
  }, [queryError]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!email.trim()) return;

    setIsSubmitting(true);
    try {
      const result = await startSsoLogin(email.trim());
      window.location.href = result.redirect_url;
    } catch (err) {
      if (isTransientAuthError(err)) {
        setError('Unable to connect to the server. Please try again.');
        return;
      }
      const axiosError = err as AxiosError<{ error?: string; message?: string }>;
      setError(
        axiosError.response?.data?.error
          ?? axiosError.response?.data?.message
          ?? 'SSO is not available for this email domain.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-surface-muted">
      <div className="flex flex-1 flex-col">
        <div className="flex justify-end p-4">
          <Link to="/login" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-brand-700">
            <ArrowLeft className="h-4 w-4" />
            Back to password login
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-12">
          <div className="w-full max-w-md">
            <div className="mb-8 flex flex-col items-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
                <Building2 className="h-7 w-7" />
              </span>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink-primary">Company SSO</h1>
              <p className="mt-1 text-center text-sm text-ink-muted">
                Sign in with your organization identity provider.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="investo-card-pad space-y-5">
              {error ? (
                <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {error}
                </div>
              ) : null}

              <div>
                <label htmlFor="sso-email" className="block text-sm font-medium text-ink-secondary">
                  Work email
                </label>
                <input
                  id="sso-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={isSubmitting}
                  className="investo-input mt-1.5"
                  placeholder="you@company.com"
                />
              </div>

              <button type="submit" disabled={isSubmitting || !email.trim()} className="investo-btn-primary w-full py-3">
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Redirecting to IdP…
                  </>
                ) : (
                  <>
                    <Shield className="h-4 w-4" />
                    Continue with SSO
                  </>
                )}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-ink-muted">
              Need a local password instead?{' '}
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => navigate('/login')}>
                Sign in with email
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SsoLoginPage;
