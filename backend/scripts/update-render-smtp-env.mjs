/**
 * Set Gmail SMTP env vars on Render backend (values from process env — never commit secrets).
 * Usage (PowerShell):
 *   $env:RENDER_API_KEY='rnd_...'
 *   $env:SMTP_USER='you@gmail.com'
 *   $env:SMTP_PASS='app-password-no-spaces'
 *   node scripts/update-render-smtp-env.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: process.env.SMTP_PORT || '587',
  SMTP_SECURE: process.env.SMTP_SECURE || 'false',
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  MAIL_FROM: process.env.MAIL_FROM || (process.env.SMTP_USER ? `Investo <${process.env.SMTP_USER}>` : ''),
  FRONTEND_BASE_URL: process.env.FRONTEND_BASE_URL || 'https://frontend-navy-eight-37.vercel.app',
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
console.log('SMTP env updated; deploy triggered.');
