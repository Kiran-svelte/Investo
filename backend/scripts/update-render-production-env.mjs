/**
 * Production storage + API env for Render backend (no secrets in repo).
 * Usage:
 *   $env:RENDER_API_KEY='rnd_...'
 *   $env:API_PUBLIC_BASE_URL='https://investo-backend-v2.onrender.com'
 *   $env:SUPABASE_SERVICE_ROLE_KEY='...'  # optional
 *   node scripts/update-render-production-env.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SERVICE_ID = 'srv-d79itik50q8c73fjqi7g';

function resolveRenderAuth() {
  const fromEnv = process.env.RENDER_API_KEY?.trim();
  if (fromEnv) return fromEnv.startsWith('Bearer ') ? fromEnv : `Bearer ${fromEnv}`;
  const mcpPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.cursor', 'mcp.json');
  if (fs.existsSync(mcpPath)) {
    const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    const fromMcp = mcp.mcpServers?.render?.headers?.Authorization;
    if (fromMcp) return fromMcp;
  }
  throw new Error('Set RENDER_API_KEY');
}

const auth = resolveRenderAuth();

const PATCH = {
  API_PUBLIC_BASE_URL: process.env.API_PUBLIC_BASE_URL || 'https://investo-backend-v2.onrender.com',
  PROPERTY_IMPORT_DB_UPLOAD: 'false',
  FRONTEND_BASE_URL: process.env.FRONTEND_BASE_URL || 'https://frontend-navy-eight-37.vercel.app',
  SUPABASE_PROPERTY_BUCKET: process.env.SUPABASE_PROPERTY_BUCKET || 'property-media',
  SUPABASE_AI_KNOWLEDGE_BUCKET: process.env.SUPABASE_AI_KNOWLEDGE_BUCKET || 'ai-knowledge',
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  R2_ENDPOINT: process.env.R2_ENDPOINT,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET: process.env.R2_BUCKET,
  R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL,
  R2_REGION: process.env.R2_REGION || 'auto',
};

async function api(apiPath, options = {}) {
  const res = await fetch(`https://api.render.com/v1${apiPath}`, {
    ...options,
    headers: { Authorization: auth, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${apiPath} → ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function upsert(key, value) {
  if (!value) {
    console.warn(`Skip ${key} (empty)`);
    return;
  }
  await api(`/services/${SERVICE_ID}/env-vars/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
  console.log(`Updated ${key}`);
}

for (const [key, value] of Object.entries(PATCH)) {
  await upsert(key, value);
}

await api(`/services/${SERVICE_ID}/deploys`, { method: 'POST', body: JSON.stringify({}) });
console.log('Production env updated; deploy triggered.');
