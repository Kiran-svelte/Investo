import crypto from 'crypto';

interface VerificationCase {
  name: string;
  signature: string;
  expectedStatus: number;
}

async function run(): Promise<void> {
  const webhookUrl = process.env.WEBHOOK_URL;
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!webhookUrl) {
    throw new Error('WEBHOOK_URL is required');
  }
  if (!appSecret) {
    throw new Error('WHATSAPP_APP_SECRET is required');
  }

  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'proof-entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'proof-phone-number-id' },
              contacts: [{ profile: { name: 'Proof User' } }],
              messages: [
                {
                  id: `proof-msg-${Date.now()}`,
                  from: '919999999999',
                  type: 'text',
                  text: { body: 'proof-message' },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const validSignature = `sha256=${crypto
    .createHmac('sha256', appSecret)
    .update(JSON.stringify(payload))
    .digest('hex')}`;

  const invalidSignature = 'sha256=0000000000000000000000000000000000000000000000000000000000000000';

  const cases: VerificationCase[] = [
    {
      name: 'valid-signature',
      signature: validSignature,
      expectedStatus: 200,
    },
    {
      name: 'invalid-signature',
      signature: invalidSignature,
      expectedStatus: 403,
    },
  ];

  let passed = 0;

  for (const testCase of cases) {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': testCase.signature,
      },
      body: JSON.stringify(payload),
    });

    const body = await response.text();
    const ok = response.status === testCase.expectedStatus;

    if (ok) {
      passed += 1;
    }

    // Keep output concise so it can be attached as deployment evidence.
    console.log(
      JSON.stringify({
        case: testCase.name,
        expected_status: testCase.expectedStatus,
        actual_status: response.status,
        passed: ok,
        response: body,
      }),
    );
  }

  if (passed !== cases.length) {
    throw new Error(`Webhook verification failed (${passed}/${cases.length} cases passed)`);
  }

  console.log(JSON.stringify({ result: 'PASS', passed, total: cases.length }));
}

run().catch((err) => {
  console.error(JSON.stringify({ result: 'FAIL', error: err.message }));
  process.exit(1);
});
