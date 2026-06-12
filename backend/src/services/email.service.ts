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
