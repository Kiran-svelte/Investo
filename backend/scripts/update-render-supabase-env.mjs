/**
 * Point Render investo services at Supabase (merge env vars, then redeploy).
 * Usage: node scripts/update-render-supabase-env.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(backendRoot, '.env') });

function resolveRenderAuth() {
  const fromEnv = process.env.RENDER_API_KEY?.trim();
  if (fromEnv) {
    return fromEnv.startsWith('Bearer ') ? fromEnv : `Bearer ${fromEnv}`;
  }
  const mcpPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.cursor', 'mcp.json');
  if (fs.existsSync(mcpPath)) {
    const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    const fromMcp = mcp.mcpServers?.render?.headers?.Authorization;
    if (fromMcp) return fromMcp;
  }
  throw new Error('Set RENDER_API_KEY or configure Render token in ~/.cursor/mcp.json');
}

const auth = resolveRenderAuth();

const SERVICES = [
  'srv-d79itik50q8c73fjqi7g', // investo-backend-v2
  'srv-d79j10uuk2gs73eeb550', // investo-frontend-v2 (Render static)
];

const PATCH_KEYS = {
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_PROJECT_REF: process.env.SUPABASE_PROJECT_REF,
  NEON_KEEPALIVE_ENABLED: 'false',
};

async function api(path, options = {}) {
  const res = await fetch(`https://api.render.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json',
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

async function upsertEnvVar(serviceId, key, value) {
  if (!value) {
    console.warn(`Skip ${key} (empty)`);
    return;
  }
  await api(`/services/${serviceId}/env-vars/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
  console.log(`  ${serviceId}: ${key} updated`);
}

async function triggerDeploy(serviceId) {
  await api(`/services/${serviceId}/deploys`, {
    method: 'POST',
    body: JSON.stringify({ clearCache: 'do_not_clear' }),
  });
  console.log(`  ${serviceId}: deploy triggered`);
}

for (const serviceId of SERVICES) {
  console.log(`Updating ${serviceId}...`);
  for (const [key, value] of Object.entries(PATCH_KEYS)) {
    await upsertEnvVar(serviceId, key, value);
  }
  await triggerDeploy(serviceId);
}

console.log('Done. Render services pointed at Supabase.');
