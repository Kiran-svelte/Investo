import prisma from '../config/prisma';
import logger from '../config/logger';
import { notificationEngine } from './notification.engine';

async function loadVisitNotificationContext(visitId: string) {
  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    include: {
      lead: true,
      property: { select: { name: true } },
      agent: { select: { id: true, name: true, phone: true } },
    },
  });
  if (!visit) return null;
  const company = await prisma.company.findUnique({ where: { id: visit.companyId } });
  if (!company) return null;
  return { visit, lead: visit.lead, property: visit.property, agent: visit.agent, company };
}

/** Fire staff/customer notifications after a visit is created via copilot tools. */
export async function notifyVisitScheduledFromTool(visitId: string): Promise<void> {
  try {
    const ctx = await loadVisitNotificationContext(visitId);
    if (!ctx?.lead || !ctx.agent) return;
    await notificationEngine.onVisitScheduled(ctx.visit, ctx.lead, ctx.property, ctx.agent);
  } catch (err: unknown) {
    logger.warn('notifyVisitScheduledFromTool failed', {
      visitId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Fire staff/customer notifications after a visit time changes. */
export async function notifyVisitRescheduledFromTool(visitId: string, oldTime: Date): Promise<void> {
  try {
    const ctx = await loadVisitNotificationContext(visitId);
    if (!ctx?.lead) return;
    await notificationEngine.onVisitRescheduled(
      ctx.visit,
      oldTime,
      ctx.visit.scheduledAt,
      ctx.lead,
      ctx.company,
    );
  } catch (err: unknown) {
    logger.warn('notifyVisitRescheduledFromTool failed', {
      visitId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Fire staff/customer notifications after visit status changes. */
export async function notifyVisitStatusChangeFromTool(
  visitId: string,
  oldStatus: string,
  newStatus: string,
): Promise<void> {
  try {
    const ctx = await loadVisitNotificationContext(visitId);
    if (!ctx?.lead) return;
    await notificationEngine.onVisitStatusChange(
      ctx.visit,
      oldStatus,
      newStatus,
      ctx.lead,
      ctx.company,
    );
  } catch (err: unknown) {
    logger.warn('notifyVisitStatusChangeFromTool failed', {
      visitId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
