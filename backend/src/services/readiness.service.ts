import prisma from '../config/prisma';

export type ReadinessCheckStatus = 'pass' | 'fail' | 'warn';

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessCheckStatus;
  detail: string;
  actionPath?: string;
}

export interface TenantReadinessReport {
  ready: boolean;
  score: number;
  checks: ReadinessCheck[];
}

/** Extract the whatsapp sub-object from company settings JSON. */
function getWhatsAppSettings(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== 'object') {
    return {};
  }
  const whatsapp = (settings as Record<string, unknown>).whatsapp;
  return whatsapp && typeof whatsapp === 'object'
    ? (whatsapp as Record<string, unknown>)
    : {};
}

/** Returns true if phone number ID + access token are both present and non-empty. */
function hasWhatsAppCredentials(settings: unknown): boolean {
  const whatsapp = getWhatsAppSettings(settings);
  const meta = (whatsapp.meta as Record<string, unknown>) || {};
  const phoneNumberId = String(meta.phoneNumberId || whatsapp.phoneNumberId || '').trim();
  const accessToken = String(meta.accessToken || whatsapp.accessToken || '').trim();
  return Boolean(phoneNumberId && accessToken);
}

/**
 * Derives the verification status for the WhatsApp readiness check.
 *
 * Chunk-07 requirement: readiness must be `ready=true` ONLY when WhatsApp is
 * actually verified. To enforce this, the check is:
 *   - 'pass'  — credentials present AND last test succeeded (verifiedAt set)
 *   - 'fail'  — credentials present BUT never tested  ← promoted from 'warn'
 *   - 'warn'  — no credentials at all (handled separately by whatsapp_credentials check)
 *
 * @param settings - Raw company.settings JSON value
 * @returns ReadinessCheckStatus
 */
function getWhatsAppVerifiedStatus(settings: unknown): ReadinessCheckStatus {
  const whatsapp = getWhatsAppSettings(settings);
  const hasCredentials = hasWhatsAppCredentials(settings);

  if (!hasCredentials) {
    // No credentials — whatsapp_credentials check will handle this.
    return 'warn';
  }

  const isVerified = Boolean(whatsapp.verifiedAt || whatsapp.lastVerifiedAt);
  // Credentials present but never tested → fail so ready gate blocks.
  return isVerified ? 'pass' : 'fail';
}

import { isMailConfigured as isMailEnvConfigured } from './mailHealth.service';

function isMailConfigured(): boolean {
  return isMailEnvConfigured();
}

export async function getTenantReadiness(companyId: string): Promise<TenantReadinessReport> {
  const [
    company,
    onboarding,
    publishedPropertyCount,
    totalPropertyCount,
    userCount,
    aiSettings,
  ] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true, whatsappPhone: true, settings: true, status: true },
    }),
    prisma.companyOnboarding.findUnique({ where: { companyId } }),
    // Chunk-07: at least one AVAILABLE (buyer-visible) property required.
    // PropertyStatus enum: available | sold | upcoming — no 'published' enum value.
    prisma.property.count({ where: { companyId, status: 'available' } }),
    prisma.property.count({ where: { companyId } }),
    prisma.user.count({ where: { companyId, status: 'active' } }),
    prisma.aiSetting.findUnique({
      where: { companyId },
      select: { businessName: true, operatingLocations: true },
    }),
  ]);

  if (!company) {
    return {
      ready: false,
      score: 0,
      checks: [{ id: 'company', label: 'Company', status: 'fail', detail: 'Company not found' }],
    };
  }

  const onboardingComplete = Boolean(onboarding?.completedAt);
  const locations = Array.isArray(aiSettings?.operatingLocations)
    ? aiSettings!.operatingLocations
    : [];
  const waVerifiedStatus = getWhatsAppVerifiedStatus(company.settings);

  const checks: ReadinessCheck[] = [
    {
      id: 'company_active',
      label: 'Company account active',
      status: company.status === 'active' ? 'pass' : 'fail',
      detail:
        company.status === 'active' ? 'Active' : `Status: ${company.status}`,
    },
    {
      id: 'onboarding_complete',
      label: 'Onboarding completed',
      status: onboardingComplete ? 'pass' : 'fail',
      detail: onboardingComplete
        ? 'Setup wizard finished'
        : 'Finish the 6-step onboarding wizard',
      actionPath: '/onboarding',
    },
    {
      id: 'properties',
      label: 'Property catalog (at least one available)',
      // Chunk-07: requires at least one AVAILABLE property (buyer-visible).
      status: publishedPropertyCount > 0 ? 'pass' : 'fail',
      detail:
        publishedPropertyCount > 0
          ? `${publishedPropertyCount} available propert${publishedPropertyCount === 1 ? 'y' : 'ies'}`
          : totalPropertyCount > 0
          ? `${totalPropertyCount} propert${totalPropertyCount === 1 ? 'y' : 'ies'} exist but none are available — set at least one to 'available' so AI can recommend inventory`
          : 'Add at least one property and set it to available so AI can recommend inventory',
      actionPath: '/properties',
    },
    {
      id: 'ai_profile',
      label: 'AI business profile',
      status: aiSettings?.businessName ? 'pass' : 'warn',
      detail: aiSettings?.businessName
        ? `Configured for ${aiSettings.businessName}`
        : 'Set business name and locations in AI settings',
      actionPath: '/ai-settings',
    },
    {
      id: 'ai_locations',
      label: 'Operating locations',
      status: locations.length > 0 ? 'pass' : 'warn',
      detail:
        locations.length > 0
          ? locations.join(', ')
          : 'Add cities/areas so search and AI stay accurate',
      actionPath: '/ai-settings',
    },
    {
      id: 'whatsapp_credentials',
      label: 'WhatsApp credentials saved',
      status: hasWhatsAppCredentials(company.settings) ? 'pass' : 'fail',
      detail: hasWhatsAppCredentials(company.settings)
        ? 'Meta or Green API credentials present'
        : 'Connect WhatsApp in AI Settings',
      actionPath: '/ai-settings',
    },
    {
      id: 'whatsapp_verified',
      label: 'WhatsApp connection tested',
      // Chunk-07: upgraded from warn → fail when credentials present but unverified.
      status: waVerifiedStatus,
      detail:
        waVerifiedStatus === 'pass'
          ? 'Last connection test succeeded'
          : waVerifiedStatus === 'fail'
          ? 'Run Test Connection after saving credentials — WhatsApp is not live until verified'
          : 'Save credentials first, then run Test Connection',
      actionPath: '/ai-settings',
    },
    {
      id: 'customer_phone',
      label: 'Public WhatsApp number on profile',
      status: company.whatsappPhone ? 'pass' : 'warn',
      detail:
        company.whatsappPhone || 'Set the customer-facing number in company profile',
      actionPath: '/settings',
    },
    {
      id: 'team',
      label: 'Team members',
      status: userCount >= 1 ? 'pass' : 'fail',
      detail: `${userCount} active user(s)`,
      actionPath: '/agents',
    },
    {
      id: 'email_delivery',
      label: 'Password reset email delivery',
      status: isMailConfigured() ? 'pass' : 'warn',
      detail: isMailConfigured()
        ? 'Email delivery configured for forgot-password and invites'
        : 'Email not configured — password reset emails may not send (contact platform admin)',
    },
  ];

  const passCount = checks.filter((c) => c.status === 'pass').length;

  // Chunk-07 gate: ALL of these must be 'pass' for ready=true.
  // whatsapp_verified is now required (not just a warning).
  const requiredIds = new Set([
    'company_active',
    'onboarding_complete',
    'properties',
    'whatsapp_credentials',
    'whatsapp_verified',
    'team',
  ]);

  const requiredPass = checks.filter(
    (c) => requiredIds.has(c.id) && c.status === 'pass',
  ).length;
  const ready = requiredPass === requiredIds.size;
  const score = Math.round((passCount / checks.length) * 100);

  return { ready, score, checks };
}
