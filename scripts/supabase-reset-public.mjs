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
  connectionTimeoutMillis: 20000,
});

await client.connect();
console.log('Resetting public schema...');
await client.query('DROP SCHEMA public CASCADE');
await client.query('CREATE SCHEMA public');
await client.query('GRANT ALL ON SCHEMA public TO postgres');
await client.query('GRANT ALL ON SCHEMA public TO public');
await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
await client.query('CREATE EXTENSION IF NOT EXISTS vector');
await client.end();
console.log('Done.');
