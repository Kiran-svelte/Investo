/**
 * Verify OpenAI key locally, push to Render, disable local embedding fallback, redeploy, verify prod health.
 *
 * Usage:
 *   $env:RENDER_API_KEY='rnd_...'
 *   # Set OPENAI_API_KEY=sk-... in backend/.env (new key from platform.openai.com)
 *   node scripts/sync-render-openai-env.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

for (const file of ['.env', '.env.render-sync']) {
  const p = path.join(root, file);
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, override: false });
  }
}

const SERVICE_ID = 'srv-d79itik50q8c73fjqi7g';
const BACKEND_URL = process.env.API_PUBLIC_BASE_URL || 'https://investo-backend-v2.onrender.com';
const auth = process.env.RENDER_API_KEY?.trim();
if (!auth) {
  console.error('Set RENDER_API_KEY');
  process.exit(1);
}

const openaiKey = process.env.OPENAI_API_KEY?.trim();
if (!openaiKey || !openaiKey.startsWith('sk-')) {
  console.error('OPENAI_API_KEY missing or invalid in backend/.env');
  process.exit(1);
}

const headers = {
  Authorization: auth.startsWith('Bearer ') ? auth : `Bearer ${auth}`,
  'Content-Type': 'application/json',
};

async function putEnv(key, value) {
  const res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/env-vars/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${key} failed: ${res.status} ${text}`);
  }
  console.log(`Updated ${key}`);
}

async function verifyOpenAi(label) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
      input: 'investo-health-check',
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${label} OpenAI verify failed ${res.status}: ${text.slice(0, 180)}`);
  }
  console.log(`${label} OpenAI embedding API OK`);
}

async function waitForDeploy(deployId) {
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 15000));
    const res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/deploys/${deployId}`, { headers });
    const status = await res.json();
    console.log(`Deploy status: ${status.status}`);
    if (status.status === 'live') {
      return;
    }
    if (['build_failed', 'update_failed', 'canceled'].includes(status.status)) {
      throw new Error(`Deploy failed: ${status.status}`);
    }
  }
  throw new Error('Deploy timed out');
}

async function waitForProdHealth() {
  for (let i = 0; i < 24; i += 1) {
    await new Promise((r) => setTimeout(r, 10000));
    const res = await fetch(`${BACKEND_URL}/api/health`);
    const body = await res.json();
    const emb = body?.dependencies?.property_knowledge_embeddings;
    console.log(`Health: ${body?.status} | embeddings: ${emb?.status} (${emb?.provider})`);
    if (emb?.status === 'ok' && emb?.provider === 'openai') {
      console.log('Production ready: OpenAI embeddings active.');
      return;
    }
  }
  throw new Error('Production health never reported openai embeddings. Check Render logs.');
}

await verifyOpenAi('Local');
await putEnv('OPENAI_API_KEY', openaiKey);
await putEnv('PROPERTY_KNOWLEDGE_LOCAL_EMBEDDINGS', 'false');
if (process.env.OPENAI_EMBEDDING_MODEL) {
  await putEnv('OPENAI_EMBEDDING_MODEL', process.env.OPENAI_EMBEDDING_MODEL);
}

const deployRes = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/deploys`, {
  method: 'POST',
  headers,
  body: '{}',
});
if (!deployRes.ok) {
  throw new Error(`Deploy trigger failed: ${deployRes.status}`);
}
const deploy = await deployRes.json();
console.log('Render deploy started:', deploy.id);
await waitForDeploy(deploy.id);
await waitForProdHealth();
console.log('Done. Publish property import and WhatsApp AI knowledge should use OpenAI.');
