import db from './database';
import logger from './logger';

export async function runMigrations(options?: { destroyConnection?: boolean }): Promise<void> {
  const destroyConnection = options?.destroyConnection ?? false;
  try {
    logger.info('Running migrations...');
    const [batchNo, log] = await db.migrate.latest();
    if (log.length === 0) {
      logger.info('Database already up to date');
    } else {
      logger.info(`Batch ${batchNo} run: ${log.length} migrations`);
      log.forEach((l: string) => logger.info(`  - ${l}`));
    }
  } catch (error) {
    logger.error('Migration failed', { error });
    throw error;
  } finally {
    if (destroyConnection) {
      await db.destroy();
    }
  }
}

if (require.main === module) {
  runMigrations({ destroyConnection: true })
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
