#!/usr/bin/env node
/**
 * Apply pending Prisma migrations to the database in DATABASE_URL.
 * Usage: cd backend && npm run migrate:deploy
 */
import { execFileSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');
loadEnv({ path: path.join(backendRoot, '.env') });

process.stdout.write('Running Prisma migrate deploy...\n');
const output = execFileSync(
  process.execPath,
  [path.join(backendRoot, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
  {
    cwd: backendRoot,
    env: process.env,
    encoding: 'utf8',
  },
);
if (output.trim()) {
  process.stdout.write(`${output}\n`);
}
process.stdout.write('Prisma migrations applied.\n');
