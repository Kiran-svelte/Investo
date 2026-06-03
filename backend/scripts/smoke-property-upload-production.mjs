/**
 * End-to-end property import upload smoke test against production API.
 */
const API = process.env.API_BASE || 'https://investo-backend-v2.onrender.com/api';
const EMAIL = process.env.SMOKE_EMAIL || 'admin@demorealty.in';
const PASSWORD = process.env.SMOKE_PASSWORD || 'demo@123';

async function api(path, options = {}, token) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

const login = await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const token = login.data?.access_token || login.data?.token;
if (!token) {
  throw new Error('Login did not return token');
}

const draftRes = await api('/property-imports/drafts', {
  method: 'POST',
  body: JSON.stringify({ draft_data: { name: 'Smoke Upload Test' } }),
}, token);
const draftId = draftRes.data?.id;
if (!draftId) {
  throw new Error('Draft create failed');
}

const tinyPdf = Buffer.from(
  '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
  'utf8',
);

const registerRes = await api(`/property-imports/drafts/${draftId}/uploads`, {
  method: 'POST',
  body: JSON.stringify({
    file_name: 'smoke-test.pdf',
    mime_type: 'application/pdf',
    file_size: tinyPdf.length,
    asset_type: 'brochure',
  }),
}, token);

const upload = registerRes.data?.upload;
if (!upload?.upload_url) {
  throw new Error('Register upload missing upload_url');
}

console.log('storage_key:', registerRes.data?.media?.storageKey);
console.log('upload_url host:', new URL(upload.upload_url).host);

let putRes = await fetch(upload.upload_url, {
  method: 'PUT',
  headers: { 'Content-Type': upload.content_type || 'application/pdf' },
  body: tinyPdf,
});

if (!putRes.ok && upload.fallback_upload_url && upload.fallback_upload_url !== upload.upload_url) {
  console.log('Primary PUT failed; trying fallback API upload');
  putRes = await fetch(upload.fallback_upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': upload.content_type || 'application/pdf' },
    body: tinyPdf,
  });
}

if (!putRes.ok) {
  const errText = await putRes.text();
  throw new Error(`Upload PUT failed ${putRes.status}: ${errText}`);
}

const confirmRes = await api(`/property-imports/drafts/${draftId}/uploads/confirm`, {
  method: 'POST',
  body: JSON.stringify({ upload_token: upload.upload_token }),
}, token);

const mediaStatus = confirmRes.data?.media?.status;
if (!['queued_for_extraction', 'extracted', 'verified', 'uploaded'].includes(mediaStatus)) {
  throw new Error(`Unexpected media status after confirm: ${mediaStatus}`);
}

const provider = registerRes.data?.media?.storageKey?.startsWith('aws://') ? 'aws' : 'other';
console.log('SMOKE_OK', { draftId, provider, mediaStatus, storageKey: registerRes.data?.media?.storageKey });
