import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../.env') });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const result = await client.query(`
  SELECT tablename
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename IN (
      'company_identity_configs',
      'whatsapp_jobs',
      'user_mfa_devices',
      'retention_policies'
    )
  ORDER BY tablename
`);
process.stdout.write(`${JSON.stringify(result.rows, null, 2)}\n`);
await client.end();
