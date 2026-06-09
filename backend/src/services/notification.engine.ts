import prisma from '../config/prisma';
import logger from '../config/logger';
import config from '../config';
import { NotificationType as PrismaNotificationType } from '@prisma/client';
import { socketService, SOCKET_EVENTS } from './socket.service';
import { withRetry } from './notificationRetry.service';


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
 * Retries up to 3 times with exponential backoff on transient errors.
 *
 * @param phone - Recipient's phone number
 * @param companyId - Company tenant for WhatsApp config lookup
 * @param message - Message text to send
 * @param label - Structured log label for identifying the call site in dashboards
 */
async function sendWhatsAppToUser(
  phone: string,
  companyId: string,
  message: string,
  label = 'notification_engine_whatsapp',
): Promise<void> {
  try {
    await withRetry(
      async () => {
        const { whatsappService } = await import('./whatsapp.service');
        await whatsappService.sendCompanyTextMessage(phone, message, companyId);
      },
      { label, maxAttempts: 3, baseDelayMs: 1000, jitterMs: 200 },
    );
  } catch (err: unknown) {
    logger.error('NotificationEngine: WhatsApp send failed after retries', {
      companyId,
      label,
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
  provider: 'meta';
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  isCompanyConfigured: boolean;
} {
  const settings = (company?.settings as any) || {};
  const whatsapp = settings.whatsapp || {};

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
      logger.info('Notification created', { type: opts.type, userId: opts.userId, companyId: opts.companyId });
      socketService.emitToCompany(opts.companyId, SOCKET_EVENTS.NOTIFICATION_NEW, {
        userId: opts.userId ?? null,
        type: opts.type,
        title: opts.title,
        occurredAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      // Log with full context — this is a data-loss event; the in-app notification
      // was not persisted. Caller should still proceed with business logic.
      logger.error('NotificationEngine: failed to create notification in DB', {
        companyId: opts.companyId,
        userId: opts.userId,
        type: opts.type,
        title: opts.title,
        error: err instanceof Error ? err.message : String(err),
      });
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

    // DB in-app notification only.
    // The WhatsApp push is handled by the notifyAgent workflow step or
    // notifyAgentOfNewLead in leadAssignment.service.ts — not here — to
    // avoid duplicate messages.
    await this.notify({
      companyId: lead.companyId,
      userId: agentId,
      type: 'lead_assigned',
      title: 'New Lead Assigned',
      message: `You have been assigned a new lead: ${lead.customerName || lead.phone}`,
      data: { leadId: lead.id },
    });
  }

  /**
   * Send a WhatsApp message directly to an agent's personal phone number.
   * Used for time-critical alerts (visit bookings, customer messages, escalations)
   * so agents are notified even when not logged into the dashboard.
   * Non-throwing — notification failure must never block business logic.
   *
   * @param opts.agentPhone - Agent's personal phone number in E.164 format
   * @param opts.companyId - Company tenant for WhatsApp config lookup
   * @param opts.message - WhatsApp message body to send
   */
  async notifyAgentByWhatsApp(opts: {
    agentPhone: string;
    companyId: string;
    message: string;
  }): Promise<void> {
    try {
      await sendWhatsAppToUser(opts.agentPhone, opts.companyId, opts.message, 'agent_whatsapp_alert');
      logger.info('Agent WhatsApp alert sent', { companyId: opts.companyId, phone: opts.agentPhone.slice(-4) });
    } catch (err: unknown) {
      logger.error('NotificationEngine: agent WhatsApp alert failed', {
        companyId: opts.companyId,
        error: err instanceof Error ? err.message : String(err),
      });
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
      void import('./clientMemory.service').then(({ setAgentSessionClientContext, syncLeadClientMemory }) => {
        void setAgentSessionClientContext({
          userId: visit.agentId,
          phone: agent.phone,
          leadId: visit.leadId,
          visitId: visit.id,
        });
        void syncLeadClientMemory(visit.leadId);
      });
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
        void import('./clientMemory.service').then(({ setAgentSessionClientContext, syncLeadClientMemory }) => {
          void setAgentSessionClientContext({
            userId: visit.agentId,
            phone: fullAgent.phone!,
            leadId: visit.leadId,
            visitId: visit.id,
          });
          void syncLeadClientMemory(visit.leadId);
        });
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
    company: any,
    suppressCustomerNotification = false,
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

    const customerName = lead?.customerName || lead?.phone || 'Customer';
    const propertyName = visit.property?.name ?? 'Property';
    const agentRecord = await prisma.user.findUnique({
      where: { id: visit.agentId },
      select: { phone: true },
    });
    if (agentRecord?.phone && ['confirmed', 'completed', 'cancelled'].includes(newStatus)) {
      const statusEmoji = newStatus === 'confirmed' ? '✅' : newStatus === 'completed' ? '🏁' : '❌';
      const agentMsg = [
        `${statusEmoji} *Visit ${newStatus.charAt(0).toUpperCase() + newStatus.slice(1)}*`,
        `Customer: *${customerName}*`,
        `Property: *${propertyName}*`,
        `When: *${timeStr}*`,
      ].join('\n');
      void sendWhatsAppToUser(agentRecord.phone, visit.companyId, agentMsg);
    }

    // Send WhatsApp to customer (skip when buyer-initiated cancel/reschedule owns the reply)
    if (!suppressCustomerNotification && lead?.phone) {
      const whatsappConfig = getCompanyWhatsAppConfig(company);
      if (
        !whatsappConfig.isCompanyConfigured ||
        !whatsappConfig.phoneNumberId ||
        !whatsappConfig.accessToken
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

      if (newStatus === 'scheduled' && oldStatus === 'pending_approval') {
        // Agent approved a pending_approval visit from the dashboard — notify the buyer.
        whatsappMsg = `Hi ${customerName}! 🎉\n\nYour visit request has been *approved*!\n\n📅 Visit scheduled for: *${timeStr}*\n\nWe look forward to meeting you! If you need to reschedule, just let us know.`;
      } else if (newStatus === 'confirmed') {
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
    company: any,
    /**
     * When true, skip the WhatsApp message to the customer.
     * Set this for buyer-initiated reschedules: the main handler
     * (whatsapp.service.ts visitCommit path) already sends the reply.
     */
    suppressCustomerNotification = false,
  ): Promise<void> {
    const oldTimeStr = oldTime.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    const newTimeStr = newTime.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    const customerName = lead?.customerName || lead?.phone || 'Customer';
    const propertyName = visit.property?.name ?? 'Property';

    // 1. DB notification for the assigned agent
    await this.notify({
      companyId: visit.companyId,
      userId: visit.agentId,
      type: 'visit_rescheduled',
      title: 'Visit Rescheduled',
      message: `Visit with ${customerName} moved from ${oldTimeStr} to ${newTimeStr}`,
      data: { visitId: visit.id, oldTime: oldTime.toISOString(), newTime: newTime.toISOString() },
    });

    // 2. WhatsApp to the assigned agent — critical for real-time awareness.
    //    The agent must know immediately, not wait for their next dashboard login.
    const agentRecord = await prisma.user.findUnique({
      where: { id: visit.agentId },
      select: { phone: true, name: true },
    });
    if (agentRecord?.phone) {
      const agentMsg = [
        `📅 *Visit Rescheduled*`,
        ``,
        `Customer: *${customerName}*`,
        `Property: *${propertyName}*`,
        ``,
        `❌ Was: *${oldTimeStr}*`,
        `✅ Now: *${newTimeStr}*`,
        ``,
        `Please confirm your availability for the new time.`,
      ].join('\n');
      void sendWhatsAppToUser(agentRecord.phone, visit.companyId, agentMsg);

      // Update agent session context so the copilot knows about this visit
      void import('./clientMemory.service').then(({ setAgentSessionClientContext }) => {
        void setAgentSessionClientContext({
          userId: visit.agentId,
          phone: agentRecord.phone!,
          leadId: visit.leadId,
          visitId: visit.id,
        });
      });
    }

    // 3. DB + WhatsApp to company admins (same pattern as onVisitScheduled)
    const admins = await prisma.user.findMany({
      where: { companyId: visit.companyId, role: 'company_admin', status: 'active' },
      select: { id: true, phone: true },
    });
    for (const admin of admins) {
      if (admin.id === visit.agentId) continue; // agent already notified above
      await this.notify({
        companyId: visit.companyId,
        userId: admin.id,
        type: 'visit_rescheduled',
        title: 'Visit Rescheduled',
        message: `${customerName} rescheduled from ${oldTimeStr} to ${newTimeStr}`,
        data: { visitId: visit.id },
      });
      if (admin.phone) {
        const adminMsg = [
          `📅 *Visit Rescheduled*`,
          `Customer: *${customerName}*`,
          `Property: *${propertyName}*`,
          `❌ Was: *${oldTimeStr}*`,
          `✅ Now: *${newTimeStr}*`,
        ].join('\n');
        void sendWhatsAppToUser(admin.phone, visit.companyId, adminMsg);
      }
    }

    // 4. WhatsApp to the customer — confirmation of the reschedule.
    // Skip when suppressCustomerNotification=true (buyer-initiated reschedule:
    // the main handler already sent visitCommit.customerReply as the primary reply).
    if (!suppressCustomerNotification && lead?.phone) {
      const whatsappConfig = getCompanyWhatsAppConfig(company);
      if (
        !whatsappConfig.isCompanyConfigured ||
        !whatsappConfig.phoneNumberId ||
        !whatsappConfig.accessToken
      ) {
        logger.debug('Skipping customer WhatsApp reschedule notification (company not configured)', {
          companyId: visit.companyId,
          visitId: visit.id,
        });
        return;
      }

      const whatsappMsg = `Hi ${customerName}! 📅\n\nYour property visit has been *rescheduled*.\n\n❌ Old: ${oldTimeStr}\n✅ New: ${newTimeStr}\n\nPlease reply YES to confirm the new time.`;

      try {
        const { whatsappService } = await import('./whatsapp.service');
        const sent = await whatsappService.sendMessage(lead.phone, whatsappMsg, {
          provider: whatsappConfig.provider,
          phoneNumberId: whatsappConfig.phoneNumberId,
          accessToken: whatsappConfig.accessToken,
          verifyToken: whatsappConfig.verifyToken,
        });
        if (!sent) {
          logger.warn('Failed to send WhatsApp reschedule notification to customer', {
            companyId: visit.companyId,
            visitId: visit.id,
          });
        }
      } catch (err: any) {
        logger.warn('Failed to send reschedule WhatsApp to customer', { error: err.message });
      }
    }
  }
}

export const notificationEngine = new NotificationEngine();
