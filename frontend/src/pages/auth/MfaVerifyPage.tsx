import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import { verifyMfaLogin } from '../../services/identity';
import { resolvePostAuthPath } from '../../utils/postAuthNavigation';
import { useAuth } from '../../context/AuthContext';

interface MfaVerifyLocationState {
  mfa_token?: string;
  email?: string;
}

const MfaVerifyPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshProfile } = useAuth();
  const state = (location.state || {}) as MfaVerifyLocationState;
  const mfaToken = state.mfa_token || '';

  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!mfaToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
        <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-950">
          <p className="font-semibold">MFA session expired</p>
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
    if (code.trim().length < 6) return;

    setIsSubmitting(true);
    try {
      const user = await verifyMfaLogin(mfaToken, code.trim());
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
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-md investo-card-pad">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold text-ink-primary">Verify authenticator</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Enter the 6-digit code from your authenticator app
            {state.email ? ` for ${state.email}` : ''}.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {error}
            </div>
          ) : null}

          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            className="investo-input text-center text-lg tracking-[0.35em]"
            placeholder="000000"
            disabled={isSubmitting}
          />

          <button type="submit" disabled={isSubmitting || code.length < 6} className="investo-btn-primary w-full py-3">
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying…
              </>
            ) : (
              'Continue'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default MfaVerifyPage;
