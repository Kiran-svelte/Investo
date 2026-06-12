import { Resend } from 'resend';
import config from '../config';
import logger from '../config/logger';

let client: Resend | null = null;

function getResendClient(): Resend {
  if (!client) {
    const apiKey = config.mail.resend.apiKey;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    client = new Resend(apiKey);
  }
  return client;
}

export function isResendConfigured(): boolean {
  return Boolean(config.mail.resend.apiKey?.trim() && config.mail.from?.trim());
}

export async function verifyResendApi(): Promise<{ ok: boolean; detail: string }> {
  if (!isResendConfigured()) {
    return { ok: false, detail: 'RESEND_API_KEY and MAIL_FROM are required for Resend email.' };
  }

  try {
    const response = await fetch('https://api.resend.com/domains', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.mail.resend.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      return { ok: true, detail: 'Resend API key is valid.' };
    }

    // Send-only API keys can deliver mail but may not authorize the domains endpoint.
    if (response.status === 401 || response.status === 403) {
      return {
        ok: true,
        detail: 'Resend configured (send-only API key).',
      };
    }

    const body = await response.text();
    return { ok: false, detail: `Resend API check failed (${response.status}): ${body.slice(0, 200)}` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Resend verify failed', { error: message });
    return { ok: false, detail: `Resend verify failed: ${message}` };
  }
}

export async function sendResendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ id: string | null }> {
  if (!isResendConfigured()) {
    throw new Error('Resend is not configured (set RESEND_API_KEY and MAIL_FROM)');
  }

  const resend = getResendClient();
  const { data, error } = await resend.emails.send({
    from: config.mail.from.trim(),
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });

  if (error) {
    logger.error('Resend send failed', {
      to: input.to,
      from: config.mail.from,
      error: error.message,
      name: error.name,
    });

    if (error.message?.includes('domain') || error.message?.includes('verified')) {
      throw new Error(
        `Resend rejected the sender. Verify MAIL_FROM (${config.mail.from}) as a domain or sender in the Resend dashboard. ${error.message}`,
      );
    }

    throw new Error(error.message || 'Resend send failed');
  }

  return { id: data?.id ?? null };
}
