#!/usr/bin/env node
/**
 * Send a test email via configured SMTP (SES) — values from env only.
 * Usage: TO_EMAIL=you@example.com node scripts/test-ses-email.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { deriveSesSmtpPassword } from './lib/ses-smtp-password.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.render-sync') });

const region = process.env.AWS_REGION || 'eu-north-1';
const to = process.env.TO_EMAIL || process.env.SUPER_ADMIN_EMAIL || 'big.investo.sol@gmail.com';
const from = process.env.MAIL_FROM || 'Investo <big.investo.sol@gmail.com>';
const user = process.env.SMTP_USER || process.env.AWS_ACCESS_KEY_ID;
const pass = process.env.SMTP_PASS || (process.env.AWS_SECRET_ACCESS_KEY
  ? deriveSesSmtpPassword(process.env.AWS_SECRET_ACCESS_KEY, region)
  : '');

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || `email-smtp.${region}.amazonaws.com`,
  port: 587,
  secure: false,
  requireTLS: true,
  auth: { user, pass },
});

const info = await transport.sendMail({
  from,
  to,
  subject: 'Investo platform reset — SES test',
  text: 'If you received this, AWS SES SMTP is working for the fresh Investo platform.',
});

console.log('Sent:', info.messageId);
