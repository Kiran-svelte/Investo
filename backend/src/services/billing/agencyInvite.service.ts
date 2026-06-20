import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../../config/prisma';
import config from '../../config';
import logger from '../../config/logger';
import { SUBSCRIPTION_PRICING } from '../../constants/subscriptionPricing';
import {
  DEFAULT_ONBOARDING_FEATURES,
  DEFAULT_ONBOARDING_ROLES,
} from '../../constants/onboardingDefaults';
import { bootstrapCompanyIdentityConfig } from '../../identity/identityConfig.service';
import { normalizeAuthEmail } from '../auth.service';
import { emailService } from '../email.service';
import { assertStaffPhoneAvailable } from '../../utils/staffPhoneUniqueness';
import { ensureInvestoProPlan } from './subscription.service';

const BCRYPT_ROUNDS = 12;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = slugify(base);
  let attempt = 0;
  while (true) {
    const candidate = attempt === 0 ? slug : `${slug}-${attempt}`;
    const existing = await prisma.company.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    attempt += 1;
  }
}

/** Remove companies left behind by failed accept attempts (no users, same agency name). */
async function cleanupOrphanAgencyCompanies(agencyName: string): Promise<void> {
  const orphans = await prisma.company.findMany({
    where: {
      name: agencyName,
      users: { none: {} },
    },
    select: { id: true, slug: true },
  });

  for (const orphan of orphans) {
    await prisma.company.delete({ where: { id: orphan.id } });
    logger.warn('Removed orphan agency company from failed invite accept', {
      companyId: orphan.id,
      slug: orphan.slug,
      agencyName,
    });
  }
}

export async function createAgencyInvite(input: {
  agencyName: string;
  adminEmail: string;
  negotiatedMonthlyPrice?: number | null;
  notes?: string;
  createdById: string;
}): Promise<{
  id: string;
  token: string;
  inviteUrl: string;
  expiresAt: Date;
  emailDelivery: { sent: boolean; reason?: string };
}> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const invite = await prisma.agencyInvite.create({
    data: {
      token,
      agencyName: input.agencyName.trim(),
      adminEmail: input.adminEmail.trim().toLowerCase(),
      negotiatedMonthlyPrice: input.negotiatedMonthlyPrice ?? null,
      notes: input.notes ?? null,
      expiresAt,
      createdById: input.createdById,
    },
  });

  const inviteUrl = `${config.frontend.baseUrl}/accept-invite/${token}`;

  const mailResult = await emailService.sendAgencyInviteEmail({
    toEmail: invite.adminEmail,
    agencyName: invite.agencyName,
    inviteUrl,
    expiresAt: invite.expiresAt,
  });
  if (!mailResult.sent) {
    logger.error('Agency invite email not delivered', {
      inviteId: invite.id,
      toEmail: invite.adminEmail,
      reason: mailResult.reason,
      action: 'Configure RESEND_API_KEY and MAIL_FROM in Railway backend service vars',
    });
  }

  return {
    id: invite.id,
    token,
    inviteUrl,
    expiresAt,
    emailDelivery: {
      sent: mailResult.sent,
      reason: mailResult.reason,
    },
  };
}

export async function getInviteByToken(token: string) {
  const invite = await prisma.agencyInvite.findUnique({ where: { token } });
  if (!invite) return null;
  if (invite.acceptedAt) return { ...invite, status: 'accepted' as const };
  if (invite.expiresAt.getTime() < Date.now()) return { ...invite, status: 'expired' as const };
  return { ...invite, status: 'pending' as const };
}

export async function acceptAgencyInvite(input: {
  token: string;
  adminName: string;
  password: string;
  whatsappPhone?: string | null;
}): Promise<{ companyId: string; userId: string }> {
  const invite = await prisma.agencyInvite.findUnique({ where: { token: input.token } });
  if (!invite) throw new Error('Invalid invite link');
  if (invite.acceptedAt) throw new Error('Invite already accepted');
  if (invite.expiresAt.getTime() < Date.now()) throw new Error('Invite has expired');

  const normalizedEmail = normalizeAuthEmail(invite.adminEmail);
  const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existingUser) throw new Error('An account with this email already exists');

  const normalizedPhone = input.whatsappPhone
    ? await assertStaffPhoneAvailable(input.whatsappPhone)
    : null;

  await cleanupOrphanAgencyCompanies(invite.agencyName);

  const slug = await uniqueSlug(invite.agencyName);
  const companyId = uuidv4();
  const userId = uuidv4();
  const planId = await ensureInvestoProPlan();
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const now = new Date();
  const trialEnds = new Date(now);
  trialEnds.setDate(trialEnds.getDate() + SUBSCRIPTION_PRICING.trialDays);

  const result = await prisma.$transaction(async (tx) => {
    await tx.company.create({
      data: {
        id: companyId,
        name: invite.agencyName,
        slug,
        whatsappPhone: normalizedPhone,
        planId,
        status: 'active',
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
        businessName: invite.agencyName,
        responseTone: 'friendly',
        persuasionLevel: 5,
        workingHours: { start: '09:00', end: '21:00' },
        greetingTemplate: `Hello! Welcome to ${invite.agencyName}. How can I help you find your dream property today?`,
        defaultLanguage: 'en',
        operatingLocations: [],
        budgetRanges: {},
        faqKnowledge: [],
      },
    });

    await tx.companyOnboarding.create({
      data: { companyId, stepCompleted: 0 },
    });

    await tx.companySubscription.create({
      data: {
        companyId,
        billingStatus: 'trialing',
        trialStartedAt: now,
        trialEndsAt: trialEnds,
        basePriceMonthly: SUBSCRIPTION_PRICING.basePriceMonthlyInr,
        includedSeats: SUBSCRIPTION_PRICING.includedSeats,
        perSeatPriceInr: SUBSCRIPTION_PRICING.perSeatPriceInr,
        ...(invite.negotiatedMonthlyPrice != null
          ? { negotiatedMonthlyPrice: invite.negotiatedMonthlyPrice }
          : {}),
      },
    });

    await tx.billingEvent.create({
      data: {
        companyId,
        eventType: 'trial_started',
        payload: { trialEndsAt: trialEnds.toISOString() },
      },
    });

    await tx.user.create({
      data: {
        id: userId,
        companyId,
        name: input.adminName.trim(),
        email: normalizedEmail,
        phone: normalizedPhone,
        passwordHash,
        role: 'company_admin',
        mustChangePassword: false,
        status: 'active',
      },
    });

    await tx.agencyInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: now, companyId },
    });

    await tx.billingEvent.create({
      data: {
        companyId,
        eventType: 'invite_accepted',
        payload: { inviteId: invite.id },
      },
    });

    return { companyId, userId };
  });

  try {
    await bootstrapCompanyIdentityConfig(companyId);
  } catch (err: unknown) {
    logger.warn('Identity config bootstrap skipped after invite accept', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('Agency invite accepted', { companyId, inviteId: invite.id, userId });

  return result;
}

export async function listAgencyInvites(createdById?: string) {
  return prisma.agencyInvite.findMany({
    where: createdById ? { createdById } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}
