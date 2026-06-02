import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(path.join(root, 'backend', 'package.json'));
const { Client } = require('pg');

const url =
  process.env.SUPABASE_DATABASE_URL ||
  'postgresql://postgres.klmpifgkxzlignvwaohv:Investo%40Supa2112@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

await client.connect();
const tables = await client.query(
  `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
);
console.log('tables:', tables.rows.map((r) => r.tablename).join(', ') || '(none)');
const users = await client.query(`SELECT to_regclass('public.users')::text AS t`);
if (users.rows[0].t) {
  const c = await client.query('SELECT count(*)::int AS n FROM users');
  console.log('users:', c.rows[0].n);
}
await client.end();
