import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { isMfaPending, getPublicSsoConfig } from '../../services/identity';
import { resolvePostAuthPath } from '../../utils/postAuthNavigation';
import { AxiosError } from 'axios';
import { isTransientAuthError } from '../../services/api';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import LanguageSelector from '../../components/common/LanguageSelector';
import AuthBrandMark from '../../components/brand/AuthBrandMark';
import InvestoLogo from '../../components/brand/InvestoLogo';

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginStatus, setLoginStatus] = useState('');
  const [keycloakEnabled, setKeycloakEnabled] = useState(false);

  useEffect(() => {
    void getPublicSsoConfig()
      .then((cfg) => setKeycloakEnabled(cfg.keycloak_enabled))
      .catch(() => setKeycloakEnabled(false));
  }, []);

  const isFormValid = email.trim().length > 0 && password.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    if (!isFormValid) return;

    setIsSubmitting(true);
    setLoginStatus('');
    try {
      setLoginStatus('Signing in...');
      const result = await login(email, password);
      if (isMfaPending(result)) {
        const target = result.mfa_purpose === 'mfa_enroll' ? '/auth/mfa/enroll' : '/auth/mfa/verify';
        navigate(target, {
          replace: true,
          state: { mfa_token: result.mfa_token, email: result.user.email },
        });
        return;
      }
      setLoginStatus('Opening your workspace...');
      const nextPath = await resolvePostAuthPath(result);
      navigate(nextPath, { replace: true });
    } catch (err) {
      if (isTransientAuthError(err)) {
        setError('Unable to connect to the server. Please check your connection and try again.');
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
      <div className="relative hidden w-[42%] flex-col justify-between overflow-hidden border-r border-surface-border bg-slate-950 p-10 text-slate-200 lg:flex">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <motion.div
            className="absolute inset-x-0 top-0 h-44 bg-[linear-gradient(180deg,rgba(34,211,238,0.18),transparent)]"
            animate={reduceMotion ? undefined : { y: [0, 16, 0], opacity: [0.6, 0.9, 0.6] }}
            transition={reduceMotion ? undefined : { duration: 7, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className="absolute inset-y-0 right-0 w-2/3 bg-[linear-gradient(110deg,transparent,rgba(250,204,21,0.12))]"
            animate={reduceMotion ? undefined : { x: [0, -18, 0], opacity: [0.32, 0.55, 0.32] }}
            transition={reduceMotion ? undefined : { duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:48px_48px] opacity-25" />
        </div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10"
        >
          <motion.div
            className="inline-flex rounded-3xl bg-black p-2 shadow-[0_26px_70px_rgba(34,211,238,0.22)] ring-1 ring-yellow-300/25"
            animate={reduceMotion ? undefined : { y: [0, -6, 0], rotate: [0, -0.4, 0.4, 0] }}
            transition={reduceMotion ? undefined : { duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <InvestoLogo height={72} className="rounded-2xl" />
          </motion.div>
          <Link to="/" className="mt-8 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>
          <h2 className="mt-12 font-display text-3xl leading-tight text-white">
            Your agency CRM and WhatsApp AI in one place.
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
            Sign in to manage leads, properties, visits, and AI conversations for your team.
          </p>
        </motion.div>
        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 text-xs text-slate-500"
        >
          BIG INVESTO - Real estate operations platform
        </motion.p>
      </div>

      <div className="flex flex-1 flex-col">
        <div className="flex justify-end p-4">
          <LanguageSelector />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-12">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-md"
          >
            <div className="mb-8 flex flex-col items-center lg:items-start">
              <AuthBrandMark height={48} align="start" />
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
              <p className="text-center text-sm text-ink-muted">
                <Link to="/auth/sso" className="font-medium text-brand-700 hover:underline">
                  {keycloakEnabled ? 'Sign in with Keycloak SSO' : 'Sign in with company SSO'}
                </Link>
              </p>
              {isSubmitting && loginStatus ? (
                <p className="text-center text-xs text-ink-muted">{loginStatus}</p>
              ) : null}
            </form>

            <p className="mt-6 text-center text-xs text-ink-muted">
              <Link to="/privacy" className="font-medium text-brand-700 hover:underline">
                Privacy Policy
              </Link>
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
