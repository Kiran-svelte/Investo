/** Fire staff copilot webhook directly (bypasses phone). */
const msgId = `wamid.manual.staff.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
const payload = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'manual-staff',
    changes: [{
      field: 'messages',
      value: {
        metadata: { phone_number_id: '1090528010807708', display_phone_number: '+15551642552' },
        contacts: [{ profile: { name: 'Kiran Sales' } }],
        messages: [{ from: '919036165603', id: msgId, type: 'text', text: { body: process.argv[2] || 'visits today' } }],
      },
    }],
  }],
};
const res = await fetch('https://investo-backend-production.up.railway.app/api/webhook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const body = await res.text();
console.log(JSON.stringify({ status: res.status, msgId, text: process.argv[2] || 'visits today', body: body.slice(0, 800) }, null, 2));
