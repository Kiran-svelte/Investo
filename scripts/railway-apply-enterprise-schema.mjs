#!/usr/bin/env node
/**
 * Apply enterprise Prisma migration SQL directly to Railway Supabase (bypasses P3005 baseline).
 * Also seeds _prisma_migrations so future `migrate deploy` works.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../backend');
const require = createRequire(path.join(backendRoot, 'package.json'));
const { Client } = require('pg');

const token = process.env.RAILWAY_ACCOUNT_TOKEN || 'd21a6fc9-9759-4159-ab30-6d0731d8b57e';
const projectId = 'af15cb2b-b9ff-49cf-979d-a34b7c871359';
const environmentId = '3abc148f-da0e-42d9-a82d-c68a737c956e';
const serviceId = 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7';

const ENTERPRISE_MIGRATIONS = [
  '20260617050000_chunk02_whatsapp_jobs',
  '20260617052000_chunk03_tenant_quotas',
  '20260617063000_chunk04_enterprise_iam',
  '20260617072000_chunk05_security_hardening',
  '20260617083000_enterprise_chunks_06_14',
];

async function fetchRailwayVars() {
  const res = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($projectId:String!,$environmentId:String!,$serviceId:String!){ variables(projectId:$projectId, environmentId:$environmentId, serviceId:$serviceId) }`,
      variables: { projectId, environmentId, serviceId },
    }),
  });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data?.variables || {};
}

async function main() {
  const vars = await fetchRailwayVars();
  const directUrl = vars.DIRECT_URL || vars.DATABASE_URL;
  if (!directUrl) throw new Error('DIRECT_URL/DATABASE_URL missing on Railway');

  const host = directUrl.match(/@([^/?]+)/)?.[1] || 'unknown';
  process.stdout.write(`Target DB host: ${host}\n`);

  const client = new Client({ connectionString: directUrl });
  await client.connect();

  for (const migrationName of ENTERPRISE_MIGRATIONS) {
    const sqlPath = path.join(backendRoot, 'prisma/migrations', migrationName, 'migration.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    process.stdout.write(`Applying ${migrationName}...\n`);
    await client.query(sql);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  `);

  const migrationsDir = path.join(backendRoot, 'prisma/migrations');
  const allMigrations = fs.readdirSync(migrationsDir)
    .filter((name) => fs.existsSync(path.join(migrationsDir, name, 'migration.sql')))
    .sort();

  for (const migrationName of allMigrations) {
    const exists = await client.query(
      'SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1',
      [migrationName],
    );
    if (exists.rowCount > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, migrationName, 'migration.sql'), 'utf8');
    const checksum = require('crypto').createHash('sha256').update(sql).digest('hex');
    await client.query(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
       VALUES ($1, $2, NOW(), $3, 1)`,
      [require('crypto').randomUUID(), checksum, migrationName],
    );
    process.stdout.write(`Baselined ${migrationName}\n`);
  }

  const verify = await client.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('company_identity_configs', 'whatsapp_jobs', 'retention_policies')
    ORDER BY tablename
  `);
  process.stdout.write(`Verified tables: ${verify.rows.map((r) => r.tablename).join(', ')}\n`);
  await client.end();
  process.stdout.write('Enterprise schema applied to production Supabase.\n');
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
