/**
 * Derive AWS SES SMTP password from IAM secret access key (SigV4).
 * @see https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html
 */
import crypto from 'crypto';

export function deriveSesSmtpPassword(secretAccessKey, region = 'eu-north-1') {
  const DATE = '11111111';
  const SERVICE = 'ses';
  const TERMINAL = 'aws4_request';
  const MESSAGE = 'SendRawEmail';
  const VERSION = 0x04;

  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();

  let signature = hmac(Buffer.from(`AWS4${secretAccessKey}`, 'utf8'), DATE);
  signature = hmac(signature, region);
  signature = hmac(signature, SERVICE);
  signature = hmac(signature, TERMINAL);
  signature = hmac(signature, MESSAGE);

  return Buffer.concat([Buffer.from([VERSION]), signature]).toString('base64');
}
