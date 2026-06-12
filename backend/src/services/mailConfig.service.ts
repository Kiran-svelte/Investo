import config from '../config';
import { isResendConfigured } from './resend-email.service';

export type MailTransport = 'resend';

/**
 * Whether outbound transactional email can be sent with Resend.
 */
export function isMailConfigured(): boolean {
  return isResendConfigured();
}

export function getMailTransportLabel(): string {
  return 'Resend';
}

export function getMailNotConfiguredDetail(): string {
  return 'RESEND_API_KEY and MAIL_FROM are required for password reset and invite emails.';
}
