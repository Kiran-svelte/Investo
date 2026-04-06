import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { neonConfig } from '@neondatabase/serverless';
import config from './index';
import logger from './logger';

neonConfig.fetchConnectionCache = true;

const adapter = new PrismaNeon({ connectionString: config.db.url });

const prisma = new PrismaClient({
  adapter,
  log: config.env === 'development'
    ? [
        { level: 'warn', emit: 'event' },
        { level: 'error', emit: 'event' },
      ]
    : [{ level: 'error', emit: 'event' }],
});

prisma.$on('warn' as never, (e: any) => {
  logger.warn('Prisma warning', { message: e.message });
});

prisma.$on('error' as never, (e: any) => {
  logger.error('Prisma error', { message: e.message });
});

export default prisma;
