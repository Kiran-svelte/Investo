import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import {
  Settings, Building2, Shield, ToggleLeft, Save, Plus, Pencil, Trash2,
  X, Loader2, Lock
} from 'lucide-react';

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

const TABS = ['company', 'roles', 'features'] as const;
type Tab = (typeof TABS)[number];

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{role ? t('settings.editRole') : t('settings.createRole')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.roleName')}</label>
              <input
                name="role_name"
                value={form.role_name}
                onChange={e => setForm(p => ({ ...p, role_name: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g. team_lead"
                disabled={!!role}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.displayName')}</label>
              <input
                name="display_name"
                value={form.display_name}
                onChange={e => setForm(p => ({ ...p, display_name: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g. Team Lead"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('settings.permissions')}</label>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-600">{t('settings.resource')}</th>
                    {ACTIONS.map(a => (
                      <th key={a} className="px-3 py-2 font-medium text-gray-600 text-center capitalize">{a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RESOURCES.map(resource => (
                    <tr key={resource} className="border-t">
                      <td className="px-3 py-2 capitalize font-medium text-gray-700">{resource}</td>
                      {ACTIONS.map(action => (
                        <td key={action} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={(permissions[resource] || []).includes(action)}
                            onChange={() => togglePermission(resource, action)}
                            className="h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
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
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
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
  useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('company');

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

  // ── Load data ──

  const loadCompany = useCallback(async () => {
    try {
      const res = await api.get('/onboarding/setup');
      const d = res.data.data;
      setCompany({
        name: d.name || '',
        description: d.description || '',
        whatsapp_phone: d.whatsapp_phone || '',
        primary_color: d.primary_color || '#3B82F6',
      });
    } catch {
      // May not exist yet
    }
  }, []);

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    try {
      const res = await api.get('/roles');
      setRoles(res.data.data);
    } catch (err) {
      console.error('Failed to load roles', err);
    } finally {
      setRolesLoading(false);
    }
  }, []);

  const loadFeatures = useCallback(async () => {
    setFeaturesLoading(true);
    try {
      const res = await api.get('/features');
      setFeatures(res.data.data);
    } catch (err) {
      console.error('Failed to load features', err);
    } finally {
      setFeaturesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'company') loadCompany();
    else if (activeTab === 'roles') loadRoles();
    else if (activeTab === 'features') loadFeatures();
  }, [activeTab, loadCompany, loadRoles, loadFeatures]);

  // ── Company handlers ──

  const handleCompanyChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setCompany(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const saveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setCompanySaving(true);
    setCompanyMsg('');
    try {
      await api.put('/onboarding/setup', company);
      setCompanyMsg('Settings saved successfully');
    } catch (err: any) {
      setCompanyMsg(err.response?.data?.message || 'Failed to save');
    } finally {
      setCompanySaving(false);
    }
  };

  // ── Role handlers ──

  const deleteRole = async (id: string) => {
    if (!window.confirm('Delete this role?')) return;
    try {
      await api.delete(`/roles/${id}`);
      loadRoles();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to delete role');
    }
  };

  // ── Feature handler ──

  const toggleFeature = async (key: string, enabled: boolean) => {
    setTogglingKey(key);
    try {
      await api.put(`/features/${key}`, { enabled });
      setFeatures(prev => prev.map(f => f.key === key ? { ...f, enabled } : f));
    } catch (err) {
      console.error('Failed to toggle feature', err);
    } finally {
      setTogglingKey(null);
    }
  };

  // ── Render helpers ──

  const allRoles = [...roles.systemRoles, ...roles.customRoles];

  const tabConfig = [
    { key: 'company' as Tab, label: t('settings.companyProfile'), icon: Building2 },
    { key: 'roles' as Tab, label: t('settings.rolesManagement'), icon: Shield },
    { key: 'features' as Tab, label: t('settings.featureToggles'), icon: ToggleLeft },
  ];

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Settings className="h-7 w-7 text-gray-700" />
        <h1 className="text-2xl font-bold text-gray-900">{t('nav.settings')}</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {tabConfig.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
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
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <form onSubmit={saveCompany} className="space-y-4 max-w-xl">
            {companyMsg && (
              <div className={`p-3 rounded-lg text-sm ${companyMsg.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {companyMsg}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.companyName')}</label>
              <input
                name="name"
                value={company.name}
                onChange={handleCompanyChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t('settings.companyNamePlaceholder')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.description')}</label>
              <textarea
                name="description"
                value={company.description}
                onChange={handleCompanyChange}
                rows={3}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={t('settings.descriptionPlaceholder')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.whatsappPhone')}</label>
              <input
                name="whatsapp_phone"
                value={company.whatsapp_phone}
                onChange={handleCompanyChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="+91XXXXXXXXXX"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.primaryColor')}</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  name="primary_color"
                  value={company.primary_color}
                  onChange={handleCompanyChange}
                  className="h-10 w-14 rounded border cursor-pointer"
                />
                <span className="text-sm text-gray-500">{company.primary_color}</span>
              </div>
            </div>
            <div className="pt-2">
              <button
                type="submit"
                disabled={companySaving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {companySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t('common.save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tab: Roles Management */}
      {activeTab === 'roles' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => { setEditingRole(null); setShowRoleModal(true); }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
            >
              <Plus className="h-4 w-4" /> {t('settings.createRole')}
            </button>
          </div>

          {rolesLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
          ) : allRoles.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 text-center text-gray-500">
              {t('common.no_data')}
            </div>
          ) : (
            <div className="grid gap-4">
              {allRoles.map(role => (
                <div key={role.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-900">{role.display_name}</h3>
                          {role.isDefault && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-full">
                              <Lock className="h-3 w-3" /> System
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">{role.role_name}</p>
                      </div>
                    </div>
                    {!role.isDefault && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setEditingRole(role); setShowRoleModal(true); }}
                          className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
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
                          className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-blue-50 text-blue-700 rounded-full"
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
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>
          ) : features.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 text-center text-gray-500">
              {t('common.no_data')}
            </div>
          ) : (
            <div className="grid gap-4">
              {features.map(feature => (
                <div key={feature.key} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{feature.name}</h3>
                    <p className="text-sm text-gray-500 mt-0.5">{feature.description}</p>
                  </div>
                  <button
                    onClick={() => toggleFeature(feature.key, !feature.enabled)}
                    disabled={togglingKey === feature.key}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      feature.enabled ? 'bg-blue-600' : 'bg-gray-300'
                    } ${togglingKey === feature.key ? 'opacity-50' : ''}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
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
    </div>
  );
};

export default SettingsPage;
