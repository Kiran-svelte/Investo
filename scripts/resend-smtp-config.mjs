/**
 * Shared Resend SMTP settings for Keycloak realm email and platform scripts.
 *
 * Resend SMTP: https://resend.com/docs/send-with-smtp
 */
export function parseResendSmtpConfig(env = process.env) {
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  const mailFrom = String(env.MAIL_FROM || '').trim();

  if (!apiKey || !mailFrom) {
    return null;
  }

  return {
    apiKey,
    mailFrom,
    keycloakSmtpServer: {
      host: env.SMTP_BRIDGE_HOST || 'investo-backend.railway.internal',
      port: String(env.SMTP_BRIDGE_PORT || '2525'),
      from: mailFrom,
      fromDisplayName: 'Investo',
      replyTo: mailFrom.match(/<([^>]+)>/)?.[1] || mailFrom,
      envelopeFrom: mailFrom.match(/<([^>]+)>/)?.[1] || mailFrom,
      ssl: 'false',
      starttls: 'false',
      auth: 'true',
      authType: 'password',
      user: 'resend',
      password: apiKey,
    },
  };
}

export function getResendSmtpMissingDetail(env = process.env) {
  const missing = [];
  if (!String(env.RESEND_API_KEY || '').trim()) missing.push('RESEND_API_KEY');
  if (!String(env.MAIL_FROM || '').trim()) missing.push('MAIL_FROM');
  return missing.length ? `${missing.join(' and ')} required` : '';
}
