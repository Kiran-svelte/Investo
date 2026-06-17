import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import api, { ApiResponse } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { resolvePostAuthPath } from '../../utils/postAuthNavigation';
import type { AuthUser } from '../../context/AuthContext';

const SsoCompletePage: React.FC = () => {
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const finish = async () => {
      try {
        const { data } = await api.get<ApiResponse<AuthUser>>('/auth/me');
        if (cancelled) return;
        const user = data.data;
        await refreshProfile();
        const nextPath = await resolvePostAuthPath(user);
        navigate(nextPath, { replace: true });
      } catch {
        if (!cancelled) {
          setError('SSO session could not be established. Try signing in again.');
        }
      }
    };

    void finish();
    return () => {
      cancelled = true;
    };
  }, [navigate, refreshProfile]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
        <div className="max-w-md rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-900">
          <p className="font-semibold">{error}</p>
          <button
            type="button"
            className="investo-btn-primary mt-4"
            onClick={() => navigate('/auth/sso', { replace: true })}
          >
            Back to SSO
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted">
      <div className="flex items-center gap-3 text-ink-secondary">
        <Loader2 className="h-5 w-5 animate-spin" />
        Completing SSO sign-in…
      </div>
    </div>
  );
};

export default SsoCompletePage;
