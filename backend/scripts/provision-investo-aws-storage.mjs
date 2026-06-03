/**
 * Create IAM user + access key for Investo S3 uploads and push to Render.
 * Requires admin credentials once (AWS console → IAM → create access key for admin user):
 *   $env:AWS_ADMIN_ACCESS_KEY_ID='AKIA...'
 *   $env:AWS_ADMIN_SECRET_ACCESS_KEY='...'
 *   node scripts/provision-investo-aws-storage.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  IAMClient,
  CreateUserCommand,
  PutUserPolicyCommand,
  CreateAccessKeyCommand,
  GetUserCommand,
} from '@aws-sdk/client-iam';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(backendRoot, '.env') });
dotenv.config({ path: path.join(backendRoot, '.env.aws-admin') });

const RENDER_SERVICE_ID = 'srv-d79itik50q8c73fjqi7g';
const IAM_USER_NAME = process.env.AWS_IAM_USER_NAME || 'investo-api-storage';
const POLICY_NAME = 'investo-s3-storage-inline';
const BUCKET = process.env.AWS_S3_BUCKET || 'biginvesto-668764275363-eu-north-1-an';
const REGION = process.env.AWS_REGION || 'eu-north-1';
const PREFIX = process.env.AWS_S3_PREFIX || 'investo';

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

function resolveAdminCredentials() {
  const accessKeyId = process.env.AWS_ADMIN_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_ADMIN_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Set AWS_ADMIN_ACCESS_KEY_ID and AWS_ADMIN_SECRET_ACCESS_KEY (admin IAM user)');
  }
  return { accessKeyId, secretAccessKey };
}

async function ensureIamUser(iam) {
  try {
    await iam.send(new GetUserCommand({ UserName: IAM_USER_NAME }));
    console.log(`IAM user ${IAM_USER_NAME} already exists`);
  } catch (err) {
    if (err?.name !== 'NoSuchEntity') {
      throw err;
    }
    await iam.send(new CreateUserCommand({ UserName: IAM_USER_NAME }));
    console.log(`Created IAM user ${IAM_USER_NAME}`);
  }

  const policyDocument = JSON.parse(
    fs.readFileSync(path.join(backendRoot, 'iam', 'investo-s3-storage-policy.json'), 'utf8'),
  );

  await iam.send(
    new PutUserPolicyCommand({
      UserName: IAM_USER_NAME,
      PolicyName: POLICY_NAME,
      PolicyDocument: JSON.stringify(policyDocument),
    }),
  );
  console.log('Attached inline S3 policy');
}

async function createServiceAccessKey(iam) {
  const created = await iam.send(new CreateAccessKeyCommand({ UserName: IAM_USER_NAME }));
  const key = created.AccessKey;
  if (!key?.AccessKeyId || !key?.SecretAccessKey) {
    throw new Error('Failed to create access key');
  }
  return key;
}

async function upsertRenderEnv(auth, key, value) {
  const res = await fetch(
    `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/env-vars/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Render env ${key} failed: ${res.status} ${body}`);
  }
  console.log(`Render env updated: ${key}`);
}

async function triggerDeploy(auth) {
  const res = await fetch(`https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ clearCache: 'do_not_clear' }),
  });
  if (!res.ok) {
    throw new Error(`Deploy trigger failed: ${res.status}`);
  }
  const deploy = await res.json();
  console.log(`Deploy started: ${deploy.id}`);
  return deploy.id;
}

async function waitForDeploy(auth, deployId) {
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 15000));
    const res = await fetch(
      `https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys/${deployId}`,
      { headers: { Authorization: auth } },
    );
    const status = (await res.json()).status;
    console.log(`Deploy status: ${status}`);
    if (status === 'live') return;
    if (['build_failed', 'update_failed', 'canceled'].includes(status)) {
      throw new Error(`Deploy failed: ${status}`);
    }
  }
  throw new Error('Deploy timed out');
}

const admin = resolveAdminCredentials();
const iam = new IAMClient({
  region: REGION,
  credentials: admin,
});

await ensureIamUser(iam);
const key = await createServiceAccessKey(iam);
console.log(`Service access key created: ${key.AccessKeyId}`);

const renderAuth = resolveRenderAuth();
const envPatch = {
  STORAGE_PROVIDER: 'aws',
  AWS_REGION: REGION,
  AWS_S3_BUCKET: BUCKET,
  AWS_S3_PREFIX: PREFIX,
  AWS_ACCESS_KEY_ID: key.AccessKeyId,
  AWS_SECRET_ACCESS_KEY: key.SecretAccessKey,
  API_PUBLIC_BASE_URL: 'https://investo-backend-v2.onrender.com',
  PROPERTY_IMPORT_DB_UPLOAD: 'false',
  FRONTEND_BASE_URL: 'https://frontend-navy-eight-37.vercel.app',
};

for (const [k, v] of Object.entries(envPatch)) {
  await upsertRenderEnv(renderAuth, k, v);
}

const deployId = await triggerDeploy(renderAuth);
await waitForDeploy(renderAuth, deployId);
console.log('AWS storage provisioned and backend redeployed.');
