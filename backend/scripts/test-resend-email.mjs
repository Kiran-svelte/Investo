#!/usr/bin/env node
/**
 * Send a test email via Resend HTTP API.
 * Usage:
 *   RESEND_API_KEY=re_... MAIL_FROM='Investo <onboarding@resend.dev>' \
 *   node scripts/test-resend-email.mjs recipient@example.com
 */
import { Resend } from 'resend';

const to = process.argv[2] || process.env.TEST_EMAIL_TO;
const from = process.env.MAIL_FROM || 'Investo <onboarding@resend.dev>';
const apiKey = process.env.RESEND_API_KEY?.trim();

if (!to) {
  console.error('Usage: node scripts/test-resend-email.mjs recipient@example.com');
  process.exit(1);
}
if (!apiKey) {
  console.error('Set RESEND_API_KEY');
  process.exit(1);
}

const resend = new Resend(apiKey);

async function main() {
  const domains = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  console.log(`Resend domains API: ${domains.status} ${domains.statusText}`);

  const { data, error } = await resend.emails.send({
    from,
    to,
    subject: 'Investo Resend test',
    text: 'If you received this, Resend email is working for Investo.',
    html: '<p>If you received this, <strong>Resend email is working</strong> for Investo.</p>',
  });

  if (error) {
    throw new Error(error.message);
  }

  console.log(`Test email queued. Resend id: ${data?.id ?? 'unknown'}`);
  console.log(`To: ${to}`);
  console.log(`From: ${from}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
