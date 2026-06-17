#!/usr/bin/env node
/** Bootstrap company identity + retention rows on Railway Supabase production. */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../backend');
const require = createRequire(path.join(backendRoot, 'package.json'));
const { Client } = require('pg');

const token = process.env.RAILWAY_ACCOUNT_TOKEN || 'd21a6fc9-9759-4159-ab30-6d0731d8b57e';

async function fetchRailwayVars() {
  const res = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($projectId:String!,$environmentId:String!,$serviceId:String!){ variables(projectId:$projectId, environmentId:$environmentId, serviceId:$serviceId) }`,
      variables: {
        projectId: 'af15cb2b-b9ff-49cf-979d-a34b7c871359',
        environmentId: '3abc148f-da0e-42d9-a82d-c68a737c956e',
        serviceId: 'c852103d-c0cd-4c2d-9740-d1cb5651c8d7',
      },
    }),
  });
  const body = await res.json();
  return body.data?.variables || {};
}

async function main() {
  const vars = await fetchRailwayVars();
  const directUrl = vars.DIRECT_URL || vars.DATABASE_URL;
  const client = new Client({ connectionString: directUrl });
  await client.connect();

  const companies = await client.query(`SELECT id, name FROM companies WHERE status = 'active'`);
  for (const company of companies.rows) {
    const admins = await client.query(
      `SELECT email FROM users WHERE company_id = $1 AND role = 'company_admin' AND status = 'active' LIMIT 10`,
      [company.id],
    );
    const domains = [...new Set(
      admins.rows
        .map((row) => String(row.email).split('@')[1]?.toLowerCase())
        .filter(Boolean),
    )];

    await client.query(
      `INSERT INTO company_identity_configs (
        company_id, sso_enabled, scim_enabled, mfa_required, allowed_domains, ip_allowlist_enabled, ip_allowlist, mfa_methods
      ) VALUES ($1, $2, false, false, $3::jsonb, false, '[]'::jsonb, '["totp"]'::jsonb)
      ON CONFLICT (company_id) DO UPDATE SET
        sso_enabled = EXCLUDED.sso_enabled,
        allowed_domains = EXCLUDED.allowed_domains,
        updated_at = CURRENT_TIMESTAMP`,
      [company.id, domains.length > 0, JSON.stringify(domains)],
    );

    await client.query(
      `INSERT INTO retention_policies (company_id, lead_days, message_days, audit_days, inactive_company_days)
       VALUES ($1, 2555, 1095, 2555, 90)
       ON CONFLICT (company_id) DO NOTHING`,
      [company.id],
    );

    process.stdout.write(`Bootstrapped ${company.name} domains=${domains.join(',') || 'none'}\n`);
  }

  await client.end();
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
