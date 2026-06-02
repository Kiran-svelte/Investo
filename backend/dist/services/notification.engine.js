"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationEngine = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const config_1 = __importDefault(require("../config"));
const whatsapp_service_1 = require("./whatsapp.service");
function getCompanyWhatsAppConfig(company) {
    const settings = company?.settings || {};
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
            verifyToken: whatsapp.verifyToken || config_1.default.whatsapp.verifyToken,
            idInstance,
            apiTokenInstance,
            isCompanyConfigured: Boolean(idInstance && apiTokenInstance),
        };
    }
    const meta = whatsapp.meta || whatsapp;
    const phoneNumberId = meta.phoneNumberId || config_1.default.whatsapp.phoneNumberId;
    const accessToken = meta.accessToken || config_1.default.whatsapp.accessToken;
    const verifyToken = meta.verifyToken || config_1.default.whatsapp.verifyToken;
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
            logger_1.default.info('Notification created', { type: opts.type, userId: opts.userId });
        }
        catch (err) {
            logger_1.default.error('Failed to create notification', { error: err.message });
        }
    }
    /**
     * Notify assigned agent when a new lead is assigned.
     */
    async onLeadAssigned(lead, agentId) {
        const agent = await prisma_1.default.user.findUnique({ where: { id: agentId } });
        if (!agent)
            return;
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
     * Notify when lead is reassigned (old agent loses it, new agent gets it).
     */
    async onLeadReassigned(lead, oldAgentId, newAgentId) {
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
     */
    async onVisitScheduled(visit, lead, property, agent) {
        const visitTime = new Date(visit.scheduledAt);
        const timeStr = visitTime.toLocaleString('en-IN', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
        // Notify assigned agent
        await this.notify({
            companyId: visit.companyId,
            userId: visit.agentId,
            type: 'visit_scheduled',
            title: 'New Visit Scheduled',
            message: `Visit with ${lead?.customerName || lead?.phone || 'Customer'} at ${property?.name || 'Property'} on ${timeStr}`,
            data: { visitId: visit.id, leadId: visit.leadId },
        });
        // Notify company admins
        const admins = await prisma_1.default.user.findMany({
            where: { companyId: visit.companyId, role: 'company_admin', status: 'active' },
            select: { id: true },
        });
        for (const admin of admins) {
            if (admin.id !== visit.agentId) {
                await this.notify({
                    companyId: visit.companyId,
                    userId: admin.id,
                    type: 'visit_scheduled',
                    title: 'Visit Scheduled',
                    message: `${agent?.name || 'Agent'} scheduled a visit with ${lead?.customerName || lead?.phone} for ${timeStr}`,
                    data: { visitId: visit.id },
                });
            }
        }
    }
    /**
     * Notify when visit status changes (confirmed, completed, cancelled).
     */
    async onVisitStatusChange(visit, oldStatus, newStatus, lead, company) {
        const visitTime = new Date(visit.scheduledAt);
        const timeStr = visitTime.toLocaleString('en-IN', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
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
        // Send WhatsApp to customer
        if (lead?.phone) {
            const whatsappConfig = getCompanyWhatsAppConfig(company);
            if (!whatsappConfig.isCompanyConfigured ||
                (whatsappConfig.provider === 'meta'
                    ? !whatsappConfig.phoneNumberId || !whatsappConfig.accessToken
                    : !whatsappConfig.idInstance || !whatsappConfig.apiTokenInstance)) {
                logger_1.default.debug('Skipping WhatsApp visit notification (company not configured)', {
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
            }
            else if (newStatus === 'cancelled') {
                whatsappMsg = `Hi ${customerName},\n\nYour scheduled visit for ${timeStr} has been *cancelled*.\n\nWould you like to reschedule? Reply with your preferred date and time.`;
            }
            else if (newStatus === 'completed') {
                whatsappMsg = `Hi ${customerName}! 🏡\n\nThank you for visiting with us today!\n\nWe hope you liked the property. Feel free to ask any questions or let us know if you'd like to revisit.\n\nHow would you rate your visit experience? (1-5)`;
            }
            if (whatsappMsg) {
                try {
                    const sent = await whatsapp_service_1.whatsappService.sendMessage(lead.phone, whatsappMsg, {
                        provider: whatsappConfig.provider,
                        phoneNumberId: whatsappConfig.phoneNumberId,
                        accessToken: whatsappConfig.accessToken,
                        verifyToken: whatsappConfig.verifyToken,
                        idInstance: whatsappConfig.idInstance,
                        apiTokenInstance: whatsappConfig.apiTokenInstance,
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
    async onVisitRescheduled(visit, oldTime, newTime, lead, company) {
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
            if (!whatsappConfig.isCompanyConfigured ||
                (whatsappConfig.provider === 'meta'
                    ? !whatsappConfig.phoneNumberId || !whatsappConfig.accessToken
                    : !whatsappConfig.idInstance || !whatsappConfig.apiTokenInstance)) {
                logger_1.default.debug('Skipping WhatsApp reschedule notification (company not configured)', {
                    companyId: visit.companyId,
                    visitId: visit.id,
                });
                return;
            }
            const customerName = lead.customerName || 'there';
            const whatsappMsg = `Hi ${customerName}! 📅\n\nYour property visit has been *rescheduled*.\n\n❌ Old: ${oldTimeStr}\n✅ New: ${newTimeStr}\n\nPlease reply YES to confirm the new time.`;
            try {
                const sent = await whatsapp_service_1.whatsappService.sendMessage(lead.phone, whatsappMsg, {
                    provider: whatsappConfig.provider,
                    phoneNumberId: whatsappConfig.phoneNumberId,
                    accessToken: whatsappConfig.accessToken,
                    verifyToken: whatsappConfig.verifyToken,
                    idInstance: whatsappConfig.idInstance,
                    apiTokenInstance: whatsappConfig.apiTokenInstance,
                });
                if (!sent) {
                    logger_1.default.warn('Failed to send WhatsApp reschedule notification', {
                        companyId: visit.companyId,
                        visitId: visit.id,
                    });
                }
            }
            catch (err) {
                logger_1.default.warn('Failed to send reschedule WhatsApp', { error: err.message });
            }
        }
    }
}
exports.notificationEngine = new NotificationEngine();
