import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
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
import { emailService, type MailSendResult } from '../email.service';
import { assertStaffPhoneAvailable } from '../../utils/staffPhoneUniqueness';
import { ensureInvestoProPlan } from './subscription.service';

const BCRYPT_ROUNDS = 12;
const INVITE_ACCEPT_TRANSACTION_TIMEOUT_MS = 30_000;
const INVITE_ACCEPT_TRANSACTION_MAX_WAIT_MS = 10_000;
const EMAIL_ERROR_MAX_LENGTH = 2000;

export type AgencyInviteEmailDelivery = {
  status:
    | 'pending'
    | 'sent'
    | 'delivered'
    | 'delivery_delayed'
    | 'failed'
    | 'bounced'
    | 'complained'
    | 'suppressed'
    | 'opened'
    | 'clicked';
  sent: boolean;
  reason?: string;
  messageId?: string | null;
  lastAttemptAt?: Date | null;
  sentAt?: Date | null;
  deliveredAt?: Date | null;
  lastEventAt?: Date | null;
};

export function getInviteTokenFingerprint(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
}

function truncateEmailError(reason?: string): string | null {
  if (!reason) return null;
  return reason.slice(0, EMAIL_ERROR_MAX_LENGTH);
}

export function buildAgencyInviteEmailDelivery(input: {
  status?: string | null;
  messageId?: string | null;
  lastError?: string | null;
  lastAttemptAt?: Date | null;
  sentAt?: Date | null;
  deliveredAt?: Date | null;
  lastEventAt?: Date | null;
}): AgencyInviteEmailDelivery {
  const knownStatuses = new Set<AgencyInviteEmailDelivery['status']>([
    'pending',
    'sent',
    'delivered',
    'delivery_delayed',
    'failed',
    'bounced',
    'complained',
    'suppressed',
    'opened',
    'clicked',
  ]);
  const status = knownStatuses.has(input.status as AgencyInviteEmailDelivery['status'])
    ? (input.status as AgencyInviteEmailDelivery['status'])
    : 'pending';
  return {
    status,
    sent: status !== 'pending' && status !== 'failed',
    reason: input.lastError || undefined,
    messageId: input.messageId ?? null,
    lastAttemptAt: input.lastAttemptAt ?? null,
    sentAt: input.sentAt ?? null,
    deliveredAt: input.deliveredAt ?? null,
    lastEventAt: input.lastEventAt ?? null,
  };
}

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

async function sendAndRecordAgencyInviteEmail(invite: {
  id: string;
  adminEmail: string;
  agencyName: string;
  token: string;
  expiresAt: Date;
}): Promise<AgencyInviteEmailDelivery> {
  const attemptedAt = new Date();
  const inviteUrl = `${config.frontend.baseUrl}/accept-invite/${invite.token}`;

  const mailResult: MailSendResult = await emailService.sendAgencyInviteEmail({
    toEmail: invite.adminEmail,
    agencyName: invite.agencyName,
    inviteUrl,
    expiresAt: invite.expiresAt,
  });

  const status = mailResult.sent ? 'sent' : 'failed';
  const deliveryData = {
    emailDeliveryStatus: status,
    emailLastAttemptAt: attemptedAt,
    emailSentAt: mailResult.sent ? attemptedAt : null,
    emailMessageId: mailResult.messageId ?? null,
    emailLastError: mailResult.sent ? null : truncateEmailError(mailResult.reason),
  };

  await prisma.agencyInvite.update({
    where: { id: invite.id },
    data: deliveryData,
  });

  if (mailResult.sent) {
    logger.info('Agency invite email accepted by Resend', {
      inviteId: invite.id,
      toEmail: invite.adminEmail,
      messageId: mailResult.messageId ?? null,
    });
  } else {
    logger.error('Agency invite email not delivered', {
      inviteId: invite.id,
      toEmail: invite.adminEmail,
      reason: mailResult.reason,
      action: 'Verify RESEND_API_KEY, MAIL_FROM sender/domain, and Resend suppression/delivery logs.',
    });
  }

  return {
    status,
    sent: mailResult.sent,
    reason: mailResult.reason,
    messageId: mailResult.messageId ?? null,
    lastAttemptAt: attemptedAt,
    sentAt: mailResult.sent ? attemptedAt : null,
  };
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
  emailDelivery: AgencyInviteEmailDelivery;
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

  const emailDelivery = await sendAndRecordAgencyInviteEmail(invite);

  return {
    id: invite.id,
    token,
    inviteUrl,
    expiresAt,
    emailDelivery,
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

    await tx.companyFeature.createMany({
      data: DEFAULT_ONBOARDING_FEATURES.map((featureKey) => ({
        companyId,
        featureKey,
        enabled: true,
      })),
    });

    await tx.companyRole.createMany({
      data: DEFAULT_ONBOARDING_ROLES.map((role) => ({
        companyId,
        roleName: role.roleName,
        displayName: role.displayName,
        permissions: role.permissions as Prisma.InputJsonObject,
        isDefault: true,
      })),
    });

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

    await tx.billingEvent.createMany({
      data: [
        {
          companyId,
          eventType: 'trial_started',
          payload: { trialEndsAt: trialEnds.toISOString() },
        },
      ],
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

    await tx.billingEvent.createMany({
      data: [
        {
          companyId,
          eventType: 'invite_accepted',
          payload: { inviteId: invite.id },
        },
      ],
    });

    return { companyId, userId };
  }, {
    maxWait: INVITE_ACCEPT_TRANSACTION_MAX_WAIT_MS,
    timeout: INVITE_ACCEPT_TRANSACTION_TIMEOUT_MS,
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

export async function resendAgencyInvite(inviteId: string): Promise<{
  id: string;
  inviteUrl: string;
  emailDelivery: AgencyInviteEmailDelivery;
}> {
  const invite = await prisma.agencyInvite.findUnique({ where: { id: inviteId } });
  if (!invite) throw new Error('Invalid invite link');
  if (invite.acceptedAt) throw new Error('Invite already accepted');
  if (invite.expiresAt.getTime() < Date.now()) throw new Error('Invite has expired');

  const emailDelivery = await sendAndRecordAgencyInviteEmail(invite);
  return {
    id: invite.id,
    inviteUrl: `${config.frontend.baseUrl}/accept-invite/${invite.token}`,
    emailDelivery,
  };
}

export async function listAgencyInvites(createdById?: string) {
  return prisma.agencyInvite.findMany({
    where: createdById ? { createdById } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}
