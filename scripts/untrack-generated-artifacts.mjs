#!/usr/bin/env node
/**
 * Remove generated/vendor/secret-local artifacts from Git tracking.
 *
 * Default mode is dry-run. Use --apply in a git-writable environment.
 * This does not delete files from disk; it runs git rm --cached.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const apply = process.argv.includes('--apply');

const pathspecs = [
  'backend/.env',
  'frontend/.env',
  'frontend/.env.local',
  'backend/dist',
  'frontend/dist',
  'frontend/node_modules',
  'frontend/test-results',
  'frontend/tsconfig.tsbuildinfo',
];

function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function trackedUnder(pathspec) {
  try {
    return git(['ls-files', '--', pathspec]).split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

const tracked = pathspecs.flatMap((pathspec) => trackedUnder(pathspec));

if (!apply) {
  process.stdout.write(`Dry run: ${tracked.length} tracked generated/vendor/env artifacts would be removed from Git tracking.\n`);
  for (const file of tracked.slice(0, 50)) {
    process.stdout.write(`  ${file}\n`);
  }
  if (tracked.length > 50) {
    process.stdout.write(`  ... ${tracked.length - 50} more\n`);
  }
  process.stdout.write('\nRun with --apply to execute git rm --cached. Files will remain on disk.\n');
  process.exit(tracked.length > 0 ? 1 : 0);
}

if (tracked.length === 0) {
  process.stdout.write('No tracked generated/vendor/env artifacts found.\n');
  process.exit(0);
}

const result = spawnSync(
  'git',
  ['rm', '--cached', '-r', '--ignore-unmatch', '--', ...pathspecs],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  },
);

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout || 'git rm --cached failed\n');
  process.exit(result.status || 1);
}

process.stdout.write(result.stdout);
process.stdout.write(`Removed ${tracked.length} artifacts from Git tracking. Files remain on disk.\n`);
