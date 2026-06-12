import config from '../config';
import { isSesApiConfigured } from './ses-email.service';

export type MailTransport = 'smtp' | 'ses-api';

function isAwsSesSmtpHost(host: string): boolean {
  return host.includes('amazonaws.com') || host.includes('email-smtp.');
}

function isSmtpConfigured(): boolean {
  const smtp = config.mail.smtp;
  const host = smtp.host?.trim() || '';
  const hasHostAndPort = Boolean(host && Number.isFinite(smtp.port) && smtp.port > 0);
  const hasFrom = Boolean(config.mail.from?.trim());

  if (!hasHostAndPort || !hasFrom) {
    return false;
  }

  if (isAwsSesSmtpHost(host) || smtp.user?.trim()) {
    return Boolean(smtp.user?.trim() && smtp.pass);
  }

  return true;
}

/**
 * Whether outbound transactional email can be sent with the active transport.
 */
export function isMailConfigured(): boolean {
  if (config.mail.transport === 'ses-api') {
    return isSesApiConfigured();
  }
  return isSmtpConfigured();
}

export function getMailTransportLabel(): string {
  return config.mail.transport === 'ses-api' ? 'SES API' : 'SMTP';
}

export function getMailNotConfiguredDetail(): string {
  if (config.mail.transport === 'ses-api') {
    return 'Set MAIL_FROM plus MAIL_AWS_ACCESS_KEY_ID / MAIL_AWS_SECRET_ACCESS_KEY (or AWS IAM keys with ses:SendEmail) for SES API email.';
  }
  return 'Set SMTP_HOST, SMTP_USER, SMTP_PASS, and MAIL_FROM for password reset and invite emails.';
}
