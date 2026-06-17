import config from '../config';
import logger from '../config/logger';
import { isMailConfigured } from './mailConfig.service';
import { isResendConfigured, sendResendEmail, verifyResendApi } from './resend-email.service';

export type PasswordResetEmailParams = {
  toEmail: string;
  toName?: string | null;
  resetUrl: string;
};

export type ReEngagementEmailParams = {
  toEmail: string;
  toName?: string | null;
  subject: string;
  bodyText: string;
};

export type WelcomeInviteEmailParams = {
  toEmail: string;
  toName?: string | null;
  loginUrl: string;
  temporaryPassword?: string;
  companyName?: string;
};

export type MailSendResult = {
  sent: boolean;
  reason?: string;
  messageId?: string | null;
};

export class EmailService {
  async verifyConnection(force = false): Promise<{ ok: boolean; detail: string }> {
    void force;
    return verifyResendApi();
  }

  private async sendEmail(mail: {
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<{ id: string | null }> {
    return sendResendEmail(mail);
  }

  async sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<MailSendResult> {
    if (!isMailConfigured()) {
      logger.warn('Password reset email skipped: mail not configured', {
        userEmail: params.toEmail,
        transport: config.mail.transport,
        resendConfigured: isResendConfigured(),
      });
      return { sent: false, reason: 'mail_not_configured' };
    }

    if (!config.mail.from) {
      logger.warn('Password reset email skipped: MAIL_FROM not configured', {
        userEmail: params.toEmail,
      });
      return { sent: false, reason: 'mail_from_missing' };
    }

    const displayName = (params.toName || '').trim();
    const greetingName = displayName ? displayName : 'there';

    const subject = 'Reset your Investo password';
    const text =
      `Hi ${greetingName},\n\n` +
      `We received a request to reset your Investo password.\n\n` +
      `Reset your password using this link:\n${params.resetUrl}\n\n` +
      `If you did not request this, you can ignore this email.\n`;

    const html = `
      <p>Hi ${escapeHtml(greetingName)},</p>
      <p>We received a request to reset your Investo password.</p>
      <p><a href="${escapeHtmlAttr(params.resetUrl)}">Reset your password</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `;

    try {
      const result = await this.sendEmail({
        to: params.toEmail,
        subject,
        text,
        html,
      });

      logger.info('Password reset email sent', {
        userEmail: params.toEmail,
        transport: config.mail.transport,
        messageId: result.id,
      });
      return { sent: true, messageId: result.id };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Password reset email failed', {
        userEmail: params.toEmail,
        transport: config.mail.transport,
        error: message,
      });
      return { sent: false, reason: message };
    }
  }

  async sendWelcomeInviteEmail(params: WelcomeInviteEmailParams): Promise<boolean> {
    if (!isMailConfigured() || !config.mail.from) {
      logger.warn('Welcome invite email skipped: Resend not configured', {
        userEmail: params.toEmail,
      });
      return false;
    }

    const greetingName = (params.toName || '').trim() || 'there';
    const companyLine = params.companyName ? ` for ${params.companyName}` : '';
    const passwordLine = params.temporaryPassword
      ? `\n\nTemporary password: ${params.temporaryPassword}\n(You may be asked to change it on first login.)`
      : '\n\nUse the password your platform admin shared with you.';

    const subject = `Your Investo company admin account${companyLine}`;
    const text =
      `Hi ${greetingName},\n\n` +
      `You have been invited as Company Admin on Investo${companyLine}.\n\n` +
      `Log in here:\n${params.loginUrl}${passwordLine}\n\n` +
      `After login, complete the 6-step onboarding wizard (company profile, team, WhatsApp, properties).`;

    const html = `
      <p>Hi ${escapeHtml(greetingName)},</p>
      <p>You have been invited as <strong>Company Admin</strong> on Investo${escapeHtml(companyLine)}.</p>
      <p><a href="${escapeHtmlAttr(params.loginUrl)}">Log in to Investo</a></p>
      ${params.temporaryPassword ? `<p>Temporary password: <code>${escapeHtml(params.temporaryPassword)}</code><br><small>Change it on first login if prompted.</small></p>` : ''}
      <p>Complete the 6-step onboarding wizard after login.</p>
    `;

    try {
      const result = await this.sendEmail({
        to: params.toEmail,
        subject,
        text,
        html,
      });
      logger.info('Welcome invite email sent', { userEmail: params.toEmail, messageId: result.id });
      return true;
    } catch (err: unknown) {
      logger.warn('Welcome invite email failed', {
        userEmail: params.toEmail,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async sendReEngagementEmail(params: ReEngagementEmailParams): Promise<boolean> {
    if (!isMailConfigured() || !config.mail.from) {
      logger.warn('Re-engagement email skipped: Resend not configured', {
        userEmail: params.toEmail,
      });
      return false;
    }

    const greetingName = (params.toName || '').trim() || 'there';
    const text = `Hi ${greetingName},\n\n${params.bodyText}`;
    const html = `<p>Hi ${escapeHtml(greetingName)},</p><p>${escapeHtml(params.bodyText).replace(/\n/g, '<br>')}</p>`;

    try {
      const result = await this.sendEmail({
        to: params.toEmail,
        subject: params.subject,
        text,
        html,
      });
      logger.info('Re-engagement email sent', { userEmail: params.toEmail, messageId: result.id });
      return true;
    } catch (err: unknown) {
      logger.warn('Re-engagement email failed', {
        userEmail: params.toEmail,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async sendAgencyInviteEmail(params: {
    toEmail: string;
    agencyName: string;
    inviteUrl: string;
    expiresAt: Date;
  }): Promise<boolean> {
    if (!isMailConfigured() || !config.mail.from) {
      logger.warn('Agency invite email skipped: mail not configured', { toEmail: params.toEmail });
      return false;
    }

    const subject = `You're invited to Investo — ${params.agencyName}`;
    const expiry = params.expiresAt.toLocaleDateString('en-IN');
    const text =
      `Hello,\n\n` +
      `You've been invited to set up ${params.agencyName} on Investo.\n\n` +
      `Start your 14-day full-access trial (no payment required):\n${params.inviteUrl}\n\n` +
      `This link expires on ${expiry}.\n`;

    const html = `
      <p>Hello,</p>
      <p>You've been invited to set up <strong>${escapeHtml(params.agencyName)}</strong> on Investo.</p>
      <p><a href="${escapeHtmlAttr(params.inviteUrl)}">Create your account &amp; start 14-day trial</a></p>
      <p><small>No payment required until you choose to subscribe. Link expires ${escapeHtml(expiry)}.</small></p>
    `;

    try {
      await this.sendEmail({ to: params.toEmail, subject, text, html });
      return true;
    } catch (err: unknown) {
      logger.warn('sendAgencyInviteEmail failed', {
        toEmail: params.toEmail,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async sendTrialReminderEmail(params: {
    toEmail: string;
    toName?: string | null;
    companyName: string;
    daysLeft: number;
    billingUrl: string;
  }): Promise<boolean> {
    if (!isMailConfigured() || !config.mail.from) return false;

    const name = (params.toName || '').trim() || 'there';
    const subject = `${params.daysLeft} day${params.daysLeft === 1 ? '' : 's'} left in your Investo trial`;
    const text =
      `Hi ${name},\n\n` +
      `Your Investo trial for ${params.companyName} ends in ${params.daysLeft} day(s).\n\n` +
      `Subscribe now to keep uninterrupted access:\n${params.billingUrl}\n`;

    const html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your Investo trial for <strong>${escapeHtml(params.companyName)}</strong> ends in <strong>${params.daysLeft}</strong> day(s).</p>
      <p><a href="${escapeHtmlAttr(params.billingUrl)}">Subscribe now</a></p>
    `;

    try {
      await this.sendEmail({ to: params.toEmail, subject, text, html });
      return true;
    } catch (err: unknown) {
      logger.warn('sendTrialReminderEmail failed', {
        toEmail: params.toEmail,
        daysLeft: params.daysLeft,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async sendTrialExpiredEmail(params: {
    toEmail: string;
    toName?: string | null;
    billingUrl: string;
  }): Promise<boolean> {
    if (!isMailConfigured() || !config.mail.from) return false;

    const name = (params.toName || '').trim() || 'there';
    const subject = 'Your Investo trial has ended — subscribe to continue';
    const text =
      `Hi ${name},\n\n` +
      `Your 14-day Investo trial has ended. Subscribe to restore full access:\n${params.billingUrl}\n`;

    const html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your 14-day Investo trial has ended.</p>
      <p><a href="${escapeHtmlAttr(params.billingUrl)}">Subscribe now</a></p>
    `;

    try {
      await this.sendEmail({ to: params.toEmail, subject, text, html });
      return true;
    } catch (err: unknown) {
      logger.warn('sendTrialExpiredEmail failed', {
        toEmail: params.toEmail,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  async sendAccountSuspendedEmail(params: {
    toEmail: string;
    toName?: string | null;
    billingUrl: string;
  }): Promise<boolean> {
    if (!isMailConfigured() || !config.mail.from) return false;

    const name = (params.toName || '').trim() || 'there';
    const subject = 'Investo account suspended — payment overdue';
    const text =
      `Hi ${name},\n\n` +
      `Your Investo account has been suspended due to overdue payment. Update billing to restore access:\n${params.billingUrl}\n`;

    const html = `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your Investo account has been suspended due to overdue payment.</p>
      <p><a href="${escapeHtmlAttr(params.billingUrl)}">Update billing</a></p>
    `;

    try {
      await this.sendEmail({ to: params.toEmail, subject, text, html });
      return true;
    } catch (err: unknown) {
      logger.warn('sendAccountSuspendedEmail failed', {
        toEmail: params.toEmail,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttr(input: string): string {
  return escapeHtml(input).replace(/\n/g, '');
}

export const emailService = new EmailService();
