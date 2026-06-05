import { emailService } from './email.service';
import {
  getMailNotConfiguredDetail,
  getMailTransportLabel,
  isMailConfigured,
} from './mailConfig.service';

export interface MailServiceHealth {
  status: 'ok' | 'warn' | 'down';
  configured: boolean;
  detail: string;
}

export { isMailConfigured };

export async function getMailServiceHealth(): Promise<MailServiceHealth> {
  if (!isMailConfigured()) {
    return {
      status: 'warn',
      configured: false,
      detail: getMailNotConfiguredDetail(),
    };
  }

  const verified = await emailService.verifyConnection();
  if (verified.ok) {
    return {
      status: 'ok',
      configured: true,
      detail: `${getMailTransportLabel()}: ${verified.detail}`,
    };
  }

  return {
    status: 'down',
    configured: true,
    detail: `${getMailTransportLabel()}: ${verified.detail}`,
  };
}
