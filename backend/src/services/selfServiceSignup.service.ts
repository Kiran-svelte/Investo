import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { authService, normalizeAuthEmail } from './auth.service';
import {
  DEFAULT_ONBOARDING_FEATURES,
  DEFAULT_ONBOARDING_ROLES,
} from '../constants/onboardingDefaults';
import { normalizeIndianPhoneNumber, isIndianE164Phone } from '../models/validation';

export interface SelfServiceSignupInput {
  companyName: string;
  adminName: string;
  email: string;
  password: string;
  whatsappPhone?: string | null;
}

export interface SelfServiceSignupResult {
  companyId: string;
  userId: string;
  slug: string;
  email: string;
}

function slugifyCompanyName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'company';
}

async function resolveUniqueSlug(baseName: string): Promise<string> {
  const base = slugifyCompanyName(baseName);
  let candidate = base;
  let suffix = 0;

  while (await prisma.company.findUnique({ where: { slug: candidate } })) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

function normalizeOptionalWhatsAppPhone(whatsappPhone?: string | null): string | null {
  if (whatsappPhone === undefined || whatsappPhone === null || whatsappPhone === '') {
    return null;
  }
  const normalized = normalizeIndianPhoneNumber(whatsappPhone);
  if (normalized === null) {
    return null;
  }
  if (typeof normalized === 'string' && isIndianE164Phone(normalized)) {
    return normalized;
  }
  throw new Error('Phone must be in E.164 format: +91XXXXXXXXXX');
}

export async function registerSelfServiceTenant(
  input: SelfServiceSignupInput,
): Promise<SelfServiceSignupResult> {
  const normalizedEmail = normalizeAuthEmail(input.email);
  const whatsappPhone = normalizeOptionalWhatsAppPhone(input.whatsappPhone);

  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existingUser) {
    throw new Error('Email already registered');
  }

  if (whatsappPhone) {
    const phoneTaken = await prisma.company.findFirst({ where: { whatsappPhone } });
    if (phoneTaken) {
      throw new Error('WhatsApp number already in use by another company');
    }
  }

  const slug = await resolveUniqueSlug(input.companyName);
  const companyId = uuidv4();

  await prisma.$transaction(async (tx) => {
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

    for (const featureKey of DEFAULT_ONBOARDING_FEATURES) {
      await tx.companyFeature.create({
        data: { companyId, featureKey, enabled: true },
      });
    }

    for (const role of DEFAULT_ONBOARDING_ROLES) {
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

  const user = await authService.register({
    name: input.adminName.trim(),
    email: normalizedEmail,
    password: input.password,
    role: 'company_admin',
    company_id: companyId,
    must_change_password: false,
  });

  logger.info('Self-service tenant registered', { companyId, slug, userId: user.id });

  return {
    companyId,
    userId: user.id,
    slug,
    email: user.email,
  };
}
