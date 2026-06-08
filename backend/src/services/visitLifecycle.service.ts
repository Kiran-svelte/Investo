import logger from '../config/logger';
import prisma from '../config/prisma';
import { socketService, SOCKET_EVENTS } from './socket.service';

export type VisitSocketChange =
  | 'created'
  | 'rescheduled'
  | 'cancelled'
  | 'confirmed'
  | 'completed'
  | 'status_changed';

type VisitSocketPayload = {
  id: string;
  leadId: string;
  propertyId: string | null;
  agentId: string;
  scheduledAt: Date | string;
  status: string;
  companyId: string;
};

function toSocketVisit(visit: VisitSocketPayload) {
  return {
    id: visit.id,
    leadId: visit.leadId,
    propertyId: visit.propertyId,
    agentId: visit.agentId,
    scheduledAt:
      visit.scheduledAt instanceof Date
        ? visit.scheduledAt.toISOString()
        : visit.scheduledAt,
    status: visit.status,
    companyId: visit.companyId,
  };
}


export function emitVisitCreated(companyId: string, visit: VisitSocketPayload): void {
  const payload = { visit: toSocketVisit(visit), leadId: visit.leadId, occurredAt: new Date().toISOString() };
  const emitted = socketService.emitToCompany(companyId, SOCKET_EVENTS.VISIT_CREATED, payload);
  logger.info('Visit lifecycle: VISIT_CREATED emitted', { companyId, visitId: visit.id, emitted });
}

export function emitVisitUpdated(
  companyId: string,
  visit: VisitSocketPayload,
  change: VisitSocketChange,
): void {
  const payload = {
    visit: toSocketVisit(visit),
    leadId: visit.leadId,
    change,
    occurredAt: new Date().toISOString(),
  };
  const emitted = socketService.emitToCompany(companyId, SOCKET_EVENTS.VISIT_UPDATED, payload);
  logger.info('Visit lifecycle: VISIT_UPDATED emitted', { companyId, visitId: visit.id, change, emitted });
}

/** Enqueue customer 24h + 1h WhatsApp reminders (idempotent per visitId). */
export async function scheduleVisitReminderJobs(
  visitId: string,
  scheduledAt: Date,
  companyId: string,
  leadId: string,
): Promise<void> {
  try {
    const { automationQueueService } = await import('./automationQueue.service');
    const payload = { visitId, leadId, companyId };
    const at24h = new Date(scheduledAt.getTime() - 24 * 60 * 60 * 1000);
    const at1h = new Date(scheduledAt.getTime() - 60 * 60 * 1000);

    if (at24h > new Date()) {
      await automationQueueService.schedule('visit_reminder_24h', visitId, at24h, payload);
    }
    if (at1h > new Date()) {
      await automationQueueService.schedule('visit_reminder_1h', visitId, at1h, payload);
    }
    logger.info('Visit reminders scheduled', { visitId, at24h, at1h });
  } catch (err: unknown) {
    logger.warn('scheduleVisitReminderJobs failed', {
      visitId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function cancelVisitReminderJobs(visitId: string): Promise<void> {
  try {
    const { automationQueueService } = await import('./automationQueue.service');
    await automationQueueService.cancel('visit_reminder_24h', visitId);
    await automationQueueService.cancel('visit_reminder_1h', visitId);
    logger.info('Visit reminders cancelled', { visitId });
  } catch (err: unknown) {
    logger.warn('cancelVisitReminderJobs failed', {
      visitId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function rescheduleVisitReminderJobs(
  visitId: string,
  scheduledAt: Date,
  companyId: string,
  leadId: string,
): Promise<void> {
  await cancelVisitReminderJobs(visitId);
  await scheduleVisitReminderJobs(visitId, scheduledAt, companyId, leadId);
}

/**
 * Self-healer: called once at server startup.
 *
 * Finds all upcoming confirmed visits that
 * have no corresponding `automation_queue` reminder jobs — which can happen
 * when the server restarts between `prisma.visit.create` and
 * `scheduleVisitReminderJobs`. For each orphan, re-schedules the missing jobs.
 *
 * This is idempotent: `automationQueueService.schedule` is a no-op if the
 * job already exists for the same `visitId` and job type.
 *
 * @returns Number of visits whose reminders were re-enqueued.
 * @throws Never — all errors are logged and swallowed so startup is not blocked.
 */
export async function reconcileOrphanedVisitReminders(): Promise<number> {
  try {
    const { automationQueueService } = await import('./automationQueue.service');
    const windowStart = new Date();
    // Only look ahead 25h so we don't reschedule visits whose 24h window has passed.
    const windowEnd = new Date(Date.now() + 25 * 60 * 60 * 1000);

    const upcomingVisits = await prisma.visit.findMany({
      where: {
        status: 'confirmed',
        scheduledAt: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, scheduledAt: true, companyId: true, leadId: true },
    });

    if (!upcomingVisits.length) {
      logger.info('reconcileOrphanedVisitReminders: no upcoming visits in window');
      return 0;
    }

    const visitIds = upcomingVisits.map((v) => v.id);

    // Fetch existing automation jobs for these visits in a single query.
    const existingJobs = await automationQueueService.findExistingJobsForVisits(
      visitIds,
      ['visit_reminder_24h', 'visit_reminder_1h'],
    );

    const existingJobKeys = new Set(
      existingJobs.map((j) => `${j.type}:${j.referenceId}`),
    );

    let reconciledCount = 0;

    for (const visit of upcomingVisits) {
      const has24h = existingJobKeys.has(`visit_reminder_24h:${visit.id}`);
      const has1h = existingJobKeys.has(`visit_reminder_1h:${visit.id}`);

      if (!has24h || !has1h) {
        logger.warn('reconcileOrphanedVisitReminders: re-enqueuing missing reminders', {
          visitId: visit.id,
          scheduledAt: visit.scheduledAt,
          missing24h: !has24h,
          missing1h: !has1h,
        });

        await scheduleVisitReminderJobs(
          visit.id,
          visit.scheduledAt,
          visit.companyId,
          visit.leadId,
        );

        reconciledCount++;
      }
    }

    logger.info('reconcileOrphanedVisitReminders: complete', {
      checked: upcomingVisits.length,
      reconciled: reconciledCount,
    });

    return reconciledCount;
  } catch (err: unknown) {
    logger.error('reconcileOrphanedVisitReminders: unexpected error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

