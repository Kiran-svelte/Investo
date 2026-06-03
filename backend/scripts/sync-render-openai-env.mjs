/**
 * Sync OPENAI_API_KEY (and optional OPENAI_EMBEDDING_MODEL) to Render production.
 * Reads from backend/.env or backend/.env.render-sync — never commit those files.
 *
 * Usage:
 *   $env:RENDER_API_KEY='rnd_...'
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
const auth = process.env.RENDER_API_KEY?.trim();
if (!auth) {
  console.error('Set RENDER_API_KEY');
  process.exit(1);
}

const openaiKey = process.env.OPENAI_API_KEY?.trim();
if (!openaiKey || !openaiKey.startsWith('sk-')) {
  console.error('OPENAI_API_KEY missing or invalid in backend/.env — add a valid key from https://platform.openai.com/api-keys');
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
  console.log(`Updated ${key} (${value.length} chars)`);
}

async function verifyOpenAi() {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({ model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small', input: 'test' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI verify failed ${res.status}: ${text.slice(0, 200)}`);
  }
  console.log('OpenAI embedding API verified locally');
}

await verifyOpenAi();
await putEnv('OPENAI_API_KEY', openaiKey);
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
