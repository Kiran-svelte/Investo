import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, QrCode } from 'lucide-react';
import { enrollMfaPending, verifyMfaEnrollmentPending } from '../../services/identity';
import { resolvePostAuthPath } from '../../utils/postAuthNavigation';
import { useAuth } from '../../context/AuthContext';

interface MfaEnrollLocationState {
  mfa_token?: string;
  email?: string;
}

const MfaEnrollPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshProfile } = useAuth();
  const state = (location.state || {}) as MfaEnrollLocationState;
  const mfaToken = state.mfa_token || '';

  const [deviceId, setDeviceId] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loadingEnroll, setLoadingEnroll] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!mfaToken) return;

    let cancelled = false;
    const load = async () => {
      setLoadingEnroll(true);
      setError('');
      try {
        const result = await enrollMfaPending(mfaToken);
        if (cancelled) return;
        setDeviceId(result.device_id);
        setOtpauthUrl(result.otpauth_url);
        setSecret(result.secret);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not start MFA enrollment.');
        }
      } finally {
        if (!cancelled) setLoadingEnroll(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [mfaToken]);

  if (!mfaToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
        <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-950">
          <p className="font-semibold">MFA enrollment session expired</p>
          <button type="button" className="investo-btn-primary mt-4" onClick={() => navigate('/login', { replace: true })}>
            Back to login
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!deviceId || code.trim().length < 6) return;

    setIsSubmitting(true);
    try {
      const user = await verifyMfaEnrollmentPending(mfaToken, deviceId, code.trim());
      await refreshProfile();
      const nextPath = await resolvePostAuthPath(user);
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid verification code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-10">
      <div className="w-full max-w-lg investo-card-pad">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <QrCode className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold text-ink-primary">Set up authenticator</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Your organization requires MFA{state.email ? ` for ${state.email}` : ''}.
          </p>
        </div>

        {loadingEnroll ? (
          <div className="flex items-center justify-center gap-2 py-10 text-ink-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
            Preparing enrollment…
          </div>
        ) : (
          <div className="space-y-5">
            {error ? (
              <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {error}
              </div>
            ) : null}

            <div className="rounded-lg border border-surface-border bg-white p-4">
              <p className="text-sm font-medium text-ink-secondary">Scan this URL in your authenticator app</p>
              <p className="mt-2 break-all font-mono text-xs text-ink-muted">{otpauthUrl}</p>
              <p className="mt-4 text-sm text-ink-muted">
                Manual secret: <span className="font-mono text-ink-secondary">{secret}</span>
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="mfa-code" className="block text-sm font-medium text-ink-secondary">
                  Verification code
                </label>
                <input
                  id="mfa-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                  className="investo-input mt-1.5 text-center text-lg tracking-[0.35em]"
                  placeholder="000000"
                  disabled={isSubmitting}
                />
              </div>

              <button type="submit" disabled={isSubmitting || code.length < 6} className="investo-btn-primary w-full py-3">
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  'Activate MFA'
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

export default MfaEnrollPage;
