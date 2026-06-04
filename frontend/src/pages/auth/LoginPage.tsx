import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { getRoleHomePath } from '../../config/navigation.config';
import { AxiosError } from 'axios';
import { isTransientAuthError } from '../../services/api';
import { ArrowLeft, Building2, Loader2 } from 'lucide-react';
import LanguageSelector from '../../components/common/LanguageSelector';

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginStatus, setLoginStatus] = useState('');

  const isFormValid = email.trim().length > 0 && password.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    if (!isFormValid) return;

    setIsSubmitting(true);
    setLoginStatus('');
    try {
      setLoginStatus('Signing in…');
      const loggedInUser = await login(email, password);
      setLoginStatus('Opening your workspace…');
      navigate(getRoleHomePath(loggedInUser.role), { replace: true });
    } catch (err) {
      if (isTransientAuthError(err)) {
        setError('The server is waking up. This can take up to a minute on first visit — please try again.');
        return;
      }
      const axiosError = err as AxiosError<{ message?: string }>;
      const apiMessage = axiosError.response?.data?.message;
      if (axiosError.response?.status === 401) {
        setError(apiMessage ?? 'Invalid email or password.');
        return;
      }
      setError(apiMessage ?? t('auth.login_error'));
    } finally {
      setIsSubmitting(false);
      setLoginStatus('');
    }
  };

  return (
    <div className="flex min-h-screen bg-surface-muted">
      <div className="hidden w-[42%] flex-col justify-between border-r border-surface-border bg-slate-900 p-10 text-slate-200 lg:flex">
        <div>
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
          <h2 className="mt-12 font-display text-3xl leading-tight text-white">
            Your agency CRM and WhatsApp AI in one place.
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
            Sign in to manage leads, properties, visits, and AI conversations for your team.
          </p>
        </div>
        <p className="text-xs text-slate-500">Investo · Real estate operations platform</p>
      </div>

      <div className="flex flex-1 flex-col">
        <div className="flex justify-end p-4">
          <LanguageSelector />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-12">
          <div className="w-full max-w-md">
            <div className="mb-8 flex flex-col items-center lg:items-start">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
                <Building2 className="h-7 w-7" />
              </span>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink-primary">Sign in</h1>
              <p className="mt-1 text-sm text-ink-muted">{t('auth.login')}</p>
            </div>

            <form onSubmit={handleSubmit} noValidate className="investo-card-pad space-y-5">
              {error && (
                <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-ink-secondary">
                  {t('auth.email')}
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  className="investo-input mt-1.5"
                  placeholder="name@company.com"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="block text-sm font-medium text-ink-secondary">
                    {t('auth.password')}
                  </label>
                  <Link to="/forgot-password" className="text-sm font-medium text-brand-700 hover:text-brand-800">
                    {t('auth.forgot_password') || 'Forgot password?'}
                  </Link>
                </div>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  className="investo-input mt-1.5"
                  placeholder="••••••••"
                />
              </div>

              <button type="submit" disabled={isSubmitting || !isFormValid} className="investo-btn-primary w-full py-3">
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {loginStatus || t('auth.logging_in')}
                  </>
                ) : (
                  t('auth.login_button')
                )}
              </button>
              {isSubmitting && loginStatus ? (
                <p className="text-center text-xs text-ink-muted">{loginStatus}</p>
              ) : null}
            </form>

            <p className="mt-6 text-center text-xs text-ink-muted">
              <Link to="/privacy" className="font-medium text-brand-700 hover:underline">
                Privacy Policy
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
