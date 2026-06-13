"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationEngine = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const socket_service_1 = require("./socket.service");
const notificationRetry_service_1 = require("./notificationRetry.service");
const dateTime_util_1 = require("../utils/dateTime.util");
const tenantAgentValidation_util_1 = require("../utils/tenantAgentValidation.util");
const companyWhatsAppConfig_util_1 = require("../utils/companyWhatsAppConfig.util");
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
async function sendWhatsAppToUser(phone, companyId, message, label = 'notification_engine_whatsapp') {
    try {
        await (0, notificationRetry_service_1.withRetry)(async () => {
            const { whatsappService } = await Promise.resolve().then(() => __importStar(require('./whatsapp.service')));
            await whatsappService.sendCompanyTextMessage(phone, message, companyId);
        }, { label, maxAttempts: 3, baseDelayMs: 1000, jitterMs: 200 });
    }
    catch (err) {
        logger_1.default.error('NotificationEngine: WhatsApp send failed after retries', {
            companyId,
            label,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
function getCompanyWhatsAppConfig(company) {
    const resolved = (0, companyWhatsAppConfig_util_1.resolveCompanyWhatsAppConfigFromSettings)(company?.settings);
    if (!resolved) {
        return {
            provider: 'meta',
            phoneNumberId: '',
            accessToken: '',
            verifyToken: '',
            isCompanyConfigured: false,
        };
    }
    return {
        ...resolved,
        isCompanyConfigured: (0, companyWhatsAppConfig_util_1.isCompanyWhatsAppConfigured)(company?.settings),
    };
}
class NotificationEngine {
    /**
     * Create an in-app notification.
     */
    async notify(opts) {
        try {
            await prisma_1.default.notification.create({
                data: {
                    companyId: opts.companyId,
                    userId: opts.userId || null,
                    type: opts.type,
                    title: opts.title,
                    message: opts.message,
                    data: opts.data ?? {},
                },
            });
            logger_1.default.info('Notification created', { type: opts.type, userId: opts.userId, companyId: opts.companyId });
            socket_service_1.socketService.emitToCompany(opts.companyId, socket_service_1.SOCKET_EVENTS.NOTIFICATION_NEW, {
                userId: opts.userId ?? null,
                type: opts.type,
                title: opts.title,
                occurredAt: new Date().toISOString(),
            });
        }
        catch (err) {
            // Log with full context — this is a data-loss event; the in-app notification
            // was not persisted. Caller should still proceed with business logic.
            logger_1.default.error('NotificationEngine: failed to create notification in DB', {
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
    async onLeadAssigned(lead, agentId) {
        const belongs = await (0, tenantAgentValidation_util_1.assertUserBelongsToCompany)(lead.companyId, agentId);
        if (!belongs) {
            logger_1.default.warn('NotificationEngine: skipped lead assignment notification for foreign agent', {
                leadId: lead.id,
                agentId,
                companyId: lead.companyId,
            });
            return;
        }
        const agent = await prisma_1.default.user.findFirst({
            where: { id: agentId, companyId: lead.companyId },
            select: { id: true },
        });
        if (!agent)
            return;
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
    async notifyAgentByWhatsApp(opts) {
        try {
            await sendWhatsAppToUser(opts.agentPhone, opts.companyId, opts.message, 'agent_whatsapp_alert');
            logger_1.default.info('Agent WhatsApp alert sent', { companyId: opts.companyId, phone: opts.agentPhone.slice(-4) });
        }
        catch (err) {
            logger_1.default.error('NotificationEngine: agent WhatsApp alert failed', {
                companyId: opts.companyId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    /**
     * Notify when lead is reassigned (old agent loses it, new agent gets it).
     */
    async onLeadReassigned(lead, oldAgentId, newAgentId) {
        const newAgentBelongs = await (0, tenantAgentValidation_util_1.assertUserBelongsToCompany)(lead.companyId, newAgentId);
        if (!newAgentBelongs) {
            logger_1.default.warn('NotificationEngine: skipped lead reassignment notification for foreign agent', {
                leadId: lead.id,
                newAgentId,
                companyId: lead.companyId,
            });
            return;
        }
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
    async onLeadStatusChange(lead, oldStatus, newStatus) {
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
            const admins = await prisma_1.default.user.findMany({
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
    async onVisitScheduled(visit, lead, property, agent) {
        const timeStr = (0, dateTime_util_1.formatISTDateTime)(new Date(visit.scheduledAt));
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
            void Promise.resolve().then(() => __importStar(require('./clientMemory.service'))).then(({ setAgentSessionClientContext, syncLeadClientMemory }) => {
                void setAgentSessionClientContext({
                    userId: visit.agentId,
                    phone: agent.phone,
                    leadId: visit.leadId,
                    visitId: visit.id,
                });
                void syncLeadClientMemory(visit.leadId);
            });
        }
        else {
            // Fetch phone in case caller passed partial agent object
            const fullAgent = await prisma_1.default.user.findUnique({
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
                void Promise.resolve().then(() => __importStar(require('./clientMemory.service'))).then(({ setAgentSessionClientContext, syncLeadClientMemory }) => {
                    void setAgentSessionClientContext({
                        userId: visit.agentId,
                        phone: fullAgent.phone,
                        leadId: visit.leadId,
                        visitId: visit.id,
                    });
                    void syncLeadClientMemory(visit.leadId);
                });
            }
        }
        // 3. DB notification for company admins
        const admins = await prisma_1.default.user.findMany({
            where: { companyId: visit.companyId, role: 'company_admin', status: 'active' },
            select: { id: true, phone: true },
        });
        for (const admin of admins) {
            if (admin.id === visit.agentId)
                continue;
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
    async onVisitStatusChange(visit, oldStatus, newStatus, lead, company, suppressCustomerNotification = false) {
        const visitTime = new Date(visit.scheduledAt);
        const timeStr = (0, dateTime_util_1.formatISTDateTime)(visitTime);
        // Notify agent
        const notifType = (newStatus === 'confirmed'
            ? 'visit_confirmed'
            : newStatus === 'completed'
                ? 'visit_completed'
                : newStatus === 'cancelled'
                    ? 'visit_cancelled'
                    : 'visit_scheduled');
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
        const agentRecord = await prisma_1.default.user.findUnique({
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
            if (!whatsappConfig.isCompanyConfigured ||
                !whatsappConfig.phoneNumberId ||
                !whatsappConfig.accessToken) {
                logger_1.default.debug('Skipping WhatsApp visit notification (company not configured)', {
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
            }
            else if (newStatus === 'confirmed') {
                whatsappMsg = `Hi ${customerName}! ✅\n\nYour property visit is *confirmed* for:\n📅 ${timeStr}\n\nWe look forward to seeing you!`;
            }
            else if (newStatus === 'cancelled') {
                whatsappMsg = `Hi ${customerName},\n\nYour scheduled visit for ${timeStr} has been *cancelled*.\n\nWould you like to reschedule? Reply with your preferred date and time.`;
            }
            else if (newStatus === 'completed') {
                whatsappMsg = `Hi ${customerName}! 🏡\n\nThank you for visiting with us today!\n\nWe hope you liked the property. Feel free to ask any questions or let us know if you'd like to revisit.\n\nHow would you rate your visit experience? (1-5)`;
            }
            if (whatsappMsg) {
                try {
                    const { whatsappService } = await Promise.resolve().then(() => __importStar(require('./whatsapp.service')));
                    const sent = await whatsappService.sendMessage(lead.phone, whatsappMsg, {
                        provider: whatsappConfig.provider,
                        phoneNumberId: whatsappConfig.phoneNumberId,
                        accessToken: whatsappConfig.accessToken,
                        verifyToken: whatsappConfig.verifyToken,
                    });
                    if (!sent) {
                        logger_1.default.warn('Failed to send WhatsApp visit notification', {
                            companyId: visit.companyId,
                            visitId: visit.id,
                            status: newStatus,
                        });
                    }
                }
                catch (err) {
                    logger_1.default.warn('Failed to send WhatsApp notification', { error: err.message });
                }
            }
        }
    }
    /**
     * Notify when visit is rescheduled.
     */
    async onVisitRescheduled(visit, oldTime, newTime, lead, company, 
    /**
     * When true, skip the WhatsApp message to the customer.
     * Set this for buyer-initiated reschedules: the main handler
     * (whatsapp.service.ts visitCommit path) already sends the reply.
     */
    suppressCustomerNotification = false) {
        const oldTimeStr = (0, dateTime_util_1.formatISTDateTime)(oldTime);
        const newTimeStr = (0, dateTime_util_1.formatISTDateTime)(newTime);
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
        const agentRecord = await prisma_1.default.user.findUnique({
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
            void Promise.resolve().then(() => __importStar(require('./clientMemory.service'))).then(({ setAgentSessionClientContext }) => {
                void setAgentSessionClientContext({
                    userId: visit.agentId,
                    phone: agentRecord.phone,
                    leadId: visit.leadId,
                    visitId: visit.id,
                });
            });
        }
        // 3. DB + WhatsApp to company admins (same pattern as onVisitScheduled)
        const admins = await prisma_1.default.user.findMany({
            where: { companyId: visit.companyId, role: 'company_admin', status: 'active' },
            select: { id: true, phone: true },
        });
        for (const admin of admins) {
            if (admin.id === visit.agentId)
                continue; // agent already notified above
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
            if (!whatsappConfig.isCompanyConfigured ||
                !whatsappConfig.phoneNumberId ||
                !whatsappConfig.accessToken) {
                logger_1.default.debug('Skipping customer WhatsApp reschedule notification (company not configured)', {
                    companyId: visit.companyId,
                    visitId: visit.id,
                });
                return;
            }
            const whatsappMsg = `Hi ${customerName}! 📅\n\nYour property visit has been *rescheduled*.\n\n❌ Old: ${oldTimeStr}\n✅ New: ${newTimeStr}\n\nPlease reply YES to confirm the new time.`;
            try {
                const { whatsappService } = await Promise.resolve().then(() => __importStar(require('./whatsapp.service')));
                const sent = await whatsappService.sendMessage(lead.phone, whatsappMsg, {
                    provider: whatsappConfig.provider,
                    phoneNumberId: whatsappConfig.phoneNumberId,
                    accessToken: whatsappConfig.accessToken,
                    verifyToken: whatsappConfig.verifyToken,
                });
                if (!sent) {
                    logger_1.default.warn('Failed to send WhatsApp reschedule notification to customer', {
                        companyId: visit.companyId,
                        visitId: visit.id,
                    });
                }
            }
            catch (err) {
                logger_1.default.warn('Failed to send reschedule WhatsApp to customer', { error: err.message });
            }
        }
    }
}
exports.notificationEngine = new NotificationEngine();
