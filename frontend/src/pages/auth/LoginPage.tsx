import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { AxiosError } from 'axios';
import { Loader2, Building2 } from 'lucide-react';
import LanguageSelector from '../../components/common/LanguageSelector';

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Validation ───────────────────────────────

  const isFormValid = email.trim().length > 0 && password.trim().length > 0;

  // ── Submit ───────────────────────────────────

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (!isFormValid) return;

    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      const axiosError = err as AxiosError<{ message?: string }>;
      setError(
        axiosError.response?.data?.message ?? t('auth.login_error'),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Language selector – top-right corner */}
      <div className="flex justify-end p-4">
        <LanguageSelector />
      </div>

      {/* Centred card */}
      <div className="flex flex-1 items-center justify-center px-4 pb-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8">
          {/* Brand area */}
          <div className="flex flex-col items-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg">
              <Building2 className="h-8 w-8" />
            </div>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-gray-900">
              Investo
            </h1>
            <p className="mt-2 text-sm text-gray-500">{t('auth.login')}</p>
          </div>

          {/* Form card */}
          <form
            onSubmit={handleSubmit}
            noValidate
            className="mt-8 space-y-6 rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200"
          >
            {/* Error alert */}
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </div>
            )}

            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700"
              >
                {t('auth.email')}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 placeholder-gray-400 shadow-sm
                           focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20
                           disabled:cursor-not-allowed disabled:bg-gray-100 sm:text-sm"
                placeholder="name@company.com"
              />
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700"
                >
                  {t('auth.password')}
                </label>
                <Link
                  to="/forgot-password"
                  className="text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  {t('auth.forgot_password') || 'Forgot password?'}
                </Link>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2.5 text-gray-900 placeholder-gray-400 shadow-sm
                           focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20
                           disabled:cursor-not-allowed disabled:bg-gray-100 sm:text-sm"
                placeholder="••••••••"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting || !isFormValid}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm
                         hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                         disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('auth.logging_in')}
                </>
              ) : (
                t('auth.login_button')
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
