import crypto from 'crypto';
import prisma from '../../config/prisma';
import config from '../../config';
import logger from '../../config/logger';
import { provisionNewCompany } from '../companyProvisioning.service';
import { authService } from '../auth.service';
import { emailService } from '../email.service';
import {
  assignInvestoProPlan,
  startTrialForCompany,
  logBillingEvent,
} from './subscription.service';

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

  const existingUser = await prisma.user.findUnique({ where: { email: invite.adminEmail } });
  if (existingUser) throw new Error('An account with this email already exists');

  const slug = await uniqueSlug(invite.agencyName);

  const company = await prisma.company.create({
    data: {
      name: invite.agencyName,
      slug,
      whatsappPhone: input.whatsappPhone || null,
      status: 'active',
    },
  });

  await assignInvestoProPlan(company.id);
  await provisionNewCompany(company.id, company.name);
  await startTrialForCompany(company.id, {
    negotiatedMonthlyPrice: invite.negotiatedMonthlyPrice
      ? Number(invite.negotiatedMonthlyPrice)
      : null,
  });

  const result = await authService.register({
    name: input.adminName.trim(),
    email: invite.adminEmail,
    password: input.password,
    phone: input.whatsappPhone || null,
    role: 'company_admin',
    company_id: company.id,
    must_change_password: false,
  });

  await prisma.agencyInvite.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date(), companyId: company.id },
  });

  await logBillingEvent(company.id, 'invite_accepted', { inviteId: invite.id });

  logger.info('Agency invite accepted', { companyId: company.id, inviteId: invite.id });

  return { companyId: company.id, userId: result.id };
}

export async function listAgencyInvites(createdById?: string) {
  return prisma.agencyInvite.findMany({
    where: createdById ? { createdById } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}
