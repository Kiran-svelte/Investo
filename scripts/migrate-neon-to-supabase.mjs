import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(path.join(root, 'backend', 'package.json'));
const { Client } = require('pg');
const dumpPath = path.join(root, 'tmp', 'neon-dump.sql');

const NEON_DIRECT =
  'postgresql://neondb_owner:npg_ghJRtq26knjl@ep-silent-cell-amwzz7s3.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require';
// ap-south-1 pooler (project klmpifgkxzlignvwaohv uses aws-1, not aws-0)
const SUPABASE_POOLER =
  'postgresql://postgres.klmpifgkxzlignvwaohv:Investo%40Supa2112@aws-1-ap-south-1.pooler.supabase.com:5432/postgres';
const SUPABASE_DIRECT = SUPABASE_POOLER;

async function testConnection(label, connectionString) {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const tables = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const users = await client.query(
    `SELECT to_regclass('public.users')::text AS users_table`
  );
  let userCount = null;
  if (users.rows[0]?.users_table) {
    const c = await client.query('SELECT count(*)::int AS n FROM users');
    userCount = c.rows[0].n;
  }
  await client.end();
  console.log(JSON.stringify({ label, tables: tables.rows[0].n, usersTable: users.rows[0].users_table, userCount }));
}

function runDockerPgDump() {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
    const args = [
      'run',
      '--rm',
      '-e',
      `PGSSLMODE=require`,
      '-v',
      `${path.dirname(dumpPath)}:/backup`,
      'postgres:16',
      'pg_dump',
      NEON_DIRECT,
      '--clean',
      '--if-exists',
      '--quote-all-identifiers',
      '--no-owner',
      '--no-privileges',
      '-f',
      '/backup/neon-dump.sql',
    ];
    console.log('Running docker pg_dump...');
    const proc = spawn('docker', args, { stdio: 'inherit', shell: true });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump exit ${code}`))));
    proc.on('error', reject);
  });
}

function runDockerPsqlImport() {
  return new Promise((resolve, reject) => {
    const args = [
      'run',
      '--rm',
      '-e',
      `PGSSLMODE=require`,
      '-v',
      `${path.dirname(dumpPath)}:/backup`,
      'postgres:16',
      'psql',
      SUPABASE_DIRECT,
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      '/backup/neon-dump.sql',
    ];
    console.log('Running docker psql import...');
    const proc = spawn('docker', args, { stdio: 'inherit', shell: true });
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`psql exit ${code}`))));
    proc.on('error', reject);
  });
}

async function enableExtensions() {
  const client = new Client({
    connectionString: SUPABASE_DIRECT,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  await client.end();
  console.log('Extensions enabled on Supabase');
}

const cmd = process.argv[2] || 'status';

(async () => {
  if (cmd === 'status') {
    await testConnection('neon', NEON_DIRECT);
    await testConnection('supabase', SUPABASE_DIRECT);
    return;
  }
  if (cmd === 'dump') {
    await testConnection('neon', NEON_DIRECT);
    await runDockerPgDump();
    const stat = fs.statSync(dumpPath);
    console.log(`Dump written: ${dumpPath} (${stat.size} bytes)`);
    return;
  }
  if (cmd === 'import') {
    if (!fs.existsSync(dumpPath)) {
      throw new Error(`Missing dump at ${dumpPath}. Run: node scripts/migrate-neon-to-supabase.mjs dump`);
    }
    await enableExtensions();
    await runDockerPsqlImport();
    await testConnection('supabase', SUPABASE_DIRECT);
    return;
  }
  if (cmd === 'all') {
    await testConnection('neon', NEON_DIRECT);
    await runDockerPgDump();
    await enableExtensions();
    await runDockerPsqlImport();
    await testConnection('supabase', SUPABASE_DIRECT);
    return;
  }
  throw new Error(`Unknown command: ${cmd}`);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
