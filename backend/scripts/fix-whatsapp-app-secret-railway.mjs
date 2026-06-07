/**
 * Sync WHATSAPP_APP_SECRET from company DB → Railway + smoke-test signed webhook.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
const varsPath = path.join(ROOT, 'scripts', '.railway-prod-vars.json');
const vars = JSON.parse(fs.readFileSync(varsPath, 'utf8').replace(/^\uFEFF/, ''));
const ACCOUNT_TOKEN = process.env.RAILWAY_ACCOUNT_TOKEN || '2a351ccb-820e-485d-94a5-69f79b75ea7c';
const PROJECT_ID = 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const ENV_ID = '3abc148f-da0e-42d9-a82d-c68a737c956e';
const SERVICE_ID = 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';
const BASE = 'https://investo-backend-production.up.railway.app';

async function gql(token, query, variables = {}) {
  const res = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: vars.DATABASE_URL }) });

try {
  const palm = await prisma.company.findFirst({
    where: { name: { contains: 'Palm', mode: 'insensitive' } },
    select: { settings: true },
  });
  const settings = palm?.settings || {};
  const whatsapp = settings.whatsapp || {};
  const meta = whatsapp.meta || whatsapp;
  let appSecret = (process.env.WHATSAPP_APP_SECRET || '').trim();
  if (!appSecret) {
    appSecret = String(meta.appSecret || whatsapp.appSecret || '').trim();
  }

  if (!appSecret) {
    console.error('FAIL: set WHATSAPP_APP_SECRET env or save appSecret in Palm AI Settings');
    process.exit(1);
  }
  console.log(`Using appSecret (len=${appSecret.length})`);

  const base = { projectId: PROJECT_ID, environmentId: ENV_ID, serviceId: SERVICE_ID };

  await gql(ACCOUNT_TOKEN, 'mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }', {
    input: { ...base, name: 'WHATSAPP_APP_SECRET', value: appSecret },
  });
  console.log('Upserted WHATSAPP_APP_SECRET on Railway');

  try {
    await gql(ACCOUNT_TOKEN, 'mutation($input: VariableDeleteInput!) { variableDelete(input: $input) }', {
      input: { ...base, name: 'BYPASS_WHATSAPP_SIGNATURE' },
    });
    console.log('Removed BYPASS_WHATSAPP_SIGNATURE');
  } catch {
    console.log('BYPASS_WHATSAPP_SIGNATURE already absent');
  }

  await gql(
    ACCOUNT_TOKEN,
    'mutation($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }',
    { serviceId: SERVICE_ID, environmentId: ENV_ID },
  );
  console.log('Redeploy triggered — waiting 90s...');
  await new Promise((r) => setTimeout(r, 90_000));

  const payload = {
    object: 'whatsapp_business_account',
    entry: [{ id: 'smoke', changes: [{ field: 'messages', value: { metadata: { phone_number_id: vars.WHATSAPP_PHONE_NUMBER_ID }, messages: [] } }] }],
  };
  const body = JSON.stringify(payload);
  const sig = `sha256=${crypto.createHmac('sha256', appSecret).update(body).digest('hex')}`;

  const unsigned = await fetch(`${BASE}/api/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const signed = await fetch(`${BASE}/api/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
    body,
  });

  console.log(`POST unsigned: ${unsigned.status} ${(await unsigned.text()).slice(0, 80)}`);
  console.log(`POST signed:   ${signed.status} ${(await signed.text()).slice(0, 80)}`);

  const health = await fetch(`${BASE}/api/health/internal`);
  const h = await health.json();
  console.log('ops whatsapp_outbound:', h.ops_metrics?.counters?.whatsapp_outbound);
  console.log('ops webhook_inbound:', h.ops_metrics?.counters?.webhook_inbound);

  if (signed.status === 200) {
    console.log('SUCCESS: signed webhook accepted — WhatsApp agent can receive messages');
  } else {
    console.error('FAIL: signed webhook still rejected');
    process.exit(1);
  }
} finally {
  await prisma.$disconnect();
}
