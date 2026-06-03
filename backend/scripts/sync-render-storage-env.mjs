/**
 * Sync storage-related env vars to Render and optionally provision AWS IAM keys.
 * Usage: node scripts/sync-render-storage-env.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(backendRoot, '.env') });
dotenv.config({ path: path.join(backendRoot, '.env.aws-admin') });
dotenv.config({ path: path.join(backendRoot, '.env.render-sync') });

const SERVICE_ID = 'srv-d79itik50q8c73fjqi7g';

function resolveRenderAuth() {
  const fromEnv = process.env.RENDER_API_KEY?.trim();
  if (fromEnv) return fromEnv.startsWith('Bearer ') ? fromEnv : `Bearer ${fromEnv}`;
  const mcpPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.cursor', 'mcp.json');
  if (fs.existsSync(mcpPath)) {
    const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    const fromMcp = mcp.mcpServers?.render?.headers?.Authorization;
    if (fromMcp) return fromMcp.replace(/^Bearer\s+/i, '');
  }
  throw new Error('Set RENDER_API_KEY');
}

async function upsert(auth, key, value) {
  if (!value) {
    console.warn(`Skip ${key} (empty)`);
    return;
  }
  const authorization = auth.startsWith('Bearer ') ? auth : `Bearer ${auth}`;
  const res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/env-vars/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    throw new Error(`PUT ${key} → ${res.status}: ${await res.text()}`);
  }
  console.log(`Updated ${key}`);
}

const auth = resolveRenderAuth();

const patch = {
  STORAGE_PROVIDER: 'aws',
  AWS_REGION: process.env.AWS_REGION || 'eu-north-1',
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET || 'biginvesto-668764275363-eu-north-1-an',
  AWS_S3_PREFIX: process.env.AWS_S3_PREFIX || 'investo',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
  API_PUBLIC_BASE_URL: 'https://investo-backend-v2.onrender.com',
  PROPERTY_IMPORT_DB_UPLOAD: 'false',
  FRONTEND_BASE_URL: 'https://frontend-navy-eight-37.vercel.app',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  REQUIRE_PROPERTY_KNOWLEDGE_INDEX: process.env.REQUIRE_PROPERTY_KNOWLEDGE_INDEX || 'true',
  REQUIRE_CLOUD_STORAGE_ON_PUBLISH: process.env.REQUIRE_CLOUD_STORAGE_ON_PUBLISH || 'true',
};

for (const [key, value] of Object.entries(patch)) {
  await upsert(auth, key, value);
}

if (!patch.AWS_ACCESS_KEY_ID && process.env.AWS_ADMIN_ACCESS_KEY_ID) {
  console.log('AWS service keys missing; run: node scripts/provision-investo-aws-storage.mjs');
} else if (patch.AWS_ACCESS_KEY_ID) {
  const deployRes = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/deploys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const deploy = await deployRes.json();
  console.log(`Deploy triggered: ${deploy.id}`);
}
