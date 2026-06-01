#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend');
const r = spawnSync(
  'npx',
  ['jest', 'src/tests/unit/load-health.perf.test.ts', '--detectOpenHandles', '--forceExit'],
  { cwd: backend, stdio: 'inherit', shell: true },
);
process.exit(r.status ?? 1);
