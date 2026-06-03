import config from '../config';
import { emailService } from './email.service';

export interface MailServiceHealth {
  status: 'ok' | 'warn' | 'down';
  configured: boolean;
  detail: string;
}

export function isMailConfigured(): boolean {
  return Boolean(config.mail.smtp.host?.trim() && config.mail.from?.trim());
}

export async function getMailServiceHealth(): Promise<MailServiceHealth> {
  if (!isMailConfigured()) {
    return {
      status: 'warn',
      configured: false,
      detail: 'SMTP_HOST and MAIL_FROM are required for password reset and invite emails.',
    };
  }

  const verified = await emailService.verifyConnection();
  if (verified.ok) {
    return {
      status: 'ok',
      configured: true,
      detail: verified.detail,
    };
  }

  return {
    status: 'down',
    configured: true,
    detail: verified.detail,
  };
}
