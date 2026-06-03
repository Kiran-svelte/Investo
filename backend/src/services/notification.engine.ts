import prisma from '../config/prisma';
import logger from '../config/logger';
import config from '../config';
import { NotificationType as PrismaNotificationType } from '@prisma/client';


/**
 * IST locale formatter used throughout notification messages.
 * @param date - Date to format
 * @returns Human-readable date-time string in IST
 */
function formatISTDateTime(date: Date): string {
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Send a WhatsApp message to a user using their company's configured WhatsApp.
 * Non-throwing — a notification failure must never block a business operation.
 * Uses dynamic import to avoid circular dependency with whatsapp.service.
 *
 * @param phone - Recipient's phone number
 * @param companyId - Company tenant for WhatsApp config lookup
 * @param message - Message text to send
 */
async function sendWhatsAppToUser(phone: string, companyId: string, message: string): Promise<void> {
  try {
    const { whatsappService } = await import('./whatsapp.service');
    await whatsappService.sendCompanyTextMessage(phone, message, companyId);
  } catch (err: unknown) {
    logger.warn('NotificationEngine: WhatsApp send failed', {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * NotificationEngine - Event-driven notifications.
 * When business events happen, the right people get notified.
 */

interface NotifyOptions {
  companyId: string;
  userId?: string | null; // null = broadcast to all company users
  type: PrismaNotificationType;
  title: string;
  message: string;
  data?: Record<string, any>;
}

function getCompanyWhatsAppConfig(company: any): {
  provider: 'meta' | 'greenapi';
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  idInstance?: string;
  apiTokenInstance?: string;
  isCompanyConfigured: boolean;
} {
  const settings = (company?.settings as any) || {};
  const whatsapp = settings.whatsapp || {};

  const provider = whatsapp.provider === 'greenapi' ? 'greenapi' : 'meta';

  if (provider === 'greenapi') {
    const greenapi = whatsapp.greenapi || whatsapp;
    const idInstance = greenapi.idInstance || whatsapp.phoneNumberId || '';
    const apiTokenInstance = greenapi.apiTokenInstance || whatsapp.apiTokenInstance || '';

    return {
      provider: 'greenapi',
      phoneNumberId: '',
      accessToken: '',
      verifyToken: whatsapp.verifyToken || config.whatsapp.verifyToken,
      idInstance,
      apiTokenInstance,
      isCompanyConfigured: Boolean(idInstance && apiTokenInstance),
    };
  }

  const meta = whatsapp.meta || whatsapp;
  const phoneNumberId = meta.phoneNumberId || config.whatsapp.phoneNumberId;
  const accessToken = meta.accessToken || config.whatsapp.accessToken;
  const verifyToken = meta.verifyToken || config.whatsapp.verifyToken;

  return {
    provider: 'meta',
    phoneNumberId,
    accessToken,
    verifyToken,
    isCompanyConfigured: Boolean(meta.phoneNumberId && meta.accessToken),
  };
}

class NotificationEngine {
  /**
   * Create an in-app notification.
   */
  async notify(opts: NotifyOptions): Promise<void> {
    try {
      await prisma.notification.create({
        data: {
          companyId: opts.companyId,
          userId: opts.userId || null,
          type: opts.type,
          title: opts.title,
          message: opts.message,
          data: opts.data ?? {},
        },
      });
      logger.info('Notification created', { type: opts.type, userId: opts.userId });
    } catch (err: any) {
      logger.error('Failed to create notification', { error: err.message });
    }
  }

  /**
   * Notify assigned agent when a new lead is assigned.
   * Creates DB notification AND sends WhatsApp so the agent is immediately aware.
   *
   * @param lead - The newly assigned lead record
   * @param agentId - ID of the agent receiving the assignment
   */
  async onLeadAssigned(lead: any, agentId: string): Promise<void> {
    const agent = await prisma.user.findUnique({ where: { id: agentId } });
    if (!agent) return;

    await this.notify({
      companyId: lead.companyId,
      userId: agentId,
      type: 'lead_assigned',
      title: 'New Lead Assigned',
      message: `You have been assigned a new lead: ${lead.customerName || lead.phone}`,
      data: { leadId: lead.id },
    });

    // Send WhatsApp so the agent is notified immediately, not just in-app.
    // Uses dynamic import to avoid circular dependency with whatsapp.service.
    if (agent?.phone) {
      const { notifyAgentOfNewLead } = await import('./leadAssignment.service');
      void notifyAgentOfNewLead(agentId, lead.id, lead.companyId);
    } else {
      // agent.phone may be missing if caller passed a partial record; fetch it
      const fullAgent = await prisma.user.findUnique({
        where: { id: agentId },
        select: { phone: true },
      });
      if (fullAgent?.phone) {
        const { notifyAgentOfNewLead } = await import('./leadAssignment.service');
        void notifyAgentOfNewLead(agentId, lead.id, lead.companyId);
      }
    }
  }

  /**
   * Notify when lead is reassigned (old agent loses it, new agent gets it).
   */
  async onLeadReassigned(lead: any, oldAgentId: string | null, newAgentId: string): Promise<void> {
    // Notify old agent (removed)
    if (oldAgentId && oldAgentId !== newAgentId) {
      await this.notify({
        companyId: lead.companyId,
        userId: oldAgentId,
        type: 'lead_reassigned',
        title: 'Lead Reassigned',
        message: `Lead ${lead.customerName || lead.phone} has been reassigned to another agent.`,
        data: { leadId: lead.id },
      });
    }

    // Notify new agent (assigned)
    await this.notify({
      companyId: lead.companyId,
      userId: newAgentId,
      type: 'lead_assigned',
      title: 'Lead Assigned to You',
      message: `You have been assigned lead: ${lead.customerName || lead.phone}`,
      data: { leadId: lead.id },
    });
  }

  /**
   * Notify on lead status change.
   */
  async onLeadStatusChange(lead: any, oldStatus: string, newStatus: string): Promise<void> {
    // Notify assigned agent
    if (lead.assignedAgentId) {
      await this.notify({
        companyId: lead.companyId,
        userId: lead.assignedAgentId,
        type: 'lead_status_change',
        title: 'Lead Status Updated',
        message: `${lead.customerName || lead.phone} moved from ${oldStatus} to ${newStatus}`,
        data: { leadId: lead.id, oldStatus, newStatus },
      });
    }

    // Notify company admins for closures
    if (newStatus === 'closed_won' || newStatus === 'closed_lost') {
      const admins = await prisma.user.findMany({
        where: { companyId: lead.companyId, role: 'company_admin', status: 'active' },
        select: { id: true },
      });

      for (const admin of admins) {
        await this.notify({
          companyId: lead.companyId,
          userId: admin.id,
          type: 'system_alert',
          title: newStatus === 'closed_won' ? 'Deal Won' : 'Deal Lost',
          message: `Lead ${lead.customerName || lead.phone} has been ${newStatus === 'closed_won' ? 'closed as won' : 'closed as lost'}`,
          data: { leadId: lead.id, status: newStatus },
        });
      }
    }
  }

  /**
   * Notify when a visit is scheduled.
   * Creates DB notifications for agent and admins AND sends WhatsApp to the
   * assigned agent immediately so they can prepare.
   *
   * @param visit - The newly created visit record
   * @param lead - The associated lead
   * @param property - The property being visited
   * @param agent - The assigned agent user record
   */
  async onVisitScheduled(visit: any, lead: any, property: any, agent: any): Promise<void> {
    const timeStr = formatISTDateTime(new Date(visit.scheduledAt));
    const customerName = lead?.customerName || lead?.phone || 'Customer';
    const propertyName = property?.name || 'Property';
    const agentName = agent?.name || 'Agent';

    // 1. DB notification for the assigned agent
    await this.notify({
      companyId: visit.companyId,
      userId: visit.agentId,
      type: 'visit_scheduled',
      title: 'New Visit Scheduled',
      message: `Visit with ${customerName} at ${propertyName} on ${timeStr}`,
      data: { visitId: visit.id, leadId: visit.leadId },
    });

    // 2. WhatsApp to the assigned agent — the critical missing piece.
    //    Agent must know immediately, not wait for their next dashboard login.
    if (agent?.phone) {
      const whatsappMsg = [
        `📅 *New Visit Booked*`,
        ``,
        `Customer: *${customerName}*`,
        `Property: *${propertyName}*`,
        `When: *${timeStr}*`,
        ``,
        `Reply to update or ask anything about this visit.`,
      ].join('\n');
      void sendWhatsAppToUser(agent.phone, visit.companyId, whatsappMsg);
    } else {
      // Fetch phone in case caller passed partial agent object
      const fullAgent = await prisma.user.findUnique({
        where: { id: visit.agentId },
        select: { phone: true },
      });
      if (fullAgent?.phone) {
        const whatsappMsg = [
          `📅 *New Visit Booked*`,
          ``,
          `Customer: *${customerName}*`,
          `Property: *${propertyName}*`,
          `When: *${timeStr}*`,
          ``,
          `Reply to update or ask anything about this visit.`,
        ].join('\n');
        void sendWhatsAppToUser(fullAgent.phone, visit.companyId, whatsappMsg);
      }
    }

    // 3. DB notification for company admins
    const admins = await prisma.user.findMany({
      where: { companyId: visit.companyId, role: 'company_admin', status: 'active' },
      select: { id: true, phone: true },
    });

    for (const admin of admins) {
      if (admin.id === visit.agentId) continue;
      await this.notify({
        companyId: visit.companyId,
        userId: admin.id,
        type: 'visit_scheduled',
        title: 'Visit Scheduled',
        message: `${agentName} scheduled a visit with ${customerName} for ${timeStr}`,
        data: { visitId: visit.id },
      });
      // Also WhatsApp admins so they see it in real time
      if (admin.phone) {
        const adminMsg = [
          `📅 *Visit Scheduled*`,
          `Agent: *${agentName}*`,
          `Customer: *${customerName}*`,
          `Property: *${propertyName}*`,
          `When: *${timeStr}*`,
        ].join('\n');
        void sendWhatsAppToUser(admin.phone, visit.companyId, adminMsg);
      }
    }
  }

  /**
   * Notify when visit status changes (confirmed, completed, cancelled).
   */
  async onVisitStatusChange(
    visit: any,
    oldStatus: string,
    newStatus: string,
    lead: any,
    company: any
  ): Promise<void> {
    const visitTime = new Date(visit.scheduledAt);
    const timeStr = visitTime.toLocaleString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Notify agent
    const notifType = (
      newStatus === 'confirmed'
        ? 'visit_confirmed'
        : newStatus === 'completed'
          ? 'visit_completed'
          : newStatus === 'cancelled'
            ? 'visit_cancelled'
            : 'visit_scheduled'
    ) as PrismaNotificationType;

    await this.notify({
      companyId: visit.companyId,
      userId: visit.agentId,
      type: notifType,
      title: `Visit ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}`,
      message: `Visit with ${lead?.customerName || lead?.phone} is now ${newStatus}`,
      data: { visitId: visit.id, oldStatus, newStatus },
    });

    // Send WhatsApp to customer
    if (lead?.phone) {
      const whatsappConfig = getCompanyWhatsAppConfig(company);
      if (
        !whatsappConfig.isCompanyConfigured ||
        (whatsappConfig.provider === 'meta'
          ? !whatsappConfig.phoneNumberId || !whatsappConfig.accessToken
          : !whatsappConfig.idInstance || !whatsappConfig.apiTokenInstance)
      ) {
        logger.debug('Skipping WhatsApp visit notification (company not configured)', {
          companyId: visit.companyId,
          visitId: visit.id,
          status: newStatus,
        });
        return;
      }

      const customerName = lead.customerName || 'there';
      let whatsappMsg = '';

      if (newStatus === 'confirmed') {
        whatsappMsg = `Hi ${customerName}! ✅\n\nYour property visit is *confirmed* for:\n📅 ${timeStr}\n\nWe look forward to seeing you!`;
      } else if (newStatus === 'cancelled') {
        whatsappMsg = `Hi ${customerName},\n\nYour scheduled visit for ${timeStr} has been *cancelled*.\n\nWould you like to reschedule? Reply with your preferred date and time.`;
      } else if (newStatus === 'completed') {
        whatsappMsg = `Hi ${customerName}! 🏡\n\nThank you for visiting with us today!\n\nWe hope you liked the property. Feel free to ask any questions or let us know if you'd like to revisit.\n\nHow would you rate your visit experience? (1-5)`;
      }

      if (whatsappMsg) {
        try {
          const { whatsappService } = await import('./whatsapp.service');
          const sent = await whatsappService.sendMessage(lead.phone, whatsappMsg, {
            provider: whatsappConfig.provider,
            phoneNumberId: whatsappConfig.phoneNumberId,
            accessToken: whatsappConfig.accessToken,
            verifyToken: whatsappConfig.verifyToken,
            idInstance: whatsappConfig.idInstance,
            apiTokenInstance: whatsappConfig.apiTokenInstance,
          });
          if (!sent) {
            logger.warn('Failed to send WhatsApp visit notification', {
              companyId: visit.companyId,
              visitId: visit.id,
              status: newStatus,
            });
          }
        } catch (err: any) {
          logger.warn('Failed to send WhatsApp notification', { error: err.message });
        }
      }
    }
  }

  /**
   * Notify when visit is rescheduled.
   */
  async onVisitRescheduled(
    visit: any,
    oldTime: Date,
    newTime: Date,
    lead: any,
    company: any
  ): Promise<void> {
    const oldTimeStr = oldTime.toLocaleString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    const newTimeStr = newTime.toLocaleString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Notify agent
    await this.notify({
      companyId: visit.companyId,
      userId: visit.agentId,
      type: 'visit_rescheduled',
      title: 'Visit Rescheduled',
      message: `Visit with ${lead?.customerName || lead?.phone} moved from ${oldTimeStr} to ${newTimeStr}`,
      data: { visitId: visit.id, oldTime: oldTime.toISOString(), newTime: newTime.toISOString() },
    });

    // Send WhatsApp to customer
    if (lead?.phone) {
      const whatsappConfig = getCompanyWhatsAppConfig(company);
      if (
        !whatsappConfig.isCompanyConfigured ||
        (whatsappConfig.provider === 'meta'
          ? !whatsappConfig.phoneNumberId || !whatsappConfig.accessToken
          : !whatsappConfig.idInstance || !whatsappConfig.apiTokenInstance)
      ) {
        logger.debug('Skipping WhatsApp reschedule notification (company not configured)', {
          companyId: visit.companyId,
          visitId: visit.id,
        });
        return;
      }

      const customerName = lead.customerName || 'there';
      const whatsappMsg = `Hi ${customerName}! 📅\n\nYour property visit has been *rescheduled*.\n\n❌ Old: ${oldTimeStr}\n✅ New: ${newTimeStr}\n\nPlease reply YES to confirm the new time.`;

      try {
        const { whatsappService } = await import('./whatsapp.service');
        const sent = await whatsappService.sendMessage(lead.phone, whatsappMsg, {
          provider: whatsappConfig.provider,
          phoneNumberId: whatsappConfig.phoneNumberId,
          accessToken: whatsappConfig.accessToken,
          verifyToken: whatsappConfig.verifyToken,
          idInstance: whatsappConfig.idInstance,
          apiTokenInstance: whatsappConfig.apiTokenInstance,
        });
        if (!sent) {
          logger.warn('Failed to send WhatsApp reschedule notification', {
            companyId: visit.companyId,
            visitId: visit.id,
          });
        }
      } catch (err: any) {
        logger.warn('Failed to send reschedule WhatsApp', { error: err.message });
      }
    }
  }
}

export const notificationEngine = new NotificationEngine();
