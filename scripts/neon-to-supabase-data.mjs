/**
 * Neon → Supabase data copy without pg_dump (uses pg client).
 * Run: node scripts/neon-to-supabase-data.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(path.join(root, 'backend', 'package.json'));
const { Client } = require('pg');

const NEON_DIRECT =
  'postgresql://neondb_owner:npg_ghJRtq26knjl@ep-silent-cell-amwzz7s3.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require';

const SUPABASE_POOLER =
  process.env.SUPABASE_DATABASE_URL ||
  'postgresql://postgres.klmpifgkxzlignvwaohv:Investo%40Supa2112@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

const ssl = { rejectUnauthorized: false };

async function listPublicTables(client) {
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename`
  );
  return rows.map((r) => r.tablename);
}

async function copyTable(source, target, table) {
  const { rows } = await source.query(`SELECT * FROM "${table}"`);
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows (skip)`);
    return;
  }

  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(', ');
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

  await target.query(`TRUNCATE "${table}" CASCADE`);

  for (const row of rows) {
    const values = cols.map((c) => row[c]);
    await target.query(
      `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      values
    );
  }
  console.log(`  ${table}: ${rows.length} rows`);
}

async function main() {
  const source = new Client({ connectionString: NEON_DIRECT, ssl });
  const target = new Client({ connectionString: SUPABASE_POOLER, ssl });

  console.log('Connecting to Neon...');
  await source.connect();
  console.log('Connecting to Supabase...');
  await target.connect();

  await target.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await target.query('CREATE EXTENSION IF NOT EXISTS vector');

  const tables = await listPublicTables(source);
  console.log(`Copying ${tables.length} tables...`);

  await target.query('SET session_replication_role = replica');
  try {
    for (const table of tables) {
      if (table === 'knex_migrations' || table === 'knex_migrations_lock') continue;
      await copyTable(source, target, table);
    }
  } finally {
    await target.query('SET session_replication_role = DEFAULT');
  }

  const users = await target.query('SELECT count(*)::int AS n FROM users');
  console.log(`Done. users=${users.rows[0].n}`);

  await source.end();
  await target.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
