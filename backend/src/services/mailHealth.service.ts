import { emailService } from './email.service';
import {
  getMailNotConfiguredDetail,
  getMailTransportLabel,
  isMailConfigured,
} from './mailConfig.service';
import { getSmtpBridgeHealth } from './smtpResendBridge.service';

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

  const fromAddress = (process.env.MAIL_FROM || '').toLowerCase();
  if (process.env.NODE_ENV === 'production' && fromAddress.includes('onboarding@resend.dev')) {
    return {
      status: 'down',
      configured: true,
      detail:
        'Resend sandbox sender (onboarding@resend.dev) only delivers to the Resend account owner. Set MAIL_FROM to a verified domain address (e.g. no-reply@biginvesto.online).',
    };
  }

  const bridge = getSmtpBridgeHealth();
  if (bridge.status === 'down') {
    return {
      status: 'down',
      configured: true,
      detail: `Keycloak SMTP bridge: ${bridge.detail}`,
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
