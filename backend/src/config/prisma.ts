import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import config from './index';
import logger from './logger';
import { attachSlowQueryLogging } from './prisma-slow-query';

const adapter = new PrismaPg({
  connectionString: config.db.url,
  max: config.db.poolMax,
  ...(config.db.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
});

const prisma = new PrismaClient({
  adapter,
  log: [
    { level: 'query', emit: 'event' },
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' },
  ],
});

attachSlowQueryLogging(prisma);

prisma.$on('warn' as never, (e: any) => {
  logger.warn('Prisma warning', { message: e.message });
});

prisma.$on('error' as never, (e: any) => {
  logger.error('Prisma error', { message: e.message });
});

export default prisma;
