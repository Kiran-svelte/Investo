"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTenantReadiness = getTenantReadiness;
const prisma_1 = __importDefault(require("../config/prisma"));
function getWhatsAppSettings(settings) {
    if (!settings || typeof settings !== 'object') {
        return {};
    }
    const whatsapp = settings.whatsapp;
    return whatsapp && typeof whatsapp === 'object' ? whatsapp : {};
}
function hasWhatsAppCredentials(settings) {
    const whatsapp = getWhatsAppSettings(settings);
    const meta = whatsapp.meta || {};
    const phoneNumberId = String(meta.phoneNumberId || whatsapp.phoneNumberId || '').trim();
    const accessToken = String(meta.accessToken || whatsapp.accessToken || '').trim();
    return Boolean(phoneNumberId && accessToken);
}
function isWhatsAppVerified(settings) {
    const whatsapp = getWhatsAppSettings(settings);
    return Boolean(whatsapp.verifiedAt || whatsapp.lastVerifiedAt);
}
const mailHealth_service_1 = require("./mailHealth.service");
function isMailConfigured() {
    return (0, mailHealth_service_1.isMailConfigured)();
}
async function getTenantReadiness(companyId) {
    const [company, onboarding, propertyCount, userCount, aiSettings] = await Promise.all([
        prisma_1.default.company.findUnique({
            where: { id: companyId },
            select: { name: true, whatsappPhone: true, settings: true, status: true },
        }),
        prisma_1.default.companyOnboarding.findUnique({ where: { companyId } }),
        prisma_1.default.property.count({ where: { companyId } }),
        prisma_1.default.user.count({ where: { companyId, status: 'active' } }),
        prisma_1.default.aiSetting.findUnique({
            where: { companyId },
            select: { businessName: true, operatingLocations: true },
        }),
    ]);
    if (!company) {
        return { ready: false, score: 0, checks: [{ id: 'company', label: 'Company', status: 'fail', detail: 'Company not found' }] };
    }
    const onboardingComplete = Boolean(onboarding?.completedAt);
    const locations = Array.isArray(aiSettings?.operatingLocations) ? aiSettings.operatingLocations : [];
    const checks = [
        {
            id: 'company_active',
            label: 'Company account active',
            status: company.status === 'active' ? 'pass' : 'fail',
            detail: company.status === 'active' ? 'Active' : `Status: ${company.status}`,
        },
        {
            id: 'onboarding_complete',
            label: 'Onboarding completed',
            status: onboardingComplete ? 'pass' : 'fail',
            detail: onboardingComplete ? 'Setup wizard finished' : 'Finish the 6-step onboarding wizard',
            actionPath: '/onboarding',
        },
        {
            id: 'properties',
            label: 'Property catalog',
            status: propertyCount > 0 ? 'pass' : 'fail',
            detail: propertyCount > 0 ? `${propertyCount} properties` : 'Add at least one property for AI to recommend inventory',
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
            detail: locations.length > 0 ? locations.join(', ') : 'Add cities/areas so search and AI stay accurate',
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
            status: isWhatsAppVerified(company.settings) ? 'pass' : 'warn',
            detail: isWhatsAppVerified(company.settings)
                ? 'Last connection test succeeded'
                : 'Run Test Connection after saving credentials',
            actionPath: '/ai-settings',
        },
        {
            id: 'customer_phone',
            label: 'Public WhatsApp number on profile',
            status: company.whatsappPhone ? 'pass' : 'warn',
            detail: company.whatsappPhone || 'Set the customer-facing number in company profile',
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
    const requiredIds = new Set([
        'company_active',
        'onboarding_complete',
        'properties',
        'whatsapp_credentials',
        'team',
    ]);
    const requiredPass = checks.filter((c) => requiredIds.has(c.id) && c.status === 'pass').length;
    const ready = requiredPass === requiredIds.size;
    const score = Math.round((passCount / checks.length) * 100);
    return { ready, score, checks };
}
