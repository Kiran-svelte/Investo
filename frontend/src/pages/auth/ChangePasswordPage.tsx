import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Building2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import LanguageSelector from '../../components/common/LanguageSelector';
import InvestoButton from '../../components/ui/InvestoButton';
import api from '../../services/api';
import { resolvePostAuthPath } from '../../utils/postAuthNavigation';

export default function ChangePasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, clearPasswordChangeRequirement } = useAuth();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError(t('auth.password_min_length'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('auth.passwords_dont_match'));
      return;
    }

    try {
      setLoading(true);
      await api.post('/auth/change-password', { new_password: newPassword });
      clearPasswordChangeRequirement();
      const nextPath = await resolvePostAuthPath({
        role: user?.role,
        company_id: user?.company_id,
        must_change_password: false,
      });
      navigate(nextPath, { replace: true });
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { message?: string } } };
      setError(ax.response?.data?.message || t('auth.change_password_error', { defaultValue: 'Failed to change password' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] bg-surface-muted">
      <div className="flex w-full flex-col">
        <div className="flex justify-end p-4">
          <LanguageSelector />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-12">
          <div className="w-full max-w-md">
            <div className="mb-8 flex flex-col items-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
                <Building2 className="h-7 w-7" aria-hidden />
              </span>
              <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink-primary">
                {t('auth.change_password_title')}
              </h1>
              <p className="mt-2 text-center text-sm text-ink-muted">{t('auth.change_password_subtitle')}</p>
            </div>

            <form onSubmit={(e) => void handleSubmit(e)} className="investo-card-pad space-y-5" noValidate>
              {error && (
                <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-ink-secondary">
                  {t('auth.new_password')}
                </label>
                <input
                  id="new-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={loading}
                  className="investo-input mt-1.5"
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-ink-secondary">
                  {t('auth.confirm_password')}
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  className="investo-input mt-1.5"
                  placeholder="••••••••"
                />
              </div>

              <InvestoButton
                type="submit"
                fullWidth
                loading={loading}
                loadingLabel={t('auth.change_password_button')}
                className="py-3"
              >
                {t('auth.change_password_button')}
              </InvestoButton>

              <p className="text-center text-xs text-ink-muted">
                {t('auth.password_requirements')}
              </p>

              <p className="text-center text-sm">
                <Link to="/login" className="font-medium text-brand-700 hover:text-brand-800">
                  {t('auth.back_to_login')}
                </Link>
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
