import prisma from '../config/prisma';
import config from '../config';

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

function getWhatsAppSettings(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== 'object') {
    return {};
  }
  const whatsapp = (settings as Record<string, unknown>).whatsapp;
  return whatsapp && typeof whatsapp === 'object' ? (whatsapp as Record<string, unknown>) : {};
}

function hasWhatsAppCredentials(settings: unknown): boolean {
  const whatsapp = getWhatsAppSettings(settings);
  const meta = (whatsapp.meta as Record<string, unknown>) || {};
  const phoneNumberId = String(meta.phoneNumberId || whatsapp.phoneNumberId || '').trim();
  const accessToken = String(meta.accessToken || whatsapp.accessToken || '').trim();
  return Boolean(phoneNumberId && accessToken);
}

/**
 * WhatsApp is "verified" only when it has been explicitly tested and
 * `verifiedAt` / `lastVerifiedAt` is recorded in company settings.
 * When credentials exist but verification has never been run we return
 * status='fail' (not 'warn') so the readiness gate blocks correctly per
 * Chunk-07 spec: "Readiness green only when WhatsApp verified".
 */
function getWhatsAppVerificationStatus(settings: unknown): ReadinessCheckStatus {
  const whatsapp = getWhatsAppSettings(settings);
  const hasCredentials = hasWhatsAppCredentials(settings);

  if (!hasCredentials) {
    // No credentials at all — handled by whatsapp_credentials check.
    return 'warn';
  }

  const isVerified = Boolean(whatsapp.verifiedAt || whatsapp.lastVerifiedAt);
  // Credentials present but never tested → fail (blocks readiness.ready).
  return isVerified ? 'pass' : 'fail';
}

import { isMailConfigured as isMailEnvConfigured } from './mailHealth.service';

function isMailConfigured(): boolean {
  return isMailEnvConfigured();
}

export async function getTenantReadiness(companyId: string): Promise<TenantReadinessReport> {
  const [company, onboarding, publishedPropertyCount, totalPropertyCount, userCount, aiSettings] =
    await Promise.all([
      prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true, whatsappPhone: true, settings: true, status: true },
      }),
      prisma.companyOnboarding.findUnique({ where: { companyId } }),
      // Chunk-07: at least one PUBLISHED property required (not just any draft).
      prisma.property.count({ where: { companyId, status: 'published' } }),
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

  const waVerificationStatus = getWhatsAppVerificationStatus(company.settings);

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
      label: 'Property catalog (published)',
      // Chunk-07: must have at least one PUBLISHED property, not just a draft.
      status: publishedPropertyCount > 0 ? 'pass' : 'fail',
      detail:
        publishedPropertyCount > 0
          ? `${publishedPropertyCount} published propert${publishedPropertyCount === 1 ? 'y' : 'ies'}`
          : totalPropertyCount > 0
          ? `${totalPropertyCount} propert${totalPropertyCount === 1 ? 'y' : 'ies'} in draft — publish at least one so the AI can answer buyers`
          : 'Add and publish at least one property for the AI to recommend inventory',
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
      // Chunk-07: upgraded from warn → fail when credentials exist but unverified.
      status: waVerificationStatus,
      detail:
        waVerificationStatus === 'pass'
          ? 'Last connection test succeeded'
          : waVerificationStatus === 'fail'
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

  // Chunk-07 required gate: all of these must pass before ready=true.
  // whatsapp_verified promoted to required (was previously only in warn tier).
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
