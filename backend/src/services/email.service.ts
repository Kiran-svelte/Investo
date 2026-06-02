import nodemailer, { Transporter } from 'nodemailer';
import config from '../config';
import logger from '../config/logger';

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

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
};

function sanitizeSmtpConfigForLogs(smtp: SmtpConfig): Record<string, any> {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    hasAuth: Boolean(smtp.user && smtp.pass),
  };
}

function isSmtpConfigured(smtp: SmtpConfig): boolean {
  return Boolean(smtp.host) && Number.isFinite(smtp.port) && smtp.port > 0;
}

function resolveSmtpConfig(): SmtpConfig {
  return {
    host: config.mail.smtp.host,
    port: config.mail.smtp.port,
    secure: config.mail.smtp.secure,
    user: config.mail.smtp.user || undefined,
    pass: config.mail.smtp.pass || undefined,
  };
}

export class EmailService {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    const smtp = resolveSmtpConfig();

    if (!isSmtpConfigured(smtp)) {
      throw new Error('SMTP is not configured');
    }

    const auth = smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined;

    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth,
    });

    return this.transporter;
  }

  async sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<void> {
    const smtp = resolveSmtpConfig();

    if (!isSmtpConfigured(smtp)) {
      logger.warn('Password reset email skipped: SMTP not configured', {
        userEmail: params.toEmail,
        smtp: sanitizeSmtpConfigForLogs(smtp),
      });
      return;
    }

    if (!config.mail.from) {
      logger.warn('Password reset email skipped: MAIL_FROM not configured', {
        userEmail: params.toEmail,
        smtp: sanitizeSmtpConfigForLogs(smtp),
      });
      return;
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

    const transporter = this.getTransporter();

    await transporter.sendMail({
      from: config.mail.from,
      to: params.toEmail,
      subject,
      text,
      html,
    });

    logger.info('Password reset email sent', {
      userEmail: params.toEmail,
    });
  }

  async sendWelcomeInviteEmail(params: WelcomeInviteEmailParams): Promise<boolean> {
    const smtp = resolveSmtpConfig();
    if (!isSmtpConfigured(smtp) || !config.mail.from) {
      logger.warn('Welcome invite email skipped: SMTP not configured', {
        userEmail: params.toEmail,
        smtp: sanitizeSmtpConfigForLogs(smtp),
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

    await this.getTransporter().sendMail({
      from: config.mail.from,
      to: params.toEmail,
      subject,
      text,
      html,
    });

    logger.info('Welcome invite email sent', { userEmail: params.toEmail });
    return true;
  }

  async sendReEngagementEmail(params: ReEngagementEmailParams): Promise<boolean> {
    const smtp = resolveSmtpConfig();

    if (!isSmtpConfigured(smtp) || !config.mail.from) {
      logger.warn('Re-engagement email skipped: SMTP not configured', {
        userEmail: params.toEmail,
        smtp: sanitizeSmtpConfigForLogs(smtp),
      });
      return false;
    }

    const greetingName = (params.toName || '').trim() || 'there';
    const text = `Hi ${greetingName},\n\n${params.bodyText}`;
    const html = `<p>Hi ${escapeHtml(greetingName)},</p><p>${escapeHtml(params.bodyText).replace(/\n/g, '<br>')}</p>`;

    await this.getTransporter().sendMail({
      from: config.mail.from,
      to: params.toEmail,
      subject: params.subject,
      text,
      html,
    });

    logger.info('Re-engagement email sent', { userEmail: params.toEmail });
    return true;
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
