import { execFileSync } from 'node:child_process';
import path from 'node:path';

import logger from './logger';

const backendRoot = path.resolve(__dirname, '../..');

export async function runPrismaMigrateDeploy(): Promise<void> {
  if (process.env.PRISMA_MIGRATE_DISABLED === 'true') {
    logger.info('Prisma migrate deploy skipped (PRISMA_MIGRATE_DISABLED=true)');
    return;
  }

  try {
    logger.info('Running Prisma migrate deploy...');
    const output = execFileSync(
      process.execPath,
      [path.join(backendRoot, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
      {
        cwd: backendRoot,
        env: process.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    if (output.trim()) {
      logger.info('Prisma migrate deploy output', { output: output.trim().slice(0, 2000) });
    }
    logger.info('Prisma migrate deploy completed');
  } catch (err: unknown) {
    const execErr = err as { stderr?: string; stdout?: string; message?: string };
    const detail = execErr.stderr || execErr.stdout || execErr.message || String(err);
    logger.error('Prisma migrate deploy failed', { error: detail.slice(0, 4000) });
    throw err;
  }
}
