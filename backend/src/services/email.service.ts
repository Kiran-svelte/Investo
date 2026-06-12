import nodemailer, { Transporter } from 'nodemailer';
import config from '../config';
import logger from '../config/logger';
import { isMailConfigured } from './mailConfig.service';
import { isSesApiConfigured, sendSesEmail, verifySesApi } from './ses-email.service';

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

export type MailSendResult = {
  sent: boolean;
  reason?: string;
};

function sanitizeSmtpConfigForLogs(smtp: SmtpConfig): Record<string, unknown> {
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

/**
 * Detect if the configured SMTP host is AWS SES.
 * SES SMTP requires STARTTLS on port 587 and does not allow plain auth.
 *
 * @param host - SMTP hostname from config
 * @returns True if this is an AWS SES SMTP endpoint
 */
function isAwsSesSmtpHost(host: string): boolean {
  return host.includes('amazonaws.com') || host.includes('email-smtp.');
}

function buildTransportOptions(smtp: SmtpConfig) {
  const auth = smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined;
  const isSesSstp = isAwsSesSmtpHost(smtp.host);

  // AWS SES SMTP always uses STARTTLS on port 587 — force it
  if (isSesSstp) {
    return {
      host: smtp.host,
      port: 587,
      secure: false,        // STARTTLS — not direct TLS
      requireTLS: true,     // Mandatory STARTTLS for SES
      auth,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      tls: {
        // SES has a valid cert — enforce it
        rejectUnauthorized: true,
      },
    };
  }

  const useTls = smtp.port === 587 && !smtp.secure;

  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    ...(useTls ? { requireTLS: true } : {}),
  };
}

export class EmailService {
  private transporter: Transporter | null = null;
  private lastVerifyAt = 0;
  private lastVerifyOk = false;
  private lastVerifyDetail = '';

  private resetTransporter(): void {
    this.transporter = null;
    this.lastVerifyAt = 0;
  }

  private getTransporter(): Transporter {
    if (this.transporter) {
      return this.transporter;
    }

    const smtp = resolveSmtpConfig();

    if (!isSmtpConfigured(smtp)) {
      throw new Error('SMTP is not configured');
    }

    this.transporter = nodemailer.createTransport(buildTransportOptions(smtp));
    return this.transporter;
  }

  async verifyConnection(force = false): Promise<{ ok: boolean; detail: string }> {
    if (config.mail.transport === 'ses-api') {
      return verifySesApi();
    }

    const smtp = resolveSmtpConfig();
    if (!isSmtpConfigured(smtp)) {
      return { ok: false, detail: 'SMTP_HOST and SMTP_PORT are not configured.' };
    }
    if (!config.mail.from?.trim()) {
      return { ok: false, detail: 'MAIL_FROM is not configured.' };
    }

    const now = Date.now();
    if (!force && this.lastVerifyAt && now - this.lastVerifyAt < 5 * 60 * 1000) {
      return { ok: this.lastVerifyOk, detail: this.lastVerifyDetail };
    }

    try {
      const transporter = this.getTransporter();
      await transporter.verify();
      this.lastVerifyAt = now;
      this.lastVerifyOk = true;
      this.lastVerifyDetail = `verified (${smtp.host}:${smtp.port}).`;
      return { ok: true, detail: this.lastVerifyDetail };
    } catch (err: unknown) {
      this.resetTransporter();
      const message = err instanceof Error ? err.message : String(err);
      this.lastVerifyAt = now;
      this.lastVerifyOk = false;
      this.lastVerifyDetail = `verification failed: ${message}`;
      logger.warn('SMTP verify failed', { smtp: sanitizeSmtpConfigForLogs(smtp), error: message });
      return { ok: false, detail: this.lastVerifyDetail };
    }
  }

  /**
   * Unified send dispatcher: routes to SES API or SMTP based on MAIL_TRANSPORT.
   * All send methods MUST call this — never call sendWithRetry directly.
   *
   * @param mail - The email to send
   * @throws Error if the send fails after retries
   */
  private async sendEmail(mail: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    if (config.mail.transport === 'ses-api') {
      await sendSesEmail({ to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    } else {
      await this.sendWithRetry(mail);
    }
  }

  private async sendWithRetry(mail: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const transporter = this.getTransporter();
        await transporter.sendMail(mail);
        return;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.resetTransporter();
        if (attempt === 0) {
          logger.warn('Email send failed, retrying once', { to: mail.to, error: lastError.message });
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
    }

    throw lastError || new Error('Email send failed');
  }

  async sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<MailSendResult> {
    const smtp = resolveSmtpConfig();

    if (!isMailConfigured()) {
      logger.warn('Password reset email skipped: mail not configured', {
        userEmail: params.toEmail,
        transport: config.mail.transport,
        smtp: sanitizeSmtpConfigForLogs(smtp),
      });
      return { sent: false, reason: 'smtp_not_configured' };
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
      await this.sendEmail({
        from: config.mail.from,
        to: params.toEmail,
        subject,
        text,
        html,
      });

      logger.info('Password reset email sent', {
        userEmail: params.toEmail,
        transport: config.mail.transport,
      });
      return { sent: true };
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
    const smtp = resolveSmtpConfig();
    if (!isMailConfigured() || !config.mail.from) {
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

    await this.sendEmail({
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

    if (!isMailConfigured() || !config.mail.from) {
      logger.warn('Re-engagement email skipped: SMTP not configured', {
        userEmail: params.toEmail,
        smtp: sanitizeSmtpConfigForLogs(smtp),
      });
      return false;
    }

    const greetingName = (params.toName || '').trim() || 'there';
    const text = `Hi ${greetingName},\n\n${params.bodyText}`;
    const html = `<p>Hi ${escapeHtml(greetingName)},</p><p>${escapeHtml(params.bodyText).replace(/\n/g, '<br>')}</p>`;

    await this.sendEmail({
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
