import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/prisma';

export interface ConversionPartner {
  id: string;
  name: string;
  contact_phone?: string | null;
  notes?: string | null;
  active: boolean;
}

export interface ConversionWaitlistCopy {
  en: string;
  hi?: string;
  kn?: string;
}

export interface ConversionSettings {
  budget_stretch_percent: number;
  upsell_enabled: boolean;
  waitlist_copy: ConversionWaitlistCopy;
  partners: ConversionPartner[];
  primary_city: string;
  pan_india_cities: string[];
  international_partners_enabled: boolean;
  possession_gap_months: number;
  business_type: 'residential_sale' | 'rental' | 'fractional';
  offer_rent_to_own: boolean;
  rent_to_own_months: number;
  rent_credit_percent: number;
  portal_search_enabled: boolean;
  cross_channel_followup_enabled: boolean;
  competitor_name: string;
  referral_discount_percent: number;
  partner_company_ids: string[];
  offer_fractional: boolean;
  launch_weeks_from_now: number | null;
  special_offers: string[];
}

export type ConversionSettingsPatch = Omit<Partial<ConversionSettings>, 'waitlist_copy'> & {
  waitlist_copy?: Partial<ConversionWaitlistCopy>;
};

const DEFAULT_WAITLIST_COPY: ConversionWaitlistCopy = {
  en: "I'll add you to our priority waitlist and notify you when a matching unit is available.",
  hi: 'मैं आपको प्राथमिकता वेटलिस्ट में जोड़ूंगा और मैच मिलते ही सूचित करूंगा।',
  kn: 'ನಿಮ್ಮನ್ನು ಪ್ರಾಧಾನ್ಯತೆ ವೇಟ್‌ಲಿಸ್ಟ್‌ಗೆ ಸೇರಿಸಿ ಹೊಂದುವ ಯುನಿಟ್ ದೊರೆತಾಗಲೇ ತಿಳಿಸುತ್ತೇನೆ.',
};

export const DEFAULT_CONVERSION_SETTINGS: ConversionSettings = {
  budget_stretch_percent: 15,
  upsell_enabled: true,
  waitlist_copy: DEFAULT_WAITLIST_COPY,
  partners: [],
  primary_city: 'your city',
  pan_india_cities: ['Pune', 'Hyderabad', 'Chennai', 'Mumbai'],
  international_partners_enabled: false,
  possession_gap_months: 6,
  business_type: 'residential_sale',
  offer_rent_to_own: false,
  rent_to_own_months: 12,
  rent_credit_percent: 10,
  portal_search_enabled: true,
  cross_channel_followup_enabled: false,
  competitor_name: 'trusted partner',
  referral_discount_percent: 0,
  partner_company_ids: [],
  offer_fractional: false,
  launch_weeks_from_now: null,
  special_offers: [],
};

function clampPercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CONVERSION_SETTINGS.budget_stretch_percent;
  return Math.min(50, Math.max(5, Math.round(n)));
}

function normalizePartner(raw: unknown): ConversionPartner | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const name = String(p.name || '').trim();
  if (!name) return null;
  return {
    id: String(p.id || uuidv4()),
    name,
    contact_phone: p.contact_phone != null ? String(p.contact_phone) : null,
    notes: p.notes != null ? String(p.notes) : null,
    active: p.active !== false,
  };
}

export function parseConversionSettings(settingsJson: unknown): ConversionSettings {
  const root = (settingsJson && typeof settingsJson === 'object' ? settingsJson : {}) as Record<
    string,
    unknown
  >;
  const raw = (root.conversion && typeof root.conversion === 'object'
    ? root.conversion
    : {}) as Record<string, unknown>;

  const waitlistRaw =
    raw.waitlist_copy && typeof raw.waitlist_copy === 'object'
      ? (raw.waitlist_copy as Record<string, string>)
      : {};

  const partners: ConversionPartner[] = Array.isArray(raw.partners)
    ? raw.partners.map(normalizePartner).filter((p): p is ConversionPartner => p !== null)
    : [];

  return {
    budget_stretch_percent: clampPercent(raw.budget_stretch_percent),
    upsell_enabled: raw.upsell_enabled !== false,
    waitlist_copy: {
      en: waitlistRaw.en || DEFAULT_WAITLIST_COPY.en,
      hi: waitlistRaw.hi || DEFAULT_WAITLIST_COPY.hi,
      kn: waitlistRaw.kn || DEFAULT_WAITLIST_COPY.kn,
    },
    partners,
    primary_city: String(raw.primary_city || DEFAULT_CONVERSION_SETTINGS.primary_city),
    pan_india_cities: Array.isArray(raw.pan_india_cities)
      ? raw.pan_india_cities.map(String).filter(Boolean)
      : DEFAULT_CONVERSION_SETTINGS.pan_india_cities,
    international_partners_enabled: raw.international_partners_enabled === true,
    possession_gap_months: Number(raw.possession_gap_months || DEFAULT_CONVERSION_SETTINGS.possession_gap_months),
    business_type: ['residential_sale', 'rental', 'fractional'].includes(String(raw.business_type))
      ? raw.business_type as ConversionSettings['business_type']
      : DEFAULT_CONVERSION_SETTINGS.business_type,
    offer_rent_to_own: raw.offer_rent_to_own === true,
    rent_to_own_months: Number(raw.rent_to_own_months || DEFAULT_CONVERSION_SETTINGS.rent_to_own_months),
    rent_credit_percent: Number(raw.rent_credit_percent || DEFAULT_CONVERSION_SETTINGS.rent_credit_percent),
    portal_search_enabled: raw.portal_search_enabled !== false,
    cross_channel_followup_enabled: raw.cross_channel_followup_enabled === true,
    competitor_name: String(raw.competitor_name || DEFAULT_CONVERSION_SETTINGS.competitor_name),
    referral_discount_percent: Number(raw.referral_discount_percent || DEFAULT_CONVERSION_SETTINGS.referral_discount_percent),
    partner_company_ids: Array.isArray(raw.partner_company_ids)
      ? raw.partner_company_ids.map(String).filter(Boolean)
      : [],
    offer_fractional: raw.offer_fractional === true,
    launch_weeks_from_now:
      raw.launch_weeks_from_now == null ? null : Number(raw.launch_weeks_from_now),
    special_offers: Array.isArray(raw.special_offers) ? raw.special_offers.map(String).filter(Boolean) : [],
  };
}

export function mergeCompanyConversionSettings(
  companySettings: unknown,
  patch: ConversionSettingsPatch,
): Record<string, unknown> {
  const base =
    companySettings && typeof companySettings === 'object'
      ? { ...(companySettings as Record<string, unknown>) }
      : {};
  const current = parseConversionSettings(base);

  const merged: ConversionSettings = {
    budget_stretch_percent:
      patch.budget_stretch_percent !== undefined
        ? clampPercent(patch.budget_stretch_percent)
        : current.budget_stretch_percent,
    upsell_enabled: patch.upsell_enabled !== undefined ? patch.upsell_enabled : current.upsell_enabled,
    waitlist_copy: patch.waitlist_copy
      ? { ...current.waitlist_copy, ...patch.waitlist_copy }
      : current.waitlist_copy,
    partners: patch.partners !== undefined ? patch.partners : current.partners,
    primary_city: patch.primary_city !== undefined ? patch.primary_city : current.primary_city,
    pan_india_cities: patch.pan_india_cities !== undefined ? patch.pan_india_cities : current.pan_india_cities,
    international_partners_enabled:
      patch.international_partners_enabled !== undefined ? patch.international_partners_enabled : current.international_partners_enabled,
    possession_gap_months: patch.possession_gap_months !== undefined ? patch.possession_gap_months : current.possession_gap_months,
    business_type: patch.business_type !== undefined ? patch.business_type : current.business_type,
    offer_rent_to_own: patch.offer_rent_to_own !== undefined ? patch.offer_rent_to_own : current.offer_rent_to_own,
    rent_to_own_months: patch.rent_to_own_months !== undefined ? patch.rent_to_own_months : current.rent_to_own_months,
    rent_credit_percent: patch.rent_credit_percent !== undefined ? patch.rent_credit_percent : current.rent_credit_percent,
    portal_search_enabled: patch.portal_search_enabled !== undefined ? patch.portal_search_enabled : current.portal_search_enabled,
    cross_channel_followup_enabled:
      patch.cross_channel_followup_enabled !== undefined ? patch.cross_channel_followup_enabled : current.cross_channel_followup_enabled,
    competitor_name: patch.competitor_name !== undefined ? patch.competitor_name : current.competitor_name,
    referral_discount_percent:
      patch.referral_discount_percent !== undefined ? patch.referral_discount_percent : current.referral_discount_percent,
    partner_company_ids: patch.partner_company_ids !== undefined ? patch.partner_company_ids : current.partner_company_ids,
    offer_fractional: patch.offer_fractional !== undefined ? patch.offer_fractional : current.offer_fractional,
    launch_weeks_from_now: patch.launch_weeks_from_now !== undefined ? patch.launch_weeks_from_now : current.launch_weeks_from_now,
    special_offers: patch.special_offers !== undefined ? patch.special_offers : current.special_offers,
  };

  return { ...base, conversion: merged };
}

export async function getConversionSettings(companyId: string): Promise<ConversionSettings> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  return parseConversionSettings(company?.settings);
}

export async function saveConversionSettings(
  companyId: string,
  patch: ConversionSettingsPatch,
): Promise<ConversionSettings> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  if (!company) {
    throw new Error('Company not found');
  }

  const nextSettings = mergeCompanyConversionSettings(company.settings, patch);
  await prisma.company.update({
    where: { id: companyId },
    data: { settings: nextSettings as object },
  });

  return parseConversionSettings(nextSettings);
}

export function getBudgetStretchRatio(settings: ConversionSettings): number {
  return settings.budget_stretch_percent / 100;
}

export function getWaitlistMessage(settings: ConversionSettings, language?: string | null): string {
  const lang = language || 'en';
  const copy = settings.waitlist_copy;
  return copy[lang as keyof ConversionWaitlistCopy] || copy.en;
}
