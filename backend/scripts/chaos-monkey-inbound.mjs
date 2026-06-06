/**
 * Chaos-monkey inbound simulator — fires varied buyer + staff-like messages
 * against a local or prod webhook to detect duplicate outbound sends.
 *
 * Usage:
 *   API_BASE=http://127.0.0.1:3000/api npx tsx scripts/chaos-monkey-inbound.mjs
 *   API_BASE=https://investo-backend-production.up.railway.app/api npx tsx scripts/chaos-monkey-inbound.mjs --phone 919000089500
 */
const BASE = (process.env.API_BASE || 'http://127.0.0.1:3000/api').replace(/\/$/, '');
const PHONE = (process.env.CHAOS_PHONE || '919000089500').replace(/\D/g, '');
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID || '1090528010807708';

const MESSAGES = [
  'Hi',
  'Hello',
  'Hey',
  'Hi there',
  'What is the price for 3BHK?',
  'My budget is 1.2 crore Whitefield',
  "What's my budget preference?",
  'Book a site visit for next Sunday 2pm',
  'Please call me back, I want a human',
  'visits today',
  'new leads today',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendWebhook(body, idx) {
  const msgId = `wamid.chaos.${Date.now()}.${idx}.${Math.random().toString(36).slice(2, 6)}`;
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'chaos-monkey',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: 'Chaos User' } }],
          messages: [{
            from: PHONE,
            id: msgId,
            type: 'text',
            text: { body },
          }],
        },
      }],
    }],
  };
  const res = await fetch(`${BASE}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { ok: res.status === 200, status: res.status, msgId, body };
}

async function main() {
  console.log(`Chaos monkey → ${BASE}/webhook phone=${PHONE}`);
  const results = [];
  for (let i = 0; i < MESSAGES.length; i++) {
    const msg = MESSAGES[i];
    const r = await sendWebhook(msg, i);
    results.push(r);
    console.log(`[${i + 1}/${MESSAGES.length}] ${r.ok ? 'OK' : 'FAIL'} ${r.status} "${msg}" id=${r.msgId}`);
    await sleep(8000);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nDone: ${results.length - failed.length}/${results.length} accepted`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
