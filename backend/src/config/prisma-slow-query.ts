import type { PrismaClient } from '@prisma/client';
import logger from './logger';

const SLOW_QUERY_MS = 100;

/**
 * Logs Prisma queries slower than SLOW_QUERY_MS via client event API.
 */
export function attachSlowQueryLogging(prisma: PrismaClient): void {
  (prisma as PrismaClient & { $on(event: 'query', cb: (e: QueryEvent) => void): void }).$on(
    'query',
    (event: QueryEvent) => {
      if (event.duration >= SLOW_QUERY_MS) {
        logger.warn('Slow Prisma query', {
          durationMs: event.duration,
          query: event.query.slice(0, 200),
          target: event.target,
        });
      }
    },
  );
}

interface QueryEvent {
  timestamp: Date;
  query: string;
  params: string;
  duration: number;
  target: string;
}
