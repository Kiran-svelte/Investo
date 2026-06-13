import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getRoleCapabilities } from '../../config/navigation.config';
import api from '../../services/api';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { formatIndianPhoneForApi, stripIndianCountryCode } from '../../utils/indianPhone';
import { dispatchCompanyFeaturesReload } from '../../utils/featureReload';
import {
  Settings, Building2, Shield, ToggleLeft, Save, Plus, Pencil, Trash2,
  X, Loader2, Lock, Users, Sparkles,
} from 'lucide-react';
import LeadRoutingSettings from '../../components/settings/LeadRoutingSettings';
import useConfirmDialog from '../../hooks/useConfirmDialog';

// ── Types ──────────────────────────────────────

interface CompanyProfile {
  name: string;
  description: string;
  whatsapp_phone: string;
  primary_color: string;
}

interface Role {
  id: string;
  role_name: string;
  display_name: string;
  permissions: Record<string, string[]>;
  isDefault: boolean;
}

interface RolesData {
  customRoles: Role[];
  systemRoles: Role[];
}

interface Feature {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
}

// ── Constants ──────────────────────────────────

const TABS = ['company', 'conversion', 'roles', 'features'] as const;
type Tab = (typeof TABS)[number];

interface ConversionPartner {
  id: string;
  name: string;
  contact_phone?: string | null;
  notes?: string | null;
  active: boolean;
}

interface ConversionSettings {
  budget_stretch_percent: number;
  upsell_enabled: boolean;
  waitlist_copy: { en: string; hi?: string; kn?: string };
  partners: ConversionPartner[];
}

const RESOURCES = ['leads', 'properties', 'visits', 'conversations', 'agents', 'analytics', 'settings'] as const;
const ACTIONS = ['read', 'create', 'update', 'delete'] as const;

// ── Role Modal ─────────────────────────────────

interface RoleModalProps {
  role: Role | null;
  onClose: () => void;
  onSaved: () => void;
}

const RoleModal: React.FC<RoleModalProps> = ({ role, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    role_name: role?.role_name || '',
    display_name: role?.display_name || '',
  });
  const [permissions, setPermissions] = useState<Record<string, string[]>>(
    role?.permissions || {}
  );

  const togglePermission = (resource: string, action: string) => {
    setPermissions(prev => {
      const current = prev[resource] || [];
      const has = current.includes(action);
      return {
        ...prev,
        [resource]: has ? current.filter(a => a !== action) : [...current, action],
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.role_name.trim() || !form.display_name.trim()) {
      setError('Role name and display name are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = { ...form, permissions };
      if (role) {
        await api.put(`/roles/${role.id}`, body);
      } else {
        await api.post('/roles', body);
      }
      onSaved();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save role');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="investo-modal-overlay">
      <div className="investo-modal-panel sm:max-w-2xl">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{role ? t('settings.editRole') : t('settings.createRole')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-surface-subtle rounded">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">{t('settings.roleName')}</label>
              <input
                name="role_name"
                value={form.role_name}
                onChange={e => setForm(p => ({ ...p, role_name: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                placeholder="e.g. team_lead"
                disabled={!!role}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">{t('settings.displayName')}</label>
              <input
                name="display_name"
                value={form.display_name}
                onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                placeholder="e.g. Team Lead"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-2">{t('settings.permissions')}</label>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="investo-table-head">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-ink-secondary">{t('settings.resource')}</th>
                    {ACTIONS.map(a => (
                      <th key={a} className="px-3 py-2 font-medium text-ink-secondary text-center capitalize">{a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RESOURCES.map(resource => (
                    <tr key={resource} className="border-t">
                      <td className="px-3 py-2 capitalize font-medium text-ink-secondary">{resource}</td>
                      {ACTIONS.map(action => (
                        <td key={action} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={(permissions[resource] || []).includes(action)}
                            onChange={() => togglePermission(resource, action)}
                            className="h-4 w-4 text-brand-700 rounded focus:ring-brand-500"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-surface-border-strong rounded-lg hover:bg-surface-muted">
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 investo-btn-primary disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Settings Page ──────────────────────────────

const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const capabilities = getRoleCapabilities(user?.role);
  const { confirm, Dialog } = useConfirmDialog();
  const [activeTab, setActiveTab] = useState<Tab>('company');
  const [pageError, setPageError] = useState<string | null>(null);

  // Company profile state
  const [company, setCompany] = useState<CompanyProfile>({
    name: '', description: '', whatsapp_phone: '', primary_color: '#3B82F6',
  });
  const [companySaving, setCompanySaving] = useState(false);
  const [companyMsg, setCompanyMsg] = useState('');

  // Roles state
  const [roles, setRoles] = useState<RolesData>({ customRoles: [], systemRoles: [] });
  const [rolesLoading, setRolesLoading] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  // Features state
  const [features, setFeatures] = useState<Feature[]>([]);
  const [featuresLoading, setFeaturesLoading] = useState(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  // Conversion (Phase 2)
  const [conversion, setConversion] = useState<ConversionSettings>({
    budget_stretch_percent: 15,
    upsell_enabled: true,
    waitlist_copy: { en: '', hi: '', kn: '' },
    partners: [],
  });
  const [conversionLoading, setConversionLoading] = useState(false);
  const [conversionSaving, setConversionSaving] = useState(false);
  const [conversionMsg, setConversionMsg] = useState('');
  const [partnerDraft, setPartnerDraft] = useState<ConversionPartner | null>(null);

  // ── Load data ──

  const loadCompany = useCallback(async () => {
    try {
      const res = await api.get('/onboarding/setup');
      const d = res.data.data;
      setCompany({
        name: d.name || '',
        description: d.description || '',
        whatsapp_phone: d.whatsapp_phone ? stripIndianCountryCode(d.whatsapp_phone) : '',
        primary_color: d.primary_color || '#3B82F6',
      });
    } catch {
      // May not exist yet
    }
  }, []);

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      setPageError(null);
      const res = await api.get('/roles');
      setRoles(res.data.data);
    } catch {
      setPageError('Could not load roles.');
    } finally {
      setRolesLoading(false);
    }
  }, []);

  const loadFeatures = useCallback(async () => {
    setFeaturesLoading(true);
    try {
      setPageError(null);
      const res = await api.get('/features');
      setFeatures(res.data.data);
    } catch {
      setPageError('Could not load feature toggles.');
    } finally {
      setFeaturesLoading(false);
    }
  }, []);

  const loadConversion = useCallback(async () => {
    setConversionLoading(true);
    try {
      setPageError(null);
      const res = await api.get('/conversion-settings');
      setConversion(res.data.data);
    } catch {
      setPageError('Could not load conversion settings.');
    } finally {
      setConversionLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'company') loadCompany();
    else if (activeTab === 'conversion') loadConversion();
    else if (activeTab === 'roles') loadRoles();
    else if (activeTab === 'features') loadFeatures();
  }, [activeTab, loadCompany, loadConversion, loadRoles, loadFeatures]);

  const saveConversion = async (e: React.FormEvent) => {
    e.preventDefault();
    setConversionSaving(true);
    setConversionMsg('');
    try {
      await api.put('/conversion-settings', conversion);
      setConversionMsg('Settings saved successfully');
    } catch (err: unknown) {
      setConversionMsg(getApiErrorMessage(err, 'Failed to save conversion settings'));
    } finally {
      setConversionSaving(false);
    }
  };

  const removePartner = (id: string) => {
    setConversion(prev => ({
      ...prev,
      partners: prev.partners.filter(p => p.id !== id),
    }));
  };

  const savePartnerDraft = () => {
    if (!partnerDraft?.name.trim()) return;
    const id = partnerDraft.id || `partner-${Date.now()}`;
    const partner: ConversionPartner = { ...partnerDraft, id };
    setConversion(prev => ({
      ...prev,
      partners: prev.partners.some(p => p.id === id)
        ? prev.partners.map(p => (p.id === id ? partner : p))
        : [...prev.partners, partner],
    }));
    setPartnerDraft(null);
  };

  // ── Company handlers ──

  const handleCompanyChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setCompany(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const saveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setCompanySaving(true);
    setCompanyMsg('');
    try {
      await api.put('/onboarding/setup', {
        ...company,
        whatsapp_phone: formatIndianPhoneForApi(company.whatsapp_phone),
      });
      setCompanyMsg('Settings saved successfully');
    } catch (err: any) {
      setCompanyMsg(err.response?.data?.message || 'Failed to save');
    } finally {
      setCompanySaving(false);
    }
  };

  // ── Role handlers ──

  const deleteRole = async (id: string) => {
    const confirmed = await confirm(
      'Delete role?',
      'Users assigned to this custom role may lose access until another role is assigned.',
      { confirmLabel: 'Delete' },
    );
    if (!confirmed) return;
    try {
      await api.delete(`/roles/${id}`);
      loadRoles();
    } catch (err: any) {
      setPageError(err.response?.data?.message || 'Failed to delete role');
    }
  };

  // ── Feature handler ──

  const toggleFeature = async (key: string, enabled: boolean) => {
    setTogglingKey(key);
    try {
      await api.put(`/features/${key}`, { enabled });
      setFeatures(prev => prev.map(f => f.key === key ? { ...f, enabled } : f));
      dispatchCompanyFeaturesReload();
    } catch {
      setPageError('Could not update that feature toggle.');
    } finally {
      setTogglingKey(null);
    }
  };

  // ── Render helpers ──

  const allRoles = [...roles.systemRoles, ...roles.customRoles];

  const tabConfig = useMemo(() => {
    if (!capabilities.canManageTenantSettings) return [];
    return [
      { key: 'company' as Tab, label: t('settings.companyProfile'), icon: Building2 },
      { key: 'conversion' as Tab, label: 'Conversion', icon: Sparkles },
      { key: 'roles' as Tab, label: t('settings.rolesManagement'), icon: Shield },
      { key: 'features' as Tab, label: t('settings.featureToggles'), icon: ToggleLeft },
    ];
  }, [capabilities.canManageTenantSettings, t]);

  if (!capabilities.canManageTenantSettings) {
    return (
      <div className="investo-page space-y-6 max-w-xl">
        <div className="flex items-center gap-3">
          <Settings className="h-7 w-7 text-ink-secondary" />
          <h1 className="text-2xl font-bold text-ink-primary">{t('nav.settings')}</h1>
        </div>
        {capabilities.isPlatformAdmin && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            Platform admin: manage agencies under <strong>Companies</strong>. Tenant profile, roles, and feature toggles are configured by each agency&apos;s <strong>Company Admin</strong> during onboarding.
          </p>
        )}
        <div className="investo-card-pad space-y-4">
          <h2 className="font-semibold text-ink-primary">Your account</h2>
          <div>
            <p className="text-sm text-ink-muted">Name</p>
            <p className="font-medium text-ink-primary">{user?.name}</p>
          </div>
          <div>
            <p className="text-sm text-ink-muted">Email</p>
            <p className="font-medium text-ink-primary">{user?.email}</p>
          </div>
          <div>
            <p className="text-sm text-ink-muted">Role</p>
            <p className="font-medium text-ink-primary">{user?.role?.replace('_', ' ')}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/change-password')}
            className="inline-flex items-center gap-2 px-4 py-2 investo-btn-primary"
          >
            <Lock className="h-4 w-4" />
            Change password
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="investo-page space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Settings className="h-7 w-7 text-ink-secondary" />
        <h1 className="text-2xl font-bold text-ink-primary">{t('nav.settings')}</h1>
      </div>

      {pageError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {pageError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-surface-subtle rounded-lg p-1">
        {tabConfig.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-surface-elevated text-brand-700 shadow-sm'
                  : 'text-ink-secondary hover:text-ink-primary'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab: Company Profile */}
      {activeTab === 'company' && (
        <div className="investo-card-pad">
          <form onSubmit={saveCompany} className="space-y-4 max-w-xl">
            {companyMsg && (
              <div className={`p-3 rounded-lg text-sm ${companyMsg.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {companyMsg}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">{t('settings.companyName')}</label>
              <input
                name="name"
                value={company.name}
                onChange={handleCompanyChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                placeholder={t('settings.companyNamePlaceholder')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">{t('settings.description')}</label>
              <textarea
                name="description"
                value={company.description}
                onChange={handleCompanyChange}
                rows={3}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                placeholder={t('settings.descriptionPlaceholder')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">{t('settings.whatsappPhone')}</label>
              <input
                name="whatsapp_phone"
                value={company.whatsapp_phone}
                onChange={handleCompanyChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                placeholder="+91XXXXXXXXXX"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">{t('settings.primaryColor')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  name="primary_color"
                  value={company.primary_color}
                  onChange={handleCompanyChange}
                  className="h-10 w-14 rounded border cursor-pointer"
                />
                <span className="text-sm text-ink-muted">{company.primary_color}</span>
              </div>
            </div>
            <div className="pt-2">
              <button
                type="submit"
                disabled={companySaving}
                className="px-4 py-2 investo-btn-primary disabled:opacity-50 flex items-center gap-2"
              >
                {companySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t('common.save')}
              </button>
            </div>
          </form>
          {user?.role === 'company_admin' && (
            <div className="mt-6">
              <LeadRoutingSettings />
            </div>
          )}
        </div>
      )}

      {/* Tab: Conversion settings (Phase 2) */}
      {activeTab === 'conversion' && (
        <div className="investo-card-pad">
          {conversionLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-ink-faint" /></div>
          ) : (
            <form onSubmit={saveConversion} className="space-y-6 max-w-2xl">
              {conversionMsg && (
                <div className={`p-3 rounded-lg text-sm ${conversionMsg.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {conversionMsg}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">
                  Budget stretch % (when no exact match)
                </label>
                <input
                  type="number"
                  min={5}
                  max={50}
                  value={conversion.budget_stretch_percent}
                  onChange={e => setConversion(prev => ({ ...prev, budget_stretch_percent: Number(e.target.value) }))}
                  className="w-32 px-3 py-2 border rounded-lg"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-secondary">
                <input
                  type="checkbox"
                  checked={conversion.upsell_enabled}
                  onChange={e => setConversion(prev => ({ ...prev, upsell_enabled: e.target.checked }))}
                />
                Enable +1 BHK upsell tier
              </label>
              <div className="space-y-2">
                <p className="text-sm font-medium text-ink-secondary">Waitlist message copy</p>
                {(['en', 'hi', 'kn'] as const).map(lang => (
                  <textarea
                    key={lang}
                    rows={2}
                    placeholder={`Waitlist (${lang})`}
                    value={conversion.waitlist_copy[lang] || ''}
                    onChange={e => setConversion(prev => ({
                      ...prev,
                      waitlist_copy: { ...prev.waitlist_copy, [lang]: e.target.value },
                    }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                ))}
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-ink-secondary flex items-center gap-1">
                    <Users className="h-4 w-4" /> Referral partners (manual list)
                  </p>
                  <button
                    type="button"
                    onClick={() => setPartnerDraft({ id: '', name: '', contact_phone: '', notes: '', active: true })}
                    className="text-sm text-brand-700 hover:underline flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add partner
                  </button>
                </div>
                {conversion.partners.length === 0 ? (
                  <p className="text-sm text-ink-muted">No partners yet. Phase 4 will add inventory API.</p>
                ) : (
                  <ul className="divide-y border rounded-lg">
                    {conversion.partners.map(p => (
                      <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span>
                          <strong>{p.name}</strong>
                          {p.contact_phone && <span className="text-ink-muted ml-2">{p.contact_phone}</span>}
                          {!p.active && <span className="ml-2 text-orange-600">(inactive)</span>}
                        </span>
                        <div className="flex gap-1">
                          <button type="button" onClick={() => setPartnerDraft(p)} className="p-1 hover:bg-surface-subtle rounded"><Pencil className="h-3 w-3" /></button>
                          <button type="button" onClick={() => removePartner(p.id)} className="p-1 hover:bg-red-50 rounded text-red-500"><Trash2 className="h-3 w-3" /></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {partnerDraft && (
                <div className="border rounded-lg p-4 space-y-2 bg-surface-muted">
                  <input
                    placeholder="Partner name"
                    value={partnerDraft.name}
                    onChange={e => setPartnerDraft({ ...partnerDraft, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                  <input
                    placeholder="Contact phone"
                    value={partnerDraft.contact_phone || ''}
                    onChange={e => setPartnerDraft({ ...partnerDraft, contact_phone: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                  <textarea
                    placeholder="Notes"
                    value={partnerDraft.notes || ''}
                    onChange={e => setPartnerDraft({ ...partnerDraft, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={savePartnerDraft} className="px-3 py-1.5 investo-btn-primary text-sm">Done</button>
                    <button type="button" onClick={() => setPartnerDraft(null)} className="px-3 py-1.5 border rounded-lg text-sm">Cancel</button>
                  </div>
                </div>
              )}
              <button
                type="submit"
                disabled={conversionSaving}
                className="px-4 py-2 investo-btn-primary disabled:opacity-50 flex items-center gap-2"
              >
                {conversionSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t('common.save')}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Tab: Roles Management */}
      {activeTab === 'roles' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => { setEditingRole(null); setShowRoleModal(true); }}
              className="px-4 py-2 investo-btn-primary flex items-center gap-2"
            >
              <Plus className="h-4 w-4" /> {t('settings.createRole')}
            </button>
          </div>

          {rolesLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-ink-faint" /></div>
          ) : allRoles.length === 0 ? (
            <div className="investo-card-pad text-center text-ink-muted">
              {t('common.no_data')}
            </div>
          ) : (
            <div className="grid gap-4">
              {allRoles.map(role => (
                <div key={role.id} className="investo-card-pad">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-ink-primary">{role.display_name}</h3>
                          {role.isDefault && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-surface-subtle text-ink-secondary rounded-full">
                              <Lock className="h-3 w-3" /> System
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-ink-muted">{role.role_name}</p>
                      </div>
                    </div>
                    {!role.isDefault && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditingRole(role); setShowRoleModal(true); }}
                          className="p-2 hover:bg-surface-subtle rounded-lg text-ink-secondary"
                          title={t('common.edit')}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => deleteRole(role.id)}
                          className="p-2 hover:bg-red-50 rounded-lg text-red-500"
                          title={t('common.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  {role.permissions && Object.keys(role.permissions).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {Object.entries(role.permissions).map(([resource, actions]) => (
                        <span
                          key={resource}
                          className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-brand-50 text-brand-800 rounded-full"
                        >
                          {resource}: {(actions as string[]).join(', ')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {showRoleModal && (
            <RoleModal
              role={editingRole}
              onClose={() => setShowRoleModal(false)}
              onSaved={() => { setShowRoleModal(false); loadRoles(); }}
            />
          )}
        </div>
      )}

      {/* Tab: Feature Toggles */}
      {activeTab === 'features' && (
        <div>
          {featuresLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-ink-faint" /></div>
          ) : features.length === 0 ? (
            <div className="investo-card-pad text-center text-ink-muted">
              {t('common.no_data')}
            </div>
          ) : (
            <div className="grid gap-4">
              {features.map(feature => (
                <div key={feature.key} className="investo-card-pad flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-ink-primary">{feature.name}</h3>
                    <p className="text-sm text-ink-muted mt-0.5">{feature.description}</p>
                  </div>
                  <button
                    onClick={() => toggleFeature(feature.key, !feature.enabled)}
                    disabled={togglingKey === feature.key}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      feature.enabled ? 'bg-brand-600' : 'bg-surface-border-strong'
                    } ${togglingKey === feature.key ? 'opacity-50' : ''}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-surface-elevated transition-transform ${
                        feature.enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {Dialog}
    </div>
  );
};

export default SettingsPage;
