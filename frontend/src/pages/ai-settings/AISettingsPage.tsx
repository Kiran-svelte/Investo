import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import {
  Bot, Save, Loader2, Plus, Trash2, Clock, MessageSquare, Smartphone, AlertCircle, CheckCircle
} from 'lucide-react';

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
  defaultLanguage: string;
  operatingLocations: string[];
  budgetRanges: { min: number; max: number };
}

interface WhatsAppConfig {
  provider: 'meta' | 'greenapi';
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  idInstance: string;
  apiTokenInstance: string;
  webhookUrlToken: string;
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
    idInstance: '',
    apiTokenInstance: '',
    webhookUrlToken: '',
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
          const greenApiWebhookUrl = `${backendUrl}/api/greenapi/webhook`;
          
          if (companySettings.whatsapp) {
            const whatsapp = companySettings.whatsapp;
            const provider: 'meta' | 'greenapi' = whatsapp.provider === 'greenapi' ? 'greenapi' : 'meta';
            const meta = whatsapp.meta || whatsapp;
            const greenapi = whatsapp.greenapi || whatsapp;

            const phoneNumberId = meta.phoneNumberId || '';
            const accessToken = meta.accessToken || '';
            const verifyToken = meta.verifyToken || '';

            const idInstance = greenapi.idInstance || whatsapp.phoneNumberId || '';
            const apiTokenInstance = greenapi.apiTokenInstance || whatsapp.apiTokenInstance || '';
            const webhookUrlToken = greenapi.webhookUrlToken || whatsapp.webhookUrlToken || '';

            setWhatsappConfig({
              provider,
              phoneNumberId,
              accessToken,
              verifyToken,
              idInstance,
              apiTokenInstance,
              webhookUrlToken,
              webhookUrl: provider === 'greenapi' ? greenApiWebhookUrl : metaWebhookUrl,
              isConnected:
                provider === 'greenapi'
                  ? !!idInstance && !!apiTokenInstance
                  : !!accessToken && !!phoneNumberId,
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
    } catch {
      // Settings may not exist yet
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

  const handleBudgetChange = (field: 'min' | 'max', value: string) => {
    setSettings(prev => ({
      ...prev,
      budgetRanges: { ...prev.budgetRanges, [field]: Number(value) || 0 },
    }));
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
    setWhatsappConfig(prev => {
      const next: WhatsAppConfig = { ...prev, [field]: value } as any;

      if (field === 'provider') {
        const apiBaseUrl = (api.defaults.baseURL || '').replace('/api', '');
        const backendUrl = apiBaseUrl || window.location.origin;
        next.webhookUrl =
          value === 'greenapi' ? `${backendUrl}/api/greenapi/webhook` : `${backendUrl}/api/webhook`;
      }

      const isConnected =
        next.provider === 'greenapi'
          ? !!next.idInstance && !!next.apiTokenInstance
          : !!next.accessToken && !!next.phoneNumberId;

      return { ...next, isConnected };
    });
  };

  const handleSaveWhatsApp = async () => {
    if (!user?.company_id) return;
    
    setSavingWhatsApp(true);
    setWhatsappMessage('');
    try {
      // Get current company settings and merge with WhatsApp config
      const companyRes = await api.get(`/companies/${user.company_id}`);
      const currentSettings = companyRes.data.data?.settings || {};

      const existingWhatsApp = currentSettings.whatsapp || {};
      const provider = whatsappConfig.provider;
      const metaSettings = {
        ...(existingWhatsApp.meta || {}),
        phoneNumberId: whatsappConfig.phoneNumberId,
        accessToken: whatsappConfig.accessToken,
        verifyToken: whatsappConfig.verifyToken,
      };
      const greenApiSettings = {
        ...(existingWhatsApp.greenapi || {}),
        idInstance: whatsappConfig.idInstance,
        apiTokenInstance: whatsappConfig.apiTokenInstance,
        webhookUrlToken: whatsappConfig.webhookUrlToken,
      };
      
      const newSettings = {
        ...currentSettings,
        whatsapp: {
          ...existingWhatsApp,
          provider,
          meta: metaSettings,
          greenapi: greenApiSettings,

          // Legacy top-level mirrors for backward compatibility
          phoneNumberId: provider === 'greenapi' ? greenApiSettings.idInstance : metaSettings.phoneNumberId,
          accessToken: metaSettings.accessToken,
          verifyToken: metaSettings.verifyToken,
          apiTokenInstance: greenApiSettings.apiTokenInstance,
          webhookUrlToken: greenApiSettings.webhookUrlToken,
        },
      };
      
      await api.put(`/companies/${user.company_id}`, { settings: newSettings });
      setWhatsappConfig(prev => ({
        ...prev,
        isConnected:
          prev.provider === 'greenapi'
            ? !!prev.idInstance && !!prev.apiTokenInstance
            : !!prev.accessToken && !!prev.phoneNumberId,
      }));
      setWhatsappMessage(t('ai_settings.whatsapp_saved') || 'WhatsApp configuration saved successfully');
    } catch (err: any) {
      setWhatsappMessage(err.response?.data?.message || 'Failed to save WhatsApp configuration');
    } finally {
      setSavingWhatsApp(false);
    }
  };

  const handleTestWhatsApp = async () => {
    if (whatsappConfig.provider === 'greenapi') {
      if (!whatsappConfig.idInstance || !whatsappConfig.apiTokenInstance) {
        setWhatsappMessage('Instance ID and API Token are required');
        return;
      }
    } else {
      if (!whatsappConfig.phoneNumberId || !whatsappConfig.accessToken) {
        setWhatsappMessage(t('ai_settings.whatsapp_missing_fields') || 'Phone Number ID and Access Token are required');
        return;
      }
    }
    
    setTestingWhatsApp(true);
    setWhatsappMessage('');
    try {
      const response = await api.post(
        '/ai-settings/whatsapp/test',
        whatsappConfig.provider === 'greenapi'
          ? {
              provider: 'greenapi',
              id_instance: whatsappConfig.idInstance,
              api_token_instance: whatsappConfig.apiTokenInstance,
            }
          : {
              provider: 'meta',
              phone_number_id: whatsappConfig.phoneNumberId,
              access_token: whatsappConfig.accessToken,
            },
      );
      
      if (response.data.success) {
        setWhatsappMessage(t('ai_settings.whatsapp_test_success') || '✅ WhatsApp connection test successful!');
        setWhatsappConfig(prev => ({ ...prev, isConnected: true }));
      } else {
        setWhatsappMessage(`❌ ${response.data.error || 'Connection test failed'}`);
      }
    } catch (err: any) {
      setWhatsappMessage(`❌ ${err.response?.data?.error || 'Failed to test WhatsApp connection'}`);
    } finally {
      setTestingWhatsApp(false);
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
        default_language: settings.defaultLanguage,
        operating_locations: settings.operatingLocations,
        budget_ranges: settings.budgetRanges,
      };
      await api.put('/ai-settings', body);
      setMessage('AI settings saved successfully');
    } catch (err: any) {
      setMessage(err.response?.data?.message || 'Failed to save AI settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Bot className="h-7 w-7 text-gray-700" />
        <h1 className="text-2xl font-bold text-gray-900">{t('nav.ai_settings')}</h1>
      </div>

      <form onSubmit={handleSave} className="space-y-6 max-w-3xl">
        {message && (
          <div className={`p-3 rounded-lg text-sm ${message.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            {message}
          </div>
        )}

        {/* Business Info */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('ai_settings.business_info')}</h2>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('ai_settings.business_name')}</label>
            <input
              name="businessName"
              value={settings.businessName}
              onChange={handleChange}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('ai_settings.business_description')}</label>
            <textarea
              name="businessDescription"
              value={settings.businessDescription}
              onChange={handleChange}
              rows={3}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('ai_settings.operating_locations')}</label>
            <input
              value={locationsText}
              onChange={handleLocationsChange}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('ai_settings.budget_min')} (₹)</label>
              <input
                type="number"
                value={settings.budgetRanges.min || ''}
                onChange={e => handleBudgetChange('min', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('ai_settings.budget_max')} (₹)</label>
              <input
                type="number"
                value={settings.budgetRanges.max || ''}
                onChange={e => handleBudgetChange('max', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0"
              />
            </div>
          </div>
        </div>

        {/* AI Behavior */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> {t('ai_settings.title')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('ai_settings.response_tone')}</label>
              <select
                name="responseTone"
                value={settings.responseTone}
                onChange={handleChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {TONES.map(tone => (
                  <option key={tone} value={tone} className="capitalize">{tone.charAt(0).toUpperCase() + tone.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('ai_settings.default_language')}</label>
              <select
                name="defaultLanguage"
                value={settings.defaultLanguage}
                onChange={handleChange}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {LANGUAGES.map(lang => (
                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('ai_settings.persuasion_level')}: <span className="text-blue-600 font-semibold">{settings.persuasionLevel}</span>
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={settings.persuasionLevel}
              onChange={e => setSettings(prev => ({ ...prev, persuasionLevel: Number(e.target.value) }))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
          </div>
        </div>

        {/* Working Hours */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Clock className="h-5 w-5" /> {t('ai_settings.working_hours')}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('ai_settings.start_time')}</label>
              <input
                type="time"
                value={settings.workingHours.start}
                onChange={e => handleWorkingHoursChange('start', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('ai_settings.end_time')}</label>
              <input
                type="time"
                value={settings.workingHours.end}
                onChange={e => handleWorkingHoursChange('end', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Greeting Template */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">{t('ai_settings.greeting_template')}</h2>
          <textarea
            name="greetingTemplate"
            value={settings.greetingTemplate}
            onChange={handleChange}
            rows={3}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* FAQ Knowledge */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">{t('ai_settings.faq_knowledge')}</h2>
            <button
              type="button"
              onClick={addFAQ}
              className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 flex items-center gap-1 text-sm font-medium"
            >
              <Plus className="h-4 w-4" /> {t('ai_settings.add_faq')}
            </button>
          </div>
          {settings.faqKnowledge.length === 0 && (
            <p className="text-sm text-gray-500">{t('common.no_data')}</p>
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
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('ai_settings.question')}</label>
                <input
                  value={faq.question}
                  onChange={e => updateFAQ(index, 'question', e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('ai_settings.answer')}</label>
                <textarea
                  value={faq.answer}
                  onChange={e => updateFAQ(index, 'answer', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
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
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 font-medium"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t('common.save')} {t('nav.ai_settings')}
          </button>
        </div>
      </form>

      {/* WhatsApp Integration - Separate Section (only for company_admin or super_admin) */}
      {(user?.role === 'company_admin' || user?.role === 'super_admin') && (
        <div className="max-w-3xl space-y-6 mt-8">
          <hr className="border-gray-200" />
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-green-600" />
                {t('ai_settings.whatsapp_integration') || 'WhatsApp Business Integration'}
              </h2>
              <div className="flex items-center gap-2">
                {whatsappConfig.isConnected ? (
                  <span className="flex items-center gap-1.5 text-sm text-green-600 bg-green-50 px-2.5 py-1 rounded-full">
                    <CheckCircle className="h-4 w-4" />
                    {t('ai_settings.connected') || 'Connected'}
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('ai_settings.whatsapp_provider') || 'Provider'}
                </label>
                <select
                  value={whatsappConfig.provider}
                  onChange={e => handleWhatsAppChange('provider', e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                >
                  <option value="meta">Meta Cloud API</option>
                  <option value="greenapi">Green-API</option>
                </select>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800">
                <h4 className="font-medium mb-2">{t('ai_settings.whatsapp_setup_guide') || 'Setup Guide:'}</h4>
                {whatsappConfig.provider === 'greenapi' ? (
                  <ol className="list-decimal list-inside space-y-1 text-blue-700">
                    <li>Create a Green-API instance and copy your Instance ID + API Token</li>
                    <li>Set the webhook URL to the value shown below</li>
                    <li>Set the webhook Authorization header to <span className="font-mono">Bearer &lt;token&gt;</span> (use your Webhook Token below)</li>
                  </ol>
                ) : (
                  <ol className="list-decimal list-inside space-y-1 text-blue-700">
                    <li>{t('ai_settings.whatsapp_step1') || 'Go to Meta Business Suite and create a WhatsApp Business Account'}</li>
                    <li>{t('ai_settings.whatsapp_step2') || 'Create a WhatsApp Business app and get your Phone Number ID'}</li>
                    <li>{t('ai_settings.whatsapp_step3') || 'Generate a permanent access token from Meta developer console'}</li>
                    <li>{t('ai_settings.whatsapp_step4') || 'Set up the webhook URL below in your Meta app settings'}</li>
                  </ol>
                )}
              </div>

              {whatsappConfig.provider === 'greenapi' ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Instance ID
                    </label>
                    <input
                      type="text"
                      value={whatsappConfig.idInstance}
                      onChange={e => handleWhatsAppChange('idInstance', e.target.value)}
                      placeholder="e.g., 1100000001"
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      API Token
                      <button 
                        type="button"
                        onClick={() => setShowWhatsAppTokens(!showWhatsAppTokens)}
                        className="ml-2 text-xs text-blue-600 hover:underline"
                      >
                        {showWhatsAppTokens ? t('common.hide') || 'Hide' : t('common.show') || 'Show'}
                      </button>
                    </label>
                    <input
                      type={showWhatsAppTokens ? 'text' : 'password'}
                      value={whatsappConfig.apiTokenInstance}
                      onChange={e => handleWhatsAppChange('apiTokenInstance', e.target.value)}
                      placeholder="token-abc"
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Webhook Token
                      <button 
                        type="button"
                        onClick={() => setShowWhatsAppTokens(!showWhatsAppTokens)}
                        className="ml-2 text-xs text-blue-600 hover:underline"
                      >
                        {showWhatsAppTokens ? t('common.hide') || 'Hide' : t('common.show') || 'Show'}
                      </button>
                    </label>
                    <input
                      type={showWhatsAppTokens ? 'text' : 'password'}
                      value={whatsappConfig.webhookUrlToken}
                      onChange={e => handleWhatsAppChange('webhookUrlToken', e.target.value)}
                      placeholder="your-secret-token"
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Set Green-API webhook Authorization header to <span className="font-mono">Bearer &lt;this token&gt;</span>.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('ai_settings.access_token') || 'Access Token'}
                      <button 
                        type="button"
                        onClick={() => setShowWhatsAppTokens(!showWhatsAppTokens)}
                        className="ml-2 text-xs text-blue-600 hover:underline"
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('ai_settings.verify_token') || 'Webhook Verify Token'}
                    </label>
                    <input
                      type={showWhatsAppTokens ? 'text' : 'password'}
                      value={whatsappConfig.verifyToken}
                      onChange={e => handleWhatsAppChange('verifyToken', e.target.value)}
                      placeholder={t('ai_settings.verify_token_placeholder') || 'Your custom verification token'}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {t('ai_settings.verify_token_help') || 'Create a secure random string. You\'ll need to enter this same value in Meta webhook settings.'}
                    </p>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('ai_settings.webhook_url') || 'Webhook URL'} ({t('common.read_only') || 'Read-only'})
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={whatsappConfig.webhookUrl}
                    readOnly
                    className="flex-1 px-3 py-2 border rounded-lg bg-gray-50 text-gray-600 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(whatsappConfig.webhookUrl)}
                    className="px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
                  >
                    {t('common.copy') || 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {whatsappConfig.provider === 'greenapi'
                    ? 'Copy this URL and paste it in your Green-API webhook configuration.'
                    : t('ai_settings.webhook_help') || 'Copy this URL and paste it in your Meta app webhook configuration.'}
                </p>
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={handleTestWhatsApp}
                disabled={
                  testingWhatsApp ||
                  (whatsappConfig.provider === 'greenapi'
                    ? !whatsappConfig.idInstance || !whatsappConfig.apiTokenInstance
                    : !whatsappConfig.phoneNumberId || !whatsappConfig.accessToken)
                }
                className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 font-medium"
              >
                {testingWhatsApp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                {t('ai_settings.test_connection') || 'Test Connection'}
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
  );
};

export default AISettingsPage;
