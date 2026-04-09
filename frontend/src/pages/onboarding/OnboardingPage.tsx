import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api, { ApiResponse } from '../../services/api';
import { setOnboardingCompletionCache } from '../../utils/onboardingCompletionCache';
import {
  Building2, Shield, ToggleLeft, Bot, Users, CheckCircle2,
  Plus, Trash2, Loader2, ChevronLeft, ChevronRight, Check,
} from 'lucide-react';

// ── Types ──────────────────────────────────────

interface OnboardingStatus {
  currentStep: number;
  completedSteps: number[];
  companyData: {
    name?: string;
    description?: string;
    whatsapp_phone?: string;
    primary_color?: string;
  };
}

interface RoleConfig {
  role_name: string;
  display_name: string;
  permissions: Record<string, string[]>;
  enabled: boolean;
  isCustom?: boolean;
}

interface FeatureConfig {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

interface AIConfig {
  business_name: string;
  business_description: string;
  operating_locations: string[];
  budget_range_min: number;
  budget_range_max: number;
  response_tone: string;
  persuasion_level: number;
  default_language: string;
  working_hours_start: string;
  working_hours_end: string;
  greeting_template: string;
}

type ApiLikeError = {
  response?: {
    data?: {
      error?: string;
      message?: string;
    };
  };
};

interface Invite {
  name: string;
  email: string;
  role: string;
  password: string;
}

// ── Constants ──────────────────────────────────

const STEP_LABELS = ['Setup', 'Roles', 'Features', 'AI Config', 'Team', 'Complete'];

const STEP_ICONS = [Building2, Shield, ToggleLeft, Bot, Users, CheckCircle2];

const PERMISSION_RESOURCES = {
  leads: 'leads',
  properties: 'properties',
  visits: 'visits',
  analytics: 'analytics',
  settings: 'platform_settings',
} as const;

const RESOURCES = Object.keys(PERMISSION_RESOURCES) as Array<keyof typeof PERMISSION_RESOURCES>;
const SUPPORTED_PERMISSION_RESOURCES = new Set<string>(Object.values(PERMISSION_RESOURCES));
const ACTIONS = ['read', 'create', 'update', 'delete'] as const;
const ONBOARDING_SYSTEM_CONFIGURABLE_ROLES = new Set(['sales_agent', 'operations', 'viewer']);
const SYSTEM_RESERVED_ROLES = new Set(['super_admin', 'company_admin', 'sales_agent', 'operations', 'viewer']);
const ROLE_SLUG_REGEX = /^[a-z][a-z0-9_]{1,63}$/;

const DEFAULT_ROLES: RoleConfig[] = [
  { role_name: 'company_admin', display_name: 'Company Admin', permissions: {}, enabled: true },
  { role_name: 'sales_agent', display_name: 'Sales Agent', permissions: {}, enabled: true },
  { role_name: 'operations', display_name: 'Operations', permissions: {}, enabled: true },
  { role_name: 'viewer', display_name: 'Viewer', permissions: {}, enabled: false },
];

const DEFAULT_FEATURES: FeatureConfig[] = [
  { key: 'ai_bot', label: 'AI Bot', description: 'Automated customer engagement', enabled: true },
  { key: 'lead_automation', label: 'Lead Automation', description: 'Track and manage lead lifecycle', enabled: true },
  { key: 'visit_scheduling', label: 'Visit Scheduling', description: 'Schedule & manage property visits', enabled: true },
  { key: 'notifications', label: 'Notifications', description: 'Notify teams about critical events', enabled: true },
  { key: 'agent_management', label: 'Agent Management', description: 'Manage team members and assignments', enabled: true },
  { key: 'conversation_center', label: 'Conversation Center', description: 'Handle customer chats and handoffs', enabled: true },
  { key: 'property_management', label: 'Property Management', description: 'Manage inventory and listing details', enabled: true },
  { key: 'analytics', label: 'Analytics Dashboard', description: 'Business insights & reports', enabled: true },
  { key: 'audit_logs', label: 'Audit Logging', description: 'Track all user actions', enabled: false },
  { key: 'csv_export', label: 'CSV Export', description: 'Export operational data as CSV', enabled: false },
];

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'kn', label: 'Kannada' },
  { value: 'te', label: 'Telugu' },
  { value: 'ta', label: 'Tamil' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'mr', label: 'Marathi' },
  { value: 'bn', label: 'Bengali' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'or', label: 'Odia' },
];

const TONES = [
  { value: 'formal', label: 'Formal' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'casual', label: 'Casual' },
];

const DEFAULT_GREETING =
  'Hello! Welcome to {business_name}. How can I help you find your dream property today?';

export function getApiErrorMessage(err: unknown, fallback: string): string {
  const maybeErr = err as ApiLikeError;
  return maybeErr?.response?.data?.error || maybeErr?.response?.data?.message || fallback;
}

export function buildOnboardingAiPayload(aiConfig: AIConfig, locationsInput: string) {
  return {
    business_name: aiConfig.business_name,
    business_description: aiConfig.business_description,
    operating_locations: locationsInput
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    budget_ranges: {
      min: aiConfig.budget_range_min,
      max: aiConfig.budget_range_max,
    },
    response_tone: aiConfig.response_tone,
    persuasion_level: aiConfig.persuasion_level,
    working_hours: {
      start: aiConfig.working_hours_start,
      end: aiConfig.working_hours_end,
    },
    greeting_template: aiConfig.greeting_template,
    default_language: aiConfig.default_language,
  };
}

export function buildSafeOnboardingRolesPayload(roles: RoleConfig[]) {
  const payload: Array<string | { role_name: string; display_name: string; permissions: Record<string, string[]> }> = [];

  for (const role of roles) {
    if (!role.enabled) {
      continue;
    }

    const roleName = role.role_name.trim().toLowerCase();
    if (!roleName) {
      continue;
    }

    if (!role.isCustom) {
      if (ONBOARDING_SYSTEM_CONFIGURABLE_ROLES.has(roleName)) {
        payload.push(roleName);
      }
      continue;
    }

    if (!ROLE_SLUG_REGEX.test(roleName) || SYSTEM_RESERVED_ROLES.has(roleName)) {
      continue;
    }

    const sanitizedPermissions: Record<string, string[]> = {};
    for (const [resource, actions] of Object.entries(role.permissions || {})) {
      const normalizedResource = (PERMISSION_RESOURCES as Record<string, string>)[resource] || resource;
      if (!SUPPORTED_PERMISSION_RESOURCES.has(normalizedResource)) {
        continue;
      }
      if (!Array.isArray(actions)) {
        continue;
      }
      const uniqueActions = Array.from(new Set(actions.filter((action) => ACTIONS.includes(action as any))));
      if (uniqueActions.length > 0) {
        sanitizedPermissions[normalizedResource] = uniqueActions;
      }
    }

    payload.push({
      role_name: roleName,
      display_name: role.display_name?.trim() || roleName,
      permissions: sanitizedPermissions,
    });
  }

  return payload;
}

// ── Component ──────────────────────────────────

const OnboardingPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1
  const [companyName, setCompanyName] = useState('');
  const [companyDesc, setCompanyDesc] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#3B82F6');

  // Step 2
  const [roles, setRoles] = useState<RoleConfig[]>(DEFAULT_ROLES);

  // Step 3
  const [features, setFeatures] = useState<FeatureConfig[]>(DEFAULT_FEATURES);

  // Step 4
  const [aiConfig, setAiConfig] = useState<AIConfig>({
    business_name: '',
    business_description: '',
    operating_locations: [],
    budget_range_min: 500000,
    budget_range_max: 50000000,
    response_tone: 'friendly',
    persuasion_level: 5,
    default_language: 'en',
    working_hours_start: '09:00',
    working_hours_end: '18:00',
    greeting_template: DEFAULT_GREETING,
  });
  const [locationsInput, setLocationsInput] = useState('');

  // Step 5
  const [invites, setInvites] = useState<Invite[]>([{ name: '', email: '', role: 'sales_agent', password: '' }]);

  // Step 6
  const [completed, setCompleted] = useState(false);

  // ── Load onboarding status ────────────────────

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await api.get<ApiResponse<OnboardingStatus>>('/onboarding/status');
      const status = data.data;
      if (status.currentStep) setCurrentStep(status.currentStep);
      if (status.completedSteps) setCompletedSteps(status.completedSteps);
      if (status.companyData) {
        const cd = status.companyData;
        if (cd.name) setCompanyName(cd.name);
        if (cd.description) setCompanyDesc(cd.description);
        if (cd.whatsapp_phone) setWhatsappPhone(cd.whatsapp_phone);
        if (cd.primary_color) setPrimaryColor(cd.primary_color);
      }
    } catch {
      // First time – start fresh
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Pre-fill AI config from step 1 data
  useEffect(() => {
    setAiConfig(prev => ({
      ...prev,
      business_name: prev.business_name || companyName,
      business_description: prev.business_description || companyDesc,
    }));
  }, [companyName, companyDesc]);

  // ── Step handlers ─────────────────────────────

  const markStepComplete = (step: number) => {
    setCompletedSteps(prev => (prev.includes(step) ? prev : [...prev, step]));
  };

  const handleStep1 = async () => {
    if (!companyName.trim()) { setError('Company name is required'); return; }
    setSaving(true);
    setError('');
    try {
      await api.post('/onboarding/setup', {
        name: companyName,
        description: companyDesc,
        whatsapp_phone: whatsappPhone,
        primary_color: primaryColor,
      });
      markStepComplete(1);
      setCurrentStep(2);
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to save company setup'));
    } finally {
      setSaving(false);
    }
  };

  const handleStep2 = async () => {
    setSaving(true);
    setError('');
    try {
      const safeRolesPayload = buildSafeOnboardingRolesPayload(roles);
      if (safeRolesPayload.length === 0) {
        setError('Select at least one valid role before continuing');
        return;
      }
      await api.post('/onboarding/roles', { roles: safeRolesPayload });
      markStepComplete(2);
      setCurrentStep(3);
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to save roles'));
    } finally {
      setSaving(false);
    }
  };

  const handleStep3 = async () => {
    setSaving(true);
    setError('');
    try {
      await api.post('/onboarding/features', {
        features: features.map(f => ({ key: f.key, enabled: f.enabled })),
      });
      markStepComplete(3);
      setCurrentStep(4);
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to save features'));
    } finally {
      setSaving(false);
    }
  };

  const handleStep4 = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = buildOnboardingAiPayload(aiConfig, locationsInput);
      await api.post('/onboarding/ai', payload);
      markStepComplete(4);
      setCurrentStep(5);
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to save AI configuration'));
    } finally {
      setSaving(false);
    }
  };

  const handleStep5 = async () => {
    const validInvites = invites.filter(i => i.name.trim() && i.email.trim());
    const hasWeakPassword = validInvites.some(i => i.password.trim().length < 8);
    if (hasWeakPassword) {
      setError('Each invited user must have a password with at least 8 characters');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (validInvites.length > 0) {
        await api.post('/onboarding/invite', { invites: validInvites });
      }
      markStepComplete(5);
      setCurrentStep(6);
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to send invites'));
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    setError('');
    try {
      await api.post('/onboarding/complete');

      if (user?.company_id) {
        setOnboardingCompletionCache(user.company_id, true);
      }

      setCompleted(true);
      setTimeout(() => navigate('/'), 2000);
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to complete onboarding'));
    } finally {
      setSaving(false);
    }
  };

  const handleNext = () => {
    setError('');
    switch (currentStep) {
      case 1: handleStep1(); break;
      case 2: handleStep2(); break;
      case 3: handleStep3(); break;
      case 4: handleStep4(); break;
      case 5: handleStep5(); break;
      case 6: handleComplete(); break;
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setError('');
      setCurrentStep(currentStep - 1);
    }
  };

  // ── Role helpers ──────────────────────────────

  const addCustomRole = () => {
    setRoles(prev => [
      ...prev,
      { role_name: '', display_name: '', permissions: {}, enabled: true, isCustom: true },
    ]);
  };

  const updateRole = (index: number, field: keyof RoleConfig, value: any) => {
    setRoles(prev => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const removeRole = (index: number) => {
    setRoles(prev => prev.filter((_, i) => i !== index));
  };

  const toggleRolePermission = (roleIndex: number, resource: string, action: string) => {
    setRoles(prev =>
      prev.map((r, i) => {
        if (i !== roleIndex) return r;
        const current = r.permissions[resource] || [];
        const has = current.includes(action);
        return {
          ...r,
          permissions: {
            ...r.permissions,
            [resource]: has ? current.filter(a => a !== action) : [...current, action],
          },
        };
      }),
    );
  };

  // ── Invite helpers ────────────────────────────

  const addInviteRow = () => {
    setInvites(prev => [...prev, { name: '', email: '', role: 'sales_agent', password: '' }]);
  };

  const updateInvite = (index: number, field: keyof Invite, value: string) => {
    setInvites(prev => prev.map((inv, i) => (i === index ? { ...inv, [field]: value } : inv)));
  };

  const removeInvite = (index: number) => {
    setInvites(prev => prev.filter((_, i) => i !== index));
  };

  // ── Render helpers ────────────────────────────

  const enabledRoles = roles.filter(r => r.enabled);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      </div>
    );
  }

  // ── Progress bar ──────────────────────────────

  const ProgressBar = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEP_LABELS.map((label, i) => {
        const step = i + 1;
        const Icon = STEP_ICONS[i];
        const isActive = step === currentStep;
        const isDone = completedSteps.includes(step);
        return (
          <React.Fragment key={step}>
            {i > 0 && (
              <div
                className={`h-0.5 w-8 sm:w-12 ${isDone || isActive ? 'bg-blue-500' : 'bg-gray-200'}`}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : isDone
                      ? 'bg-blue-100 text-blue-600'
                      : 'bg-gray-100 text-gray-400'
                }`}
              >
                {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <span
                className={`text-xs hidden sm:block ${isActive ? 'text-blue-600 font-medium' : 'text-gray-400'}`}
              >
                {label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );

  // ── Step content ──────────────────────────────

  const renderStep1 = () => (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
        <input
          value={companyName}
          onChange={e => setCompanyName(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Your company name"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <textarea
          value={companyDesc}
          onChange={e => setCompanyDesc(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Brief description of your company"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">WhatsApp Phone Number</label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 bg-gray-100 px-3 py-2 rounded-lg">+91</span>
          <input
            value={whatsappPhone}
            onChange={e => setWhatsappPhone(e.target.value)}
            className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="9876543210"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Primary Color</label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={primaryColor}
            onChange={e => setPrimaryColor(e.target.value)}
            className="h-10 w-14 cursor-pointer rounded border p-1"
          />
          <span className="text-sm text-gray-500">{primaryColor}</span>
        </div>
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-4">
      {roles.map((role, idx) => (
        <div key={idx} className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={role.enabled}
                onChange={e => updateRole(idx, 'enabled', e.target.checked)}
                className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
              />
              {role.isCustom ? (
                <div className="flex gap-2">
                  <input
                    value={role.role_name}
                    onChange={e => updateRole(idx, 'role_name', e.target.value.toLowerCase().replace(/\s/g, '_'))}
                    className="px-2 py-1 border rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="role_slug"
                  />
                  <input
                    value={role.display_name}
                    onChange={e => updateRole(idx, 'display_name', e.target.value)}
                    className="px-2 py-1 border rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Display Name"
                  />
                </div>
              ) : (
                <span className="font-medium text-gray-800">{role.display_name}</span>
              )}
            </div>
            {role.isCustom && (
              <button onClick={() => removeRole(idx)} className="p-1 text-red-500 hover:bg-red-50 rounded">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>

          {role.enabled && role.isCustom && (
            <div className="overflow-x-auto">
              <table className="text-sm w-full">
                <thead>
                  <tr>
                    <th className="text-left py-1 pr-4 text-gray-500 font-medium">Resource</th>
                    {ACTIONS.map(a => (
                      <th key={a} className="px-2 py-1 text-gray-500 font-medium capitalize">{a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RESOURCES.map(res => (
                    <tr key={res}>
                      <td className="py-1 pr-4 capitalize text-gray-700">{res}</td>
                      {ACTIONS.map(act => (
                        <td key={act} className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            checked={(role.permissions[res] || []).includes(act)}
                            onChange={() => toggleRolePermission(idx, res, act)}
                            className="h-3.5 w-3.5 rounded text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
      <button
        onClick={addCustomRole}
        className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
      >
        <Plus className="h-4 w-4" /> Add Custom Role
      </button>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-3">
      {features.map((feat, idx) => (
        <div key={feat.key} className="flex items-center justify-between border rounded-lg p-4">
          <div>
            <p className="font-medium text-gray-800">{feat.label}</p>
            <p className="text-sm text-gray-500">{feat.description}</p>
          </div>
          <button
            type="button"
            onClick={() =>
              setFeatures(prev =>
                prev.map((f, i) => (i === idx ? { ...f, enabled: !f.enabled } : f)),
              )
            }
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
              feat.enabled ? 'bg-blue-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
                feat.enabled ? 'translate-x-5 ml-0.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      ))}
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
          <input
            value={aiConfig.business_name}
            onChange={e => setAiConfig(p => ({ ...p, business_name: e.target.value }))}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Response Tone</label>
          <select
            value={aiConfig.response_tone}
            onChange={e => setAiConfig(p => ({ ...p, response_tone: e.target.value }))}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {TONES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Business Description</label>
        <textarea
          value={aiConfig.business_description}
          onChange={e => setAiConfig(p => ({ ...p, business_description: e.target.value }))}
          rows={2}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Operating Locations (comma-separated)</label>
        <input
          value={locationsInput}
          onChange={e => setLocationsInput(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Mumbai, Pune, Bangalore"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Min Budget (₹)</label>
          <input
            type="number"
            value={aiConfig.budget_range_min}
            onChange={e => setAiConfig(p => ({ ...p, budget_range_min: Number(e.target.value) }))}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Max Budget (₹)</label>
          <input
            type="number"
            value={aiConfig.budget_range_max}
            onChange={e => setAiConfig(p => ({ ...p, budget_range_max: Number(e.target.value) }))}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Persuasion Level: {aiConfig.persuasion_level}
        </label>
        <input
          type="range"
          min={1}
          max={10}
          value={aiConfig.persuasion_level}
          onChange={e => setAiConfig(p => ({ ...p, persuasion_level: Number(e.target.value) }))}
          className="w-full accent-blue-600"
        />
        <div className="flex justify-between text-xs text-gray-400">
          <span>Subtle</span>
          <span>Aggressive</span>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Default Language</label>
          <select
            value={aiConfig.default_language}
            onChange={e => setAiConfig(p => ({ ...p, default_language: e.target.value }))}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {LANGUAGES.map(l => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Working Hours Start</label>
          <input
            type="time"
            value={aiConfig.working_hours_start}
            onChange={e => setAiConfig(p => ({ ...p, working_hours_start: e.target.value }))}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Working Hours End</label>
          <input
            type="time"
            value={aiConfig.working_hours_end}
            onChange={e => setAiConfig(p => ({ ...p, working_hours_end: e.target.value }))}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Greeting Template</label>
        <textarea
          value={aiConfig.greeting_template}
          onChange={e => setAiConfig(p => ({ ...p, greeting_template: e.target.value }))}
          rows={3}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder={DEFAULT_GREETING}
        />
      </div>
    </div>
  );

  const renderStep5 = () => (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Set a temporary password for each invited team member. They will be prompted to change it on first login.
      </p>
      {invites.map((inv, idx) => (
        <div key={idx} className="flex items-start gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 flex-1">
            <input
              value={inv.name}
              onChange={e => updateInvite(idx, 'name', e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Name"
            />
            <input
              type="email"
              value={inv.email}
              onChange={e => updateInvite(idx, 'email', e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="email@example.com"
            />
            <select
              value={inv.role}
              onChange={e => updateInvite(idx, 'role', e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {enabledRoles.map(r => (
                <option key={r.role_name} value={r.role_name}>{r.display_name}</option>
              ))}
            </select>
            <input
              type="password"
              value={inv.password}
              onChange={e => updateInvite(idx, 'password', e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Temporary password"
              minLength={8}
            />
          </div>
          {invites.length > 1 && (
            <button onClick={() => removeInvite(idx)} className="p-2 text-red-500 hover:bg-red-50 rounded mt-0.5">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      <button
        onClick={addInviteRow}
        className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
      >
        <Plus className="h-4 w-4" /> Add Another
      </button>
    </div>
  );

  const renderStep6 = () => {
    if (completed) {
      return (
        <div className="flex flex-col items-center justify-center py-12 animate-fade-in">
          <div className="h-20 w-20 rounded-full bg-green-100 flex items-center justify-center mb-4">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
          </div>
          <h3 className="text-xl font-semibold text-gray-800">Setup Complete!</h3>
          <p className="text-gray-500 mt-2">Redirecting to dashboard…</p>
        </div>
      );
    }

    const validInvites = invites.filter(i => i.name.trim() && i.email.trim());

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-800">Review Your Setup</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="border rounded-lg p-4">
            <p className="text-sm text-gray-500">Company</p>
            <p className="font-medium text-gray-800">{companyName || '—'}</p>
          </div>
          <div className="border rounded-lg p-4">
            <p className="text-sm text-gray-500">Roles Configured</p>
            <p className="font-medium text-gray-800">{enabledRoles.length}</p>
          </div>
          <div className="border rounded-lg p-4">
            <p className="text-sm text-gray-500">Features Enabled</p>
            <p className="font-medium text-gray-800">{features.filter(f => f.enabled).length}</p>
          </div>
          <div className="border rounded-lg p-4">
            <p className="text-sm text-gray-500">AI Configured</p>
            <p className="font-medium text-gray-800">{completedSteps.includes(4) ? 'Yes' : 'No'}</p>
          </div>
          <div className="border rounded-lg p-4 sm:col-span-2">
            <p className="text-sm text-gray-500">Team Members Invited</p>
            <p className="font-medium text-gray-800">{validInvites.length}</p>
          </div>
        </div>
      </div>
    );
  };

  const stepContent: Record<number, { title: string; render: () => React.ReactNode }> = {
    1: { title: 'Company Setup', render: renderStep1 },
    2: { title: 'Configure Roles', render: renderStep2 },
    3: { title: 'Feature Toggles', render: renderStep3 },
    4: { title: 'AI Configuration', render: renderStep4 },
    5: { title: 'Invite Team', render: renderStep5 },
    6: { title: 'Complete Setup', render: renderStep6 },
  };

  const current = stepContent[currentStep];

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <ProgressBar />

        <div className="bg-white rounded-xl shadow-sm p-6 sm:p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-6">{t(current.title)}</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
          )}

          {current.render()}
        </div>

        {!completed && (
          <div className="flex justify-between mt-6">
            <button
              onClick={handleBack}
              disabled={currentStep === 1}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-gray-700 bg-white border hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
            <button
              onClick={handleNext}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {currentStep === 6 ? 'Complete Setup' : 'Next'}
              {currentStep < 6 && <ChevronRight className="h-4 w-4" />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default OnboardingPage;
