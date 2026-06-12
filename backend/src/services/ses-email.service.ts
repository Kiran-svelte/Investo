import { GetAccountSendingEnabledCommand, SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import config from '../config';
import logger from '../config/logger';

let client: SESClient | null = null;

function getSesClient(): SESClient {
  if (!client) {
    const { accessKeyId, secretAccessKey, region } = config.mail.aws;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('SES API credentials are not configured');
    }

    client = new SESClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }
  return client;
}

export function isSesApiConfigured(): boolean {
  return Boolean(
    config.mail.aws.accessKeyId
    && config.mail.aws.secretAccessKey
    && config.mail.from?.trim(),
  );
}

export async function verifySesApi(): Promise<{ ok: boolean; detail: string }> {
  if (!isSesApiConfigured()) {
    return { ok: false, detail: 'MAIL_AWS_* or AWS IAM keys and MAIL_FROM are required for SES API.' };
  }
  try {
    const res = await getSesClient().send(new GetAccountSendingEnabledCommand({}));
    const enabled = res.Enabled === true;
    const keyHint = config.mail.aws.usesDedicatedMailKeys ? 'dedicated MAIL_AWS_* keys' : 'shared AWS IAM keys';
    return enabled
      ? { ok: true, detail: `ready (${config.mail.aws.region}, ${keyHint}).` }
      : { ok: false, detail: 'SES sending is disabled for this AWS account.' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('SES API verify failed', {
      error: message,
      region: config.mail.aws.region,
      usesDedicatedMailKeys: config.mail.aws.usesDedicatedMailKeys,
    });
    const hint = message.includes('AccessDenied') || message.includes('not authorized')
      ? ' Grant ses:SendEmail to the IAM user or set MAIL_AWS_ACCESS_KEY_ID / MAIL_AWS_SECRET_ACCESS_KEY with SES permissions.'
      : '';
    return { ok: false, detail: `SES API verify failed: ${message}${hint}` };
  }
}

export async function sendSesEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  if (!isSesApiConfigured()) {
    throw new Error('SES API is not configured (set MAIL_FROM and MAIL_AWS_* or AWS IAM keys with ses:SendEmail)');
  }

  try {
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('SES SendEmail failed', {
      to: input.to,
      from: config.mail.from,
      region: config.mail.aws.region,
      error: message,
    });
    if (message.includes('Email address is not verified') || message.includes('MessageRejected')) {
      throw new Error(`SES rejected the send: verify MAIL_FROM (${config.mail.from}) in region ${config.mail.aws.region}. ${message}`);
    }
    if (message.includes('AccessDenied') || message.includes('not authorized')) {
      throw new Error(
        'SES SendEmail permission denied. Use IAM keys with ses:SendEmail (MAIL_AWS_ACCESS_KEY_ID / MAIL_AWS_SECRET_ACCESS_KEY) — storage-only S3 keys cannot send mail.',
      );
    }
    throw err instanceof Error ? err : new Error(message);
  }
}
