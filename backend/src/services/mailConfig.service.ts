import config from '../config';
import { isSesApiConfigured } from './ses-email.service';

export type MailTransport = 'smtp' | 'ses-api';

function isSmtpConfigured(): boolean {
  const smtp = config.mail.smtp;
  return Boolean(smtp.host?.trim() && Number.isFinite(smtp.port) && smtp.port > 0 && config.mail.from?.trim());
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
    return 'AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and MAIL_FROM are required for SES API email.';
  }
  return 'SMTP_HOST and MAIL_FROM are required for password reset and invite emails.';
}
