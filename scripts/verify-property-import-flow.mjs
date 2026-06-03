/**
 * API smoke test: auth, health embeddings, property import draft reachability.
 * Usage: node scripts/verify-property-import-flow.mjs [draftId]
 */
const API = process.env.API_BASE || 'https://investo-backend-v2.onrender.com/api';
const EMAIL = process.env.E2E_EMAIL || 'admin@demorealty.in';
const PASSWORD = process.env.E2E_PASSWORD || 'demo@123';
const draftId = process.argv[2] || process.env.E2E_PROPERTY_IMPORT_DRAFT_ID;

async function main() {
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) {
    throw new Error(`login failed: ${loginRes.status}`);
  }
  const login = await loginRes.json();
  const token = login?.data?.tokens?.access_token;
  if (!token) {
    throw new Error('login response missing access token');
  }
  console.log('OK login');

  const healthRes = await fetch(`${API}/health`);
  const health = await healthRes.json();
  const emb = health?.dependencies?.property_knowledge_embeddings;
  if (emb?.status !== 'ok' || emb?.provider !== 'openai') {
    throw new Error(`embeddings not ready: ${JSON.stringify(emb)}`);
  }
  console.log('OK health embeddings', emb.detail);

  let targetDraftId = draftId;
  if (!targetDraftId) {
    const listRes = await fetch(`${API}/property-imports/drafts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listBody = await listRes.json();
    const drafts = listBody?.data || [];
    const ready = drafts.find((d) => d.extractionStatus === 'extracted' || d.extraction_status === 'extracted');
    targetDraftId = ready?.id;
    console.log('drafts in progress', drafts.length, ready ? `using ${ready.id}` : 'none extracted');
  }

  if (!targetDraftId) {
    console.log('SKIP draft (none at publish step)');
    return;
  }

  const draftRes = await fetch(`${API}/property-imports/drafts/${targetDraftId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!draftRes.ok) {
    throw new Error(`draft fetch failed: ${draftRes.status} ${await draftRes.text()}`);
  }
  const draftBody = await draftRes.json();
  const draft = draftBody?.data;
  console.log('OK draft', {
    id: draft?.id,
    status: draft?.status,
    extractionStatus: draft?.extractionStatus,
  });

  if (draft?.extractionStatus !== 'extracted') {
    throw new Error(`draft not extracted: ${draft?.extractionStatus}`);
  }
  console.log('OK property import flow prerequisites');
}

main().catch((err) => {
  console.error('FAIL', err.message);
  process.exit(1);
});
