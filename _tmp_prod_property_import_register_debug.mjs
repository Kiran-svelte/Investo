const base = process.env.API_BASE_URL || 'https://investo-backend-v2.onrender.com/api';
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

function pick(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  }
  return undefined;
}

async function readJsonSafe(res) {
  const text = await res.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    return text || null;
  }
}

async function main() {
  if (!email || !password) {
    console.log(JSON.stringify({ error: 'Missing E2E_EMAIL or E2E_PASSWORD' }, null, 2));
    process.exit(2);
  }

  const loginRes = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const loginBody = await readJsonSafe(loginRes);
  if (!loginRes.ok) {
    console.log(JSON.stringify({ step: 'login', status: loginRes.status, body: loginBody }, null, 2));
    process.exit(1);
  }

  const accessToken = loginBody?.data?.tokens?.access_token;
  if (!accessToken) {
    console.log(JSON.stringify({ step: 'login', status: loginRes.status, error: 'Missing access_token in login response' }, null, 2));
    process.exit(1);
  }

  const draftRes = await fetch(`${base}/property-imports/drafts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ max_retries: 3 }),
  });

  const draftBody = await readJsonSafe(draftRes);
  if (!draftRes.ok) {
    console.log(JSON.stringify({ step: 'create_draft', status: draftRes.status, body: draftBody }, null, 2));
    process.exit(1);
  }

  const draftId = draftBody?.data?.id ?? draftBody?.id;
  if (!draftId) {
    console.log(JSON.stringify({ step: 'create_draft', status: draftRes.status, error: 'Missing draft id', body: draftBody }, null, 2));
    process.exit(1);
  }

  const registerRes = await fetch(`${base}/property-imports/drafts/${draftId}/uploads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      file_name: 'Broucher.pdf',
      mime_type: 'application/pdf',
      file_size: 13940189,
      asset_type: 'brochure',
    }),
  });

  const registerBody = await readJsonSafe(registerRes);

  // Sanitize success payload: never print upload_url or upload_token.
  let safeBody = registerBody;
  const data = registerBody?.data;
  if (registerRes.ok && data && typeof data === 'object') {
    safeBody = {
      ...registerBody,
      data: {
        media: data.media
          ? {
              id: data.media.id,
              status: data.media.status,
              mimeType: data.media.mimeType,
              fileSize: data.media.fileSize,
              storageKey: data.media.storageKey,
            }
          : null,
        upload: data.upload
          ? {
              key: data.upload.key,
              expires_in_seconds: data.upload.expires_in_seconds,
              content_type: data.upload.content_type,
              public_url: data.upload.public_url,
            }
          : null,
      },
    };
  }

  console.log(
    JSON.stringify(
      {
        step: 'register_upload',
        status: registerRes.status,
        ok: registerRes.ok,
        draftId,
        error: !registerRes.ok ? (pick(registerBody, ['error', 'message']) || null) : null,
        body: safeBody,
      },
      null,
      2,
    ),
  );

  process.exit(registerRes.ok ? 0 : 2);
}

main().catch((err) => {
  console.log(JSON.stringify({ step: 'exception', error: err?.message || String(err) }, null, 2));
  process.exit(1);
});
