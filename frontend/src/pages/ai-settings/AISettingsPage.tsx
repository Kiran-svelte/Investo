import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import {
  Save, Loader2, Plus, Trash2, Clock, MessageSquare, Smartphone, AlertCircle, CheckCircle,
  ImagePlus, FileText, Upload,
} from 'lucide-react';
import InfoTooltip from '../../components/common/InfoTooltip';
import PageLoader from '../../components/ui/PageLoader';
import PageHeader from '../../components/ui/PageHeader';
import { PERSUASION_LEVEL_HELP, PROJECT_BUDGET_HELP } from '../../constants/aiFieldHelp';
import {
  canAddGreetingMedia,
  testGreetingMedia,
  uploadGreetingMediaFile,
  type GreetingMediaItem,
} from '../../services/greetingMedia';

// ── Types ──────────────────────────────────────

interface FAQItem {
  question: string;
  answer: string;
}

interface AISettings {
  businessName: string;
  businessDescription: string;
  responseTone: string;
  persuasionLevel: number;
  workingHours: { start: string; end: string };
  faqKnowledge: FAQItem[];
  greetingTemplate: string;
  greetingMedia: GreetingMediaItem[];
  defaultLanguage: string;
  operatingLocations: string[];
  budgetRanges: { min: number; max: number };
}

interface WhatsAppConfig {
  provider: 'meta';
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  businessAccountId: string;
  wabaId: string;
  appId: string;
  appSecret: string;
  systemUserId: string;
  webhookUrl: string;
  isConnected: boolean;
}

const TONES = ['formal', 'friendly', 'casual'] as const;
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

const DEFAULT_SETTINGS: AISettings = {
  businessName: '',
  businessDescription: '',
  responseTone: 'friendly',
  persuasionLevel: 5,
  workingHours: { start: '09:00', end: '18:00' },
  faqKnowledge: [],
  greetingTemplate: '',
  greetingMedia: [],
  defaultLanguage: 'en',
  operatingLocations: [],
  budgetRanges: { min: 0, max: 0 },
};

// ── Component ──────────────────────────────────

const AISettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [settings, setSettings] = useState<AISettings>(DEFAULT_SETTINGS);
  const [whatsappConfig, setWhatsappConfig] = useState<WhatsAppConfig>({
    provider: 'meta',
    phoneNumberId: '',
    accessToken: '',
    verifyToken: '',
    businessAccountId: '',
    wabaId: '',
    appId: '',
    appSecret: '',
    systemUserId: '',
    webhookUrl: '',
    isConnected: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingWhatsApp, setSavingWhatsApp] = useState(false);
  const [testingWhatsApp, setTestingWhatsApp] = useState(false);
  const [message, setMessage] = useState('');
  const [whatsappMessage, setWhatsappMessage] = useState('');
  const [locationsText, setLocationsText] = useState('');
  const [showWhatsAppTokens, setShowWhatsAppTokens] = useState(false);
  // true only after a live /whatsapp/test call succeeds — not just because fields are populated
  const [connectionVerified, setConnectionVerified] = useState(false);
  // true if credentials have been saved at least once (fields are non-empty after loading)
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const [greetingMediaUploading, setGreetingMediaUploading] = useState(false);
  const [testingGreetingMedia, setTestingGreetingMedia] = useState(false);
  const [greetingMediaMessage, setGreetingMediaMessage] = useState('');
  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/ai-settings');
      const d = res.data.data;
      const loaded: AISettings = {
        businessName: d.businessName || '',
        businessDescription: d.businessDescription || '',
        responseTone: d.responseTone || 'friendly',
        persuasionLevel: d.persuasionLevel ?? 5,
        workingHours: d.workingHours || { start: '09:00', end: '18:00' },
        faqKnowledge: d.faqKnowledge || [],
        greetingTemplate: d.greetingTemplate || '',
        greetingMedia: Array.isArray(d.greetingMedia) ? d.greetingMedia : [],
        defaultLanguage: d.defaultLanguage || 'en',
        operatingLocations: d.operatingLocations || [],
        budgetRanges: d.budgetRanges || { min: 0, max: 0 },
      };
      setSettings(loaded);
      setLocationsText((loaded.operatingLocations || []).join(', '));

      // Load WhatsApp config from company settings
      if (user?.role === 'company_admin' || user?.role === 'super_admin') {
        try {
          const companyRes = await api.get(`/companies/${user.company_id}`);
          const companySettings = companyRes.data.data?.settings || {};
          // Generate correct webhook URL - use backend URL from api config or current origin
          const apiBaseUrl = (api.defaults.baseURL || '').replace('/api', '');
          const backendUrl = apiBaseUrl || window.location.origin;
          const metaWebhookUrl = `${backendUrl}/api/webhook`;
          
          if (companySettings.whatsapp) {
            const whatsapp = companySettings.whatsapp;
            const meta = whatsapp.meta || whatsapp;

            const phoneNumberId = meta.phoneNumberId || '';
            const accessToken = meta.accessToken || '';
            const verifyToken = meta.verifyToken || '';
            const businessAccountId = meta.businessAccountId || meta.business_account_id || '';
            const wabaId = meta.wabaId || meta.waba_id || '';
            const appId = meta.appId || meta.app_id || '';
            const appSecret = meta.appSecret || meta.app_secret || '';
            const systemUserId = meta.systemUserId || meta.system_user_id || '';

            const hasCreds = !!accessToken && !!phoneNumberId;
            setCredentialsSaved(hasCreds);
            setConnectionVerified(false);
            setWhatsappConfig({
              provider: 'meta',
              phoneNumberId,
              accessToken,
              verifyToken,
              businessAccountId,
              wabaId,
              appId,
              appSecret,
              systemUserId,
              webhookUrl: metaWebhookUrl,
              isConnected: false,
            });
          } else {
            setWhatsappConfig(prev => ({
              ...prev,
              webhookUrl: metaWebhookUrl,
            }));
          }
        } catch {
          // Company settings might not be accessible
        }
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || 'Could not load AI settings. Check your plan includes AI bot or refresh the page.';
      setMessage(msg);
    } finally {
      setLoading(false);
    }
  }, [user?.company_id, user?.role]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setSettings(prev => ({ ...prev, [name]: value }));
  };

  const handleLocationsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocationsText(e.target.value);
    const locs = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
    setSettings(prev => ({ ...prev, operatingLocations: locs }));
  };

  const handleWorkingHoursChange = (field: 'start' | 'end', value: string) => {
    setSettings(prev => ({
      ...prev,
      workingHours: { ...prev.workingHours, [field]: value },
    }));
  };

  // FAQ handlers
  const addFAQ = () => {
    setSettings(prev => ({
      ...prev,
      faqKnowledge: [...prev.faqKnowledge, { question: '', answer: '' }],
    }));
  };

  const updateFAQ = (index: number, field: 'question' | 'answer', value: string) => {
    setSettings(prev => ({
      ...prev,
      faqKnowledge: prev.faqKnowledge.map((faq, i) =>
        i === index ? { ...faq, [field]: value } : faq
      ),
    }));
  };

  const removeFAQ = (index: number) => {
    setSettings(prev => ({
      ...prev,
      faqKnowledge: prev.faqKnowledge.filter((_, i) => i !== index),
    }));
  };

  // WhatsApp config handler
  const handleWhatsAppChange = (field: keyof WhatsAppConfig, value: string) => {
    setConnectionVerified(false);
    setWhatsappConfig(prev => {
      const next: WhatsAppConfig = { ...prev, [field]: value } as any;
      return { ...next, isConnected: false };
    });
  };

  const handleSaveWhatsApp = async () => {
    if (!user?.company_id) return;

    if (!whatsappConfig.phoneNumberId) {
      setWhatsappMessage('Phone Number ID is required for Meta Cloud API');
      return;
    }
    if (!whatsappConfig.accessToken) {
      setWhatsappMessage('Access Token is required for Meta Cloud API');
      return;
    }
    if (!whatsappConfig.verifyToken) {
      setWhatsappMessage('Webhook Verify Token is required for Meta Cloud API');
      return;
    }

    setSavingWhatsApp(true);
    setWhatsappMessage('');
    try {
      const companyRes = await api.get(`/companies/${user.company_id}`);
      const currentSettings = companyRes.data.data?.settings || {};
      const existingWhatsApp = currentSettings.whatsapp || {};
      const metaSettings = {
        ...(existingWhatsApp.meta || {}),
        phoneNumberId: whatsappConfig.phoneNumberId,
        accessToken: whatsappConfig.accessToken,
        verifyToken: whatsappConfig.verifyToken,
        businessAccountId: whatsappConfig.businessAccountId,
        wabaId: whatsappConfig.wabaId,
        appId: whatsappConfig.appId,
        appSecret: whatsappConfig.appSecret,
        systemUserId: whatsappConfig.systemUserId,
      };

      const newSettings = {
        ...currentSettings,
        whatsapp: {
          ...existingWhatsApp,
          provider: 'meta',
          meta: metaSettings,
          phoneNumberId: metaSettings.phoneNumberId,
          accessToken: metaSettings.accessToken,
          verifyToken: metaSettings.verifyToken,
          businessAccountId: metaSettings.businessAccountId,
          wabaId: metaSettings.wabaId,
          appId: metaSettings.appId,
          appSecret: metaSettings.appSecret,
          systemUserId: metaSettings.systemUserId,
        },
      };

      await api.put(`/companies/${user.company_id}`, { settings: newSettings });
      setCredentialsSaved(!!whatsappConfig.accessToken && !!whatsappConfig.phoneNumberId);
      setConnectionVerified(false);
      setWhatsappMessage((t('ai_settings.whatsapp_saved') || 'WhatsApp configuration saved. Use "Test Connection" to verify it works.'));
    } catch (err: any) {
      setWhatsappMessage(err.response?.data?.message || 'Failed to save WhatsApp configuration');
    } finally {
      setSavingWhatsApp(false);
    }
  };

  const handleTestWhatsApp = async () => {
    if (!whatsappConfig.phoneNumberId || !whatsappConfig.accessToken) {
      setWhatsappMessage(t('ai_settings.whatsapp_missing_fields') || 'Phone Number ID and Access Token are required');
      return;
    }

    setTestingWhatsApp(true);
    setWhatsappMessage('');
    try {
      const response = await api.post('/ai-settings/whatsapp/test', {
        provider: 'meta',
        phone_number_id: whatsappConfig.phoneNumberId,
        access_token: whatsappConfig.accessToken,
      });

      if (response.data.success) {
        setConnectionVerified(true);
        setWhatsappMessage(t('ai_settings.whatsapp_test_success') || 'WhatsApp connection test successful!');
      } else {
        setConnectionVerified(false);
        setWhatsappMessage(response.data.error || 'Connection test failed');
      }
    } catch (err: any) {
      setConnectionVerified(false);
      setWhatsappMessage(err.response?.data?.error || 'Failed to test WhatsApp connection');
    } finally {
      setTestingWhatsApp(false);
    }
  };

  const handleGreetingMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!canAddGreetingMedia(settings.greetingMedia.length)) {
      setGreetingMediaMessage('You can attach up to 2 files (image + brochure).');
      return;
    }

    setGreetingMediaUploading(true);
    setGreetingMediaMessage('');
    try {
      const item = await uploadGreetingMediaFile(file);
      setSettings(prev => ({
        ...prev,
        greetingMedia: [...prev.greetingMedia, item],
      }));
      setGreetingMediaMessage(`${file.name} uploaded — save settings to keep it.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setGreetingMediaMessage(msg);
    } finally {
      setGreetingMediaUploading(false);
    }
  };

  const removeGreetingMedia = (id: string) => {
    setSettings(prev => ({
      ...prev,
      greetingMedia: prev.greetingMedia.filter(item => item.id !== id),
    }));
  };

  const handleTestGreetingMedia = async () => {
    if (!settings.greetingMedia.length) {
      setGreetingMediaMessage('Add an image or brochure first.');
      return;
    }

    setTestingGreetingMedia(true);
    setGreetingMediaMessage('');
    try {
      await api.put('/ai-settings', {
        greeting_template: settings.greetingTemplate,
        greeting_media: settings.greetingMedia,
      });
      const result = await testGreetingMedia(settings.greetingMedia);
      if (result.success) {
        setGreetingMediaMessage('All greeting media URLs are reachable.');
      } else {
        const failed = result.items.filter(item => !item.ok);
        setGreetingMediaMessage(
          failed.length
            ? `Could not reach ${failed.length} file(s). Check storage URLs are public HTTPS.`
            : 'Some media URLs failed the reachability check.',
        );
      }
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setGreetingMediaMessage(msg || 'Failed to test greeting media');
    } finally {
      setTestingGreetingMedia(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const body = {
        business_name: settings.businessName,
        business_description: settings.businessDescription,
        response_tone: settings.responseTone,
        persuasion_level: settings.persuasionLevel,
        working_hours: settings.workingHours,
        faq_knowledge: settings.faqKnowledge,
        greeting_template: settings.greetingTemplate,
        greeting_media: settings.greetingMedia,
        default_language: settings.defaultLanguage,
        operating_locations: settings.operatingLocations,
      };
      await api.put('/ai-settings', body);
      setMessage('AI settings saved successfully');
    } catch (err: any) {
      setMessage(err.response?.data?.message || 'Failed to save AI settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageLoader loading={loading} skeleton="card" count={4}>
    <div className="investo-page space-y-6">
      <PageHeader
        title={t('nav.ai_settings')}
        description={t('ai_settings.title', { defaultValue: 'Configure AI and WhatsApp for your agency' })}
      />

      <form onSubmit={handleSave} className="space-y-6 max-w-3xl">
        {message && (
          <div className={`p-3 rounded-lg text-sm ${message.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {message}
          </div>
        )}

        {/* Business Info */}
        <div className="investo-card-pad space-y-4">
          <h2 className="text-lg font-semibold text-ink-primary">{t('ai_settings.business_info')}</h2>
          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-1">{t('ai_settings.business_name')}</label>
            <input
              name="businessName"
              value={settings.businessName}
              onChange={handleChange}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-1">{t('ai_settings.business_description')}</label>
            <textarea
              name="businessDescription"
              value={settings.businessDescription}
              onChange={handleChange}
              rows={3}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-secondary mb-1">{t('ai_settings.operating_locations')}</label>
            <input
              value={locationsText}
              onChange={handleLocationsChange}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
          <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-900">
            <span className="font-medium inline-flex items-center gap-1">
              Project budget
              <InfoTooltip label="Why per-project budget?" content={PROJECT_BUDGET_HELP} />
            </span>
            <p className="mt-1">Set Price min and Price max on each property or import — not here.</p>
          </div>
        </div>

        {/* AI Behavior */}
        <div className="investo-card-pad space-y-4">
          <h2 className="text-lg font-semibold text-ink-primary flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> {t('ai_settings.title')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">{t('ai_settings.response_tone')}</label>
              <select
                name="responseTone"
                value={settings.responseTone}
                onChange={handleChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              >
                {TONES.map(tone => (
                  <option key={tone} value={tone} className="capitalize">{tone.charAt(0).toUpperCase() + tone.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">{t('ai_settings.default_language')}</label>
              <select
                name="defaultLanguage"
                value={settings.defaultLanguage}
                onChange={handleChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              >
                {LANGUAGES.map(lang => (
                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-ink-secondary mb-1">
              <span>
                {t('ai_settings.persuasion_level')}: <span className="text-brand-700 font-semibold">{settings.persuasionLevel}</span>
              </span>
              <InfoTooltip label="What is persuasion level?" content={PERSUASION_LEVEL_HELP} />
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={settings.persuasionLevel}
              onChange={e => setSettings(prev => ({ ...prev, persuasionLevel: Number(e.target.value) }))}
              className="w-full h-2 bg-surface-subtle rounded-lg appearance-none cursor-pointer accent-brand-600"
            />
          </div>
        </div>

        {/* Working Hours */}
        <div className="investo-card-pad space-y-4">
          <h2 className="text-lg font-semibold text-ink-primary flex items-center gap-2">
            <Clock className="h-5 w-5" /> {t('ai_settings.working_hours')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">{t('ai_settings.start_time')}</label>
              <input
                type="time"
                value={settings.workingHours.start}
                onChange={e => handleWorkingHoursChange('start', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-secondary mb-1">{t('ai_settings.end_time')}</label>
              <input
                type="time"
                value={settings.workingHours.end}
                onChange={e => handleWorkingHoursChange('end', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Greeting Template */}
        <div className="investo-card-pad space-y-4">
          <h2 className="text-lg font-semibold text-ink-primary">{t('ai_settings.greeting_template')}</h2>
          <p className="text-sm text-ink-muted">
            Sent on a buyer&apos;s first &quot;Hi&quot; on WhatsApp. Use {'{business_name}'} in the text.
            Optional hero image and brochure PDF are sent with the greeting (max 2 files).
          </p>
          <textarea
            name="greetingTemplate"
            value={settings.greetingTemplate}
            onChange={handleChange}
            rows={3}
            placeholder="Hello! Welcome to {business_name}. How can I help you find your dream property today?"
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
          />

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 px-3 py-2 bg-brand-50 text-brand-800 rounded-lg text-sm font-medium cursor-pointer hover:bg-brand-100">
                {greetingMediaUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Add image or brochure
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  disabled={greetingMediaUploading || !canAddGreetingMedia(settings.greetingMedia.length)}
                  onChange={handleGreetingMediaUpload}
                />
              </label>
              <button
                type="button"
                onClick={handleTestGreetingMedia}
                disabled={testingGreetingMedia || settings.greetingMedia.length === 0}
                className="px-3 py-2 border border-surface-border rounded-lg text-sm font-medium hover:bg-surface-subtle disabled:opacity-50"
              >
                {testingGreetingMedia ? 'Testing…' : 'Test media URLs'}
              </button>
            </div>

            {greetingMediaMessage && (
              <div className={`p-3 rounded-lg text-sm ${greetingMediaMessage.includes('reachable') || greetingMediaMessage.includes('uploaded') ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'}`}>
                {greetingMediaMessage}
              </div>
            )}

            {settings.greetingMedia.length === 0 ? (
              <p className="text-sm text-ink-muted">No greeting media yet — text-only welcome.</p>
            ) : (
              <ul className="space-y-2">
                {settings.greetingMedia.map(item => (
                  <li key={item.id} className="flex items-center gap-3 border rounded-lg p-3">
                    {item.kind === 'image' ? (
                      <img src={item.url} alt="" className="h-14 w-14 rounded object-cover border" />
                    ) : (
                      <div className="h-14 w-14 rounded border bg-surface-subtle flex items-center justify-center">
                        <FileText className="h-6 w-6 text-ink-muted" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink-primary truncate flex items-center gap-1">
                        {item.kind === 'image' ? <ImagePlus className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                        {item.fileName || (item.kind === 'image' ? 'Hero image' : 'Brochure PDF')}
                      </p>
                      <p className="text-xs text-ink-muted truncate">{item.url}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeGreetingMedia(item.id)}
                      className="p-1.5 hover:bg-red-50 rounded text-red-400 hover:text-red-600"
                      aria-label="Remove greeting media"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* FAQ Knowledge */}
        <div className="investo-card-pad space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink-primary">{t('ai_settings.faq_knowledge')}</h2>
            <button
              type="button"
              onClick={addFAQ}
              className="px-3 py-1.5 bg-brand-50 text-brand-700 rounded-lg hover:bg-brand-100 flex items-center gap-1 text-sm font-medium"
            >
              <Plus className="h-4 w-4" /> {t('ai_settings.add_faq')}
            </button>
          </div>
          {settings.faqKnowledge.length === 0 && (
            <p className="text-sm text-ink-muted">{t('common.no_data')}</p>
          )}
          {settings.faqKnowledge.map((faq, index) => (
            <div key={index} className="border rounded-lg p-3 space-y-2 relative">
              <button
                type="button"
                onClick={() => removeFAQ(index)}
                className="absolute top-2 right-2 p-1 hover:bg-red-50 rounded text-red-400 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">{t('ai_settings.question')}</label>
                <input
                  value={faq.question}
                  onChange={e => updateFAQ(index, 'question', e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-muted mb-1">{t('ai_settings.answer')}</label>
                <textarea
                  value={faq.answer}
                  onChange={e => updateFAQ(index, 'answer', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent text-sm"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Save AI Settings */}
        <div>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 investo-btn-primary disabled:opacity-50 flex items-center gap-2 font-medium"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t('common.save')} {t('nav.ai_settings')}
          </button>
        </div>
      </form>

      {/* WhatsApp Integration - Separate Section (only for company_admin or super_admin) */}
      {(user?.role === 'company_admin' || user?.role === 'super_admin') && (
        <div className="max-w-3xl space-y-6 mt-8">
          <hr className="border-surface-border" />
          <div className="investo-card-pad space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink-primary flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-green-600" />
                {t('ai_settings.whatsapp_integration') || 'WhatsApp Business Integration'}
              </h2>
              <div className="flex items-center gap-2">
                {connectionVerified ? (
                  <span className="flex items-center gap-1.5 text-sm text-green-600 bg-green-50 px-2.5 py-1 rounded-full">
                    <CheckCircle className="h-4 w-4" />
                    {t('ai_settings.connected') || 'Connected'}
                  </span>
                ) : credentialsSaved ? (
                  <span className="flex items-center gap-1.5 text-sm text-brand-700 bg-brand-50 px-2.5 py-1 rounded-full">
                    <AlertCircle className="h-4 w-4" />
                    Saved — not verified
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-sm text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full">
                    <AlertCircle className="h-4 w-4" />
                    {t('ai_settings.not_configured') || 'Not Configured'}
                  </span>
                )}
              </div>
            </div>

            {whatsappMessage && (
              <div className={`p-3 rounded-lg text-sm ${whatsappMessage.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {whatsappMessage}
              </div>
            )}

            <div className="space-y-4">
              <div className="bg-brand-50 border border-brand-100 rounded-lg p-4 text-sm text-brand-800">
                <h4 className="font-medium mb-2">{t('ai_settings.whatsapp_setup_guide') || 'Meta Cloud API setup'}</h4>
                <ol className="list-decimal list-inside space-y-1 text-brand-800">
                  <li>{t('ai_settings.whatsapp_step1') || 'Go to Meta Business Suite and create a WhatsApp Business Account'}</li>
                  <li>{t('ai_settings.whatsapp_step2') || 'Create a WhatsApp Business app and get your Phone Number ID'}</li>
                  <li>{t('ai_settings.whatsapp_step3') || 'Generate a permanent access token from Meta developer console'}</li>
                  <li>{t('ai_settings.whatsapp_step4') || 'Set up the webhook URL below in your Meta app settings'}</li>
                </ol>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">
                  {t('ai_settings.phone_number_id') || 'Phone Number ID'}
                </label>
                <input
                  type="text"
                  value={whatsappConfig.phoneNumberId}
                  onChange={e => handleWhatsAppChange('phoneNumberId', e.target.value)}
                  placeholder="e.g., 123456789012345"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">
                  {t('ai_settings.access_token') || 'Access Token'}
                  <button
                    type="button"
                    onClick={() => setShowWhatsAppTokens(!showWhatsAppTokens)}
                    className="ml-2 text-xs text-brand-700 hover:underline"
                  >
                    {showWhatsAppTokens ? t('common.hide') || 'Hide' : t('common.show') || 'Show'}
                  </button>
                </label>
                <input
                  type={showWhatsAppTokens ? 'text' : 'password'}
                  value={whatsappConfig.accessToken}
                  onChange={e => handleWhatsAppChange('accessToken', e.target.value)}
                  placeholder="EAAxxxxxx..."
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">
                  {t('ai_settings.verify_token') || 'Webhook Verify Token'}
                </label>
                <input
                  type={showWhatsAppTokens ? 'text' : 'password'}
                  value={whatsappConfig.verifyToken}
                  onChange={e => handleWhatsAppChange('verifyToken', e.target.value)}
                  placeholder={t('ai_settings.verify_token_placeholder') || 'Your custom verification token'}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
                <p className="text-xs text-ink-muted mt-1">
                  {t('ai_settings.verify_token_help') || 'Create a secure random string. You will need to enter this same value in Meta webhook settings.'}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-ink-secondary mb-1">Meta Business Account ID</label>
                  <input
                    type="text"
                    value={whatsappConfig.businessAccountId}
                    onChange={e => handleWhatsAppChange('businessAccountId', e.target.value)}
                    placeholder="e.g., 1029384756"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-secondary mb-1">WABA ID</label>
                  <input
                    type="text"
                    value={whatsappConfig.wabaId}
                    onChange={e => handleWhatsAppChange('wabaId', e.target.value)}
                    placeholder="e.g., 123456789012345"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-secondary mb-1">Meta App ID</label>
                  <input
                    type="text"
                    value={whatsappConfig.appId}
                    onChange={e => handleWhatsAppChange('appId', e.target.value)}
                    placeholder="e.g., 987654321234567"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-secondary mb-1">Meta App Secret</label>
                  <input
                    type={showWhatsAppTokens ? 'text' : 'password'}
                    value={whatsappConfig.appSecret}
                    onChange={e => handleWhatsAppChange('appSecret', e.target.value)}
                    placeholder="Meta app secret"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-secondary mb-1">System User ID</label>
                  <input
                    type="text"
                    value={whatsappConfig.systemUserId}
                    onChange={e => handleWhatsAppChange('systemUserId', e.target.value)}
                    placeholder="e.g., 112233445566778"
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1">
                  {t('ai_settings.webhook_url') || 'Webhook URL'} ({t('common.read_only') || 'Read-only'})
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={whatsappConfig.webhookUrl}
                    readOnly
                    className="flex-1 px-3 py-2 border rounded-lg bg-surface-muted text-ink-secondary font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(whatsappConfig.webhookUrl)}
                    className="px-3 py-2 text-sm bg-surface-subtle hover:bg-surface-subtle rounded-lg"
                  >
                    {t('common.copy') || 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-ink-muted mt-1">
                  {t('ai_settings.webhook_help') || 'Copy this URL and paste it in your Meta app webhook configuration.'}
                </p>
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={handleTestWhatsApp}
                disabled={testingWhatsApp || !whatsappConfig.phoneNumberId || !whatsappConfig.accessToken}
                className="px-6 py-2.5 investo-btn-primary disabled:opacity-50 flex items-center gap-2 font-medium"
              >
                {testingWhatsApp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                {t('ai_settings.test_connection')}
              </button>
              <button
                type="button"
                onClick={handleSaveWhatsApp}
                disabled={savingWhatsApp}
                className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 font-medium"
              >
                {savingWhatsApp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t('ai_settings.save_whatsapp') || 'Save WhatsApp Configuration'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </PageLoader>
  );
};

export default AISettingsPage;
