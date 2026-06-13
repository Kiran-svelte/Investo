import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Phone, Save, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { stripIndianCountryCode } from '../../utils/indianPhone';
import { saveStaffProfile } from '../../services/profile';
import PageHeader from '../../components/ui/PageHeader';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

const ProfilePage: React.FC = () => {
  const { t } = useTranslation();
  const { user, refreshProfile } = useAuth();
  const [name, setName] = useState(user?.name ?? '');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setName(user?.name ?? '');
    setPhoneLocal(user?.phone ? stripIndianCountryCode(user.phone) : '');
  }, [user?.name, user?.phone]);

  const saveProfile = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setMessage('');

      if (!user?.id) {
        setError('Session expired. Please log in again.');
        return;
      }

      setSaving(true);
      try {
        const updated = await saveStaffProfile({
          userId: user.id,
          name: name.trim() || user.name,
          phoneLocal,
        });
        await refreshProfile();
        setMessage('Profile saved. You can use the rest of Investo and WhatsApp agent features.');
        if (updated.phone) {
          setPhoneLocal(stripIndianCountryCode(updated.phone));
        }
      } catch (err: unknown) {
        setError(getApiErrorMessage(err, 'Failed to save profile.'));
      } finally {
        setSaving(false);
      }
    },
    [name, phoneLocal, refreshProfile, user?.name],
  );

  return (
    <div className="investo-page mx-auto max-w-lg space-y-6">
      <PageHeader title="My profile" />

      {!user?.profile_complete && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <p>
            Add your <strong>WhatsApp mobile number</strong> to continue. Investo uses it to recognize you as a
            team member on WhatsApp (sales agent copilot). Other features stay locked until this is saved.
          </p>
        </div>
      )}

      <form onSubmit={(e) => void saveProfile(e)} className="investo-card-pad space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        )}
        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {message}
          </div>
        )}

        <div>
          <label htmlFor="profile-name" className="block text-sm font-medium text-ink-secondary">
            Full name
          </label>
          <input
            id="profile-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="investo-input mt-1.5 w-full"
            required
          />
        </div>

        <div>
          <label htmlFor="profile-phone" className="block text-sm font-medium text-ink-secondary">
            WhatsApp mobile number <span className="text-red-600">*</span>
          </label>
          <div className="relative mt-1.5">
            <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <span className="absolute left-9 top-1/2 -translate-y-1/2 text-sm text-ink-muted">+91</span>
            <input
              id="profile-phone"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={phoneLocal}
              onChange={(e) => setPhoneLocal(e.target.value.replace(/\D/g, '').slice(0, 10))}
              className="investo-input w-full pl-16"
              placeholder="9876543210"
              required
            />
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Must match the number you use on WhatsApp. Same number for all roles (admin, sales, operations).
          </p>
        </div>

        <div className="text-xs text-ink-muted">
          <p>Email: {user?.email}</p>
          <p>Role: {user?.role?.replace('_', ' ')}</p>
        </div>

        <button type="submit" disabled={saving} className="investo-btn-primary inline-flex items-center gap-2">
          {saving ? null : <Save className="h-4 w-4" />}
          {saving ? t('common.saving', { defaultValue: 'Saving…' }) : t('common.save', { defaultValue: 'Save profile' })}
        </button>
      </form>
    </div>
  );
};

export default ProfilePage;
