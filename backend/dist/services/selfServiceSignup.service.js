"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSelfServiceTenant = registerSelfServiceTenant;
const uuid_1 = require("uuid");
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const auth_service_1 = require("./auth.service");
const onboardingDefaults_1 = require("../constants/onboardingDefaults");
const validation_1 = require("../models/validation");
function slugifyCompanyName(name) {
    const base = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return base || 'company';
}
async function resolveUniqueSlug(baseName) {
    const base = slugifyCompanyName(baseName);
    let candidate = base;
    let suffix = 0;
    while (await prisma_1.default.company.findUnique({ where: { slug: candidate } })) {
        suffix += 1;
        candidate = `${base}-${suffix}`;
    }
    return candidate;
}
function normalizeOptionalWhatsAppPhone(whatsappPhone) {
    if (whatsappPhone === undefined || whatsappPhone === null || whatsappPhone === '') {
        return null;
    }
    const normalized = (0, validation_1.normalizeIndianPhoneNumber)(whatsappPhone);
    if (normalized === null) {
        return null;
    }
    if (typeof normalized === 'string' && (0, validation_1.isIndianE164Phone)(normalized)) {
        return normalized;
    }
    throw new Error('Phone must be in E.164 format: +91XXXXXXXXXX');
}
async function registerSelfServiceTenant(input) {
    const normalizedEmail = (0, auth_service_1.normalizeAuthEmail)(input.email);
    const whatsappPhone = normalizeOptionalWhatsAppPhone(input.whatsappPhone);
    const existingUser = await prisma_1.default.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
        throw new Error('Email already registered');
    }
    if (whatsappPhone) {
        const phoneTaken = await prisma_1.default.company.findFirst({ where: { whatsappPhone } });
        if (phoneTaken) {
            throw new Error('WhatsApp number already in use by another company');
        }
    }
    const slug = await resolveUniqueSlug(input.companyName);
    const companyId = (0, uuid_1.v4)();
    await prisma_1.default.$transaction(async (tx) => {
        await tx.company.create({
            data: {
                id: companyId,
                name: input.companyName.trim(),
                slug,
                whatsappPhone,
                status: 'active',
                settings: {
                    primary_color: '#3B82F6',
                    description: '',
                    signup_source: 'self_service',
                },
            },
        });
        for (const featureKey of onboardingDefaults_1.DEFAULT_ONBOARDING_FEATURES) {
            await tx.companyFeature.create({
                data: { companyId, featureKey, enabled: true },
            });
        }
        for (const role of onboardingDefaults_1.DEFAULT_ONBOARDING_ROLES) {
            await tx.companyRole.create({
                data: {
                    companyId,
                    roleName: role.roleName,
                    displayName: role.displayName,
                    permissions: role.permissions,
                    isDefault: true,
                },
            });
        }
        await tx.aiSetting.create({
            data: {
                companyId,
                businessName: input.companyName.trim(),
                responseTone: 'friendly',
                persuasionLevel: 5,
                workingHours: { start: '09:00', end: '21:00' },
                greetingTemplate: `Hello! Welcome to ${input.companyName.trim()}. How can I help you today?`,
                defaultLanguage: 'en',
                operatingLocations: [],
                budgetRanges: {},
                faqKnowledge: [],
            },
        });
        await tx.companyOnboarding.create({
            data: { companyId, stepCompleted: 0 },
        });
    });
    const user = await auth_service_1.authService.register({
        name: input.adminName.trim(),
        email: normalizedEmail,
        password: input.password,
        role: 'company_admin',
        company_id: companyId,
        must_change_password: false,
    });
    logger_1.default.info('Self-service tenant registered', { companyId, slug, userId: user.id });
    return {
        companyId,
        userId: user.id,
        slug,
        email: user.email,
    };
}
