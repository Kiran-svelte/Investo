import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(path.join(root, 'backend', 'package.json'));
const { Client } = require('pg');

const NEON_DIRECT =
  'postgresql://neondb_owner:npg_ghJRtq26knjl@ep-silent-cell-amwzz7s3.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require';
const outDir = path.join(root, 'tmp', 'neon-export');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const client = new Client({
    connectionString: NEON_DIRECT,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: tables } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );

  const manifest = [];
  for (const { tablename } of tables) {
    const { rows } = await client.query(`SELECT * FROM "${tablename}"`);
    const file = path.join(outDir, `${tablename}.json`);
    fs.writeFileSync(file, JSON.stringify(rows, null, 0));
    manifest.push({ table: tablename, rows: rows.length });
    console.log(`${tablename}: ${rows.length}`);
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await client.end();
  console.log(`Exported to ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
