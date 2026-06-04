import { GetAccountSendingEnabledCommand, SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import config from '../config';
import logger from '../config/logger';

let client: SESClient | null = null;

function getSesClient(): SESClient {
  if (!client) {
    client = new SESClient({
      region: config.storage.awsRegion,
      credentials: {
        accessKeyId: config.storage.awsAccessKeyId,
        secretAccessKey: config.storage.awsSecretAccessKey,
      },
    });
  }
  return client;
}

export function isSesApiConfigured(): boolean {
  return Boolean(
    config.storage.awsAccessKeyId
    && config.storage.awsSecretAccessKey
    && config.mail.from?.trim(),
  );
}

export async function verifySesApi(): Promise<{ ok: boolean; detail: string }> {
  if (!isSesApiConfigured()) {
    return { ok: false, detail: 'AWS credentials or MAIL_FROM not configured for SES API.' };
  }
  try {
    const res = await getSesClient().send(new GetAccountSendingEnabledCommand({}));
    const enabled = res.Enabled === true;
    return enabled
      ? { ok: true, detail: `SES API ready (${config.storage.awsRegion}).` }
      : { ok: false, detail: 'SES sending is disabled for this AWS account.' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('SES API verify failed', { error: message });
    return { ok: false, detail: `SES API verify failed: ${message}` };
  }
}

export async function sendSesEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  if (!isSesApiConfigured()) {
    throw new Error('SES API is not configured');
  }

  await getSesClient().send(new SendEmailCommand({
    Source: config.mail.from.trim(),
    Destination: { ToAddresses: [input.to] },
    Message: {
      Subject: { Data: input.subject, Charset: 'UTF-8' },
      Body: {
        Text: { Data: input.text, Charset: 'UTF-8' },
        Html: { Data: input.html, Charset: 'UTF-8' },
      },
    },
  }));
}
