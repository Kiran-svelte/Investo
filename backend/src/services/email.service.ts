import nodemailer, { Transporter } from 'nodemailer';
import config from '../config';
import logger from '../config/logger';

export type PasswordResetEmailParams = {
  toEmail: string;
  toName?: string | null;
  resetUrl: string;
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
