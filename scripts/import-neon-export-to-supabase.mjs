import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(path.join(root, 'backend', 'package.json'));
const { Client } = require('pg');

const SUPABASE_POOLER =
  process.env.SUPABASE_DATABASE_URL ||
  'postgresql://postgres.klmpifgkxzlignvwaohv:Investo%40Supa2112@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

const exportDir = path.join(root, 'tmp', 'neon-export');

// Parent tables first for FK safety when replication_role is not enough.
const TABLE_ORDER = [
  'subscription_plans',
  'companies',
  'company_roles',
  'company_features',
  'company_onboarding',
  'users',
  'subscription_plans',
  'leads',
  'properties',
  'conversations',
  'messages',
  'visits',
  'ai_settings',
  'notifications',
  'audit_logs',
  'analytics',
  'invoices',
  'refresh_tokens',
  'password_reset_tokens',
  'property_import_drafts',
  'property_import_jobs',
  'property_import_media',
  'property_import_media_blobs',
];

async function importTable(client, table, rows) {
  if (!rows.length) {
    console.log(`  ${table}: 0 rows`);
    return;
  }
  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(', ');
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

  await client.query(`DELETE FROM "${table}"`);
  for (const row of rows) {
    const values = cols.map((c) => {
      const value = row[c];
      if (value !== null && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
        return JSON.stringify(value);
      }
      return value;
    });
    await client.query(
      `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`,
      values
    );
  }
  console.log(`  ${table}: ${rows.length} rows`);
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(exportDir, 'manifest.json'), 'utf8'));
  const tables = manifest.map((m) => m.table);
  const ordered = [
    ...TABLE_ORDER.filter((t) => tables.includes(t)),
    ...tables.filter((t) => !TABLE_ORDER.includes(t)),
  ];

  const client = new Client({
    connectionString: SUPABASE_POOLER,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await client.query('CREATE EXTENSION IF NOT EXISTS vector');

  await client.query('SET session_replication_role = replica');
  try {
    for (const table of ordered) {
      const file = path.join(exportDir, `${table}.json`);
      if (!fs.existsSync(file)) continue;
      const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
      await importTable(client, table, rows);
    }
  } finally {
    await client.query('SET session_replication_role = DEFAULT');
  }

  const users = await client.query('SELECT count(*)::int AS n FROM users');
  console.log(`Import complete. users=${users.rows[0].n}`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
