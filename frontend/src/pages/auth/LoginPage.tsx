import React, { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { isMfaPending } from '../../services/identity';
import { resolvePostAuthPath } from '../../utils/postAuthNavigation';
import { AxiosError } from 'axios';
import { consumeSessionExpiredNotice, isTransientAuthError } from '../../services/api';
import { ArrowLeft } from 'lucide-react';
import LanguageSelector from '../../components/common/LanguageSelector';
import InvestoLogo from '../../components/brand/InvestoLogo';
import AuthSignInLoader from '../../components/brand/AuthSignInLoader';
import LoginBrandIntro, {
  AnimatePresence,
  LayoutGroup,
  LoginBrandMarkSlot,
  LoginBrandSplash,
  LoginSuccessLogoFly,
  useLoginBrandIntro,
} from '../../components/brand/LoginBrandIntro';
import { RESOLUTION_IDS } from '../../constants/resolutionIds';

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { isSplash, layoutId } = useLoginBrandIntro();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginStatus, setLoginStatus] = useState('');
  const [successFly, setSuccessFly] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(false);

  const isFormValid = email.trim().length > 0 && password.trim().length > 0;
  const showAuthLoader = isSubmitting && !successFly;

  React.useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('session') === 'expired' || consumeSessionExpiredNotice()) {
      setSessionExpiredNotice(true);
    }
  }, [location.search]);

  const finishSuccessNavigation = React.useCallback(() => {
    if (pendingPath) {
      navigate(pendingPath, { replace: true });
    }
    setSuccessFly(false);
    setPendingPath(null);
    setIsSubmitting(false);
    setLoginStatus('');
  }, [navigate, pendingPath]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setSessionExpiredNotice(false);
    if (!isFormValid) return;

    setIsSubmitting(true);
    setLoginStatus('');
    let authSucceeded = false;

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
      setPendingPath(nextPath);
      authSucceeded = true;
      setSuccessFly(true);
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
      if (!authSucceeded) {
        setIsSubmitting(false);
        setLoginStatus('');
      }
    }
  };

  return (
    <LayoutGroup>
      <AnimatePresence>
        {isSplash ? <LoginBrandSplash layoutId={layoutId} visible /> : null}
      </AnimatePresence>
      <AuthSignInLoader active={showAuthLoader} message={loginStatus || undefined} />
      <LoginSuccessLogoFly active={successFly} onComplete={finishSuccessNavigation} />

      <div className="flex min-h-[100dvh] bg-surface-muted" data-resolution-id={RESOLUTION_IDS.AUTH_BRAND_RESTORE}>
        <div className="hidden w-[42%] flex-col justify-between border-r border-surface-border bg-slate-900 p-10 text-slate-200 lg:flex">
          <div>
            <InvestoLogo
              height={64}
              onDark
              className="max-w-[260px]"
              resolutionId={RESOLUTION_IDS.AUTH_BRAND_RESTORE}
            />
            <Link to="/" className="mt-8 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
              <ArrowLeft className="h-4 w-4" />
              Back to home
            </Link>
            <h2 className="mt-12 font-display text-3xl leading-tight tracking-tight text-white">
              Your agency CRM and WhatsApp AI in one place.
            </h2>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-400">
              Sign in to manage leads, properties, visits, and AI conversations for your team.
            </p>
          </div>
          <p className="text-xs text-slate-500">BIG INVESTO - Real estate operations platform</p>
        </div>

        <div className="flex flex-1 flex-col">
          <div className="flex justify-end p-4">
            <LanguageSelector />
          </div>
          <LoginBrandIntro hidden={isSplash}>
            <div className="flex flex-1 items-center justify-center px-4 pb-12">
              <div className="w-full max-w-md">
                <div className="mb-8 flex flex-col items-center lg:items-start">
                  <LoginBrandMarkSlot layoutId={layoutId} height={54} visible={!isSplash} />
                  <h1
                    className={`mt-4 text-2xl font-semibold tracking-tight text-ink-primary transition-opacity duration-300 ${
                      isSplash ? 'opacity-0' : 'opacity-100'
                    }`}
                  >
                    Sign in
                  </h1>
                  <p
                    className={`mt-1 text-sm text-ink-muted transition-opacity duration-300 ${
                      isSplash ? 'opacity-0' : 'opacity-100'
                    }`}
                  >
                    {t('auth.login')}
                  </p>
                </div>

                <form
                  onSubmit={handleSubmit}
                  noValidate
                  className={`investo-card-pad space-y-5 transition-all duration-300 ${
                    isSplash ? 'pointer-events-none opacity-0' : 'opacity-100'
                  }`}
                >
                  {error && (
                    <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                      {error}
                    </div>
                  )}
                  {sessionExpiredNotice && !error && (
                    <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      Your session expired. Sign in again to continue.
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
                      disabled={isSubmitting || isSplash}
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
                      disabled={isSubmitting || isSplash}
                      className="investo-input mt-1.5"
                      placeholder="********"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting || !isFormValid || isSplash}
                    className="investo-btn-primary w-full py-3 active:scale-[0.98] transition-transform"
                  >
                    {isSubmitting ? t('auth.logging_in') : t('auth.login_button')}
                  </button>
                </form>

                <p
                  className={`mt-6 text-center text-xs text-ink-muted transition-opacity duration-300 ${
                    isSplash ? 'opacity-0' : 'opacity-100'
                  }`}
                >
                  <Link to="/privacy" className="font-medium text-brand-700 hover:underline">
                    Privacy Policy
                  </Link>
                </p>
              </div>
            </div>
          </LoginBrandIntro>
        </div>
      </div>
    </LayoutGroup>
  );
};

export default LoginPage;
