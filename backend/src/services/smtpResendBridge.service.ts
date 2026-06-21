import { SMTPServer, SMTPServerAuthentication, SMTPServerSession } from 'smtp-server';
import { simpleParser, type ParsedMail } from 'mailparser';
import config from '../config';
import logger from '../config/logger';
import { isResendConfigured, sendResendEmail } from './resend-email.service';

let smtpServer: SMTPServer | null = null;

function isBridgeEnabled(): boolean {
  return config.keycloak.enabled
    && isResendConfigured()
    && config.mail.smtpBridge.enabled;
}

function validateAuth(auth: SMTPServerAuthentication): boolean {
  const expectedUser = config.mail.smtpBridge.username;
  const expectedPass = config.mail.resend.apiKey?.trim();
  if (!expectedPass) return false;
  return auth.username === expectedUser && auth.password === expectedPass;
}

async function relayParsedMail(parsed: ParsedMail): Promise<void> {
  let toAddress = '';
  if (parsed.to) {
    const toField = Array.isArray(parsed.to) ? parsed.to[0] : parsed.to;
    toAddress = toField?.value?.[0]?.address?.trim() || '';
  }
  if (!toAddress && typeof parsed.headers.get('to') === 'string') {
    toAddress = String(parsed.headers.get('to')).split(',')[0]?.trim() || '';
  }

  if (!toAddress) {
    throw new Error('SMTP message missing recipient');
  }

  const subject = parsed.subject?.trim() || 'Investo notification';
  const textBody = typeof parsed.text === 'string' ? parsed.text.trim() : subject;
  const htmlBody = typeof parsed.html === 'string'
    ? parsed.html.trim()
    : `<p>${textBody.replace(/\n/g, '<br/>')}</p>`;

  await sendResendEmail({
    to: toAddress,
    subject,
    text: textBody,
    html: htmlBody,
  });
}

export function startSmtpResendBridge(): void {
  if (!isBridgeEnabled() || smtpServer) {
    return;
  }

  smtpServer = new SMTPServer({
    secure: false,
    authOptional: false,
    disabledCommands: ['STARTTLS'],
    banner: 'Investo SMTP bridge',
    onAuth(auth, _session, callback) {
      if (validateAuth(auth)) {
        callback(null, { user: auth.username });
        return;
      }
      callback(new Error('Invalid SMTP credentials'));
    },
    onData(stream, _session: SMTPServerSession, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        void (async () => {
          try {
            const parsed = await simpleParser(Buffer.concat(chunks));
            await relayParsedMail(parsed);
            callback();
          } catch (err) {
            logger.error('SMTP bridge relay failed', {
              error: err instanceof Error ? err.message : String(err),
            });
            callback(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      });
    },
  });

  smtpServer.listen(config.mail.smtpBridge.port, config.mail.smtpBridge.host, () => {
    logger.info('SMTP→Resend bridge listening for Keycloak mail', {
      host: config.mail.smtpBridge.host,
      port: config.mail.smtpBridge.port,
      keycloakHost: config.mail.smtpBridge.keycloakHost,
    });
  });

  smtpServer.on('error', (err) => {
    logger.error('SMTP bridge server error', { error: err.message });
  });
}

export async function stopSmtpResendBridge(): Promise<void> {
  if (!smtpServer) return;
  await new Promise<void>((resolve) => {
    smtpServer!.close(() => resolve());
  });
  smtpServer = null;
}

export function getSmtpBridgeConnectionHint(): string {
  return `${config.mail.smtpBridge.keycloakHost}:${config.mail.smtpBridge.port}`;
}

export function getSmtpBridgeHealth(): { status: 'ok' | 'down' | 'disabled'; detail: string } {
  if (!isBridgeEnabled()) {
    return { status: 'disabled', detail: 'SMTP bridge disabled or Keycloak/Resend not configured' };
  }
  if (!smtpServer) {
    return { status: 'down', detail: 'SMTP bridge not listening' };
  }
  return { status: 'ok', detail: getSmtpBridgeConnectionHint() };
}
