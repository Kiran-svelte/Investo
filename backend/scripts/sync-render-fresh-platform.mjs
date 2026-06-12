#!/usr/bin/env node
/**
 * Sync AWS S3 + Resend mail + platform flags to Render, then trigger deploy.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.render-sync') });

const SERVICE_ID = 'srv-d79itik50q8c73fjqi7g';
const REGION = process.env.AWS_REGION || 'eu-north-1';
const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || '';
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || '';

function resolveRenderAuth() {
  const fromEnv = process.env.RENDER_API_KEY?.trim();
  if (!fromEnv) throw new Error('Set RENDER_API_KEY');
  return fromEnv.startsWith('Bearer ') ? fromEnv : `Bearer ${fromEnv}`;
}

async function upsert(auth, key, value) {
  if (value === undefined || value === null || value === '') {
    console.warn(`Skip ${key} (empty)`);
    return;
  }
  const res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/env-vars/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: String(value) }),
  });
  if (!res.ok) throw new Error(`PUT ${key} → ${res.status}: ${await res.text()}`);
  console.log(`Updated ${key}`);
}

async function main() {
  const auth = resolveRenderAuth();
  const mailFrom = process.env.MAIL_FROM || 'Investo <onboarding@resend.dev>';
  const resendApiKey = process.env.RESEND_API_KEY?.trim() || '';

  const patch = {
    STORAGE_PROVIDER: 'aws',
    AWS_REGION: REGION,
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET || 'biginvesto-668764275363-eu-north-1-an',
    AWS_S3_PREFIX: process.env.AWS_S3_PREFIX || 'investo',
    AWS_ACCESS_KEY_ID: ACCESS_KEY,
    AWS_SECRET_ACCESS_KEY: SECRET_KEY,
    API_PUBLIC_BASE_URL: 'https://investo-backend-v2.onrender.com',
    FRONTEND_BASE_URL: 'https://biginvesto.online',
    CORS_ORIGINS: 'https://biginvesto.online,https://www.biginvesto.online',
    PROPERTY_IMPORT_DB_UPLOAD: 'false',
    DB_AUTO_SEED: 'false',
    RESEND_API_KEY: resendApiKey,
    MAIL_FROM: mailFrom,
    MAIL_TRANSPORT: 'resend',
  };

  for (const [key, value] of Object.entries(patch)) {
    await upsert(auth, key, value);
  }

  const deployRes = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/deploys`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const deploy = await deployRes.json();
  if (!deployRes.ok) throw new Error(`Deploy failed: ${JSON.stringify(deploy)}`);
  console.log(`Deploy triggered: ${deploy.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
