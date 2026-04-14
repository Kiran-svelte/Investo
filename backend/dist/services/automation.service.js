"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.automationService = exports.AutomationService = void 0;
const uuid_1 = require("uuid");
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const config_1 = __importDefault(require("../config"));
const whatsapp_service_1 = require("./whatsapp.service");
const automationQueue_service_1 = require("./automationQueue.service");
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
/**
 * Automation Service - handles scheduled tasks through a durable queue-backed workflow:
 * - Visit reminders (24h and 1h before)
 * - Follow-up automation
 * - Lead assignment
 * - Analytics aggregation
 */
class AutomationService {
    constructor() {
        this.intervalIds = [];
        this.workerIntervalId = null;
        this.workerRunning = false;
    }
    /**
     * Start all scheduled jobs.
     * In production, use a proper job scheduler like Bull or Agenda.
     */
    start() {
        logger_1.default.info('Starting automation service');
        // Visit reminders - check every 15 minutes
        this.intervalIds.push(setInterval(() => this.processVisitReminders(), 15 * 60 * 1000));
        // Follow-up automation - check every hour
        this.intervalIds.push(setInterval(() => this.processFollowUps(), 60 * 60 * 1000));
        // Conversation timeout (24h inactivity) - check every hour
        this.intervalIds.push(setInterval(() => this.processConversationTimeouts(), 60 * 60 * 1000));
        this.startWorker();
        // Run immediately on startup
        this.processVisitReminders();
        this.processFollowUps();
    }
    /**
     * Stop all scheduled jobs.
     */
    stop() {
        this.intervalIds.forEach((id) => clearInterval(id));
        this.intervalIds = [];
        if (this.workerIntervalId) {
            clearInterval(this.workerIntervalId);
            this.workerIntervalId = null;
        }
        logger_1.default.info('Automation service stopped');
    }
    /**
     * Process visit reminders.
     * Sends WhatsApp reminders:
     * - 24 hours before visit
     * - 1 hour before visit
     * Also creates notifications for agents.
     */
    async processVisitReminders() {
        try {
            const now = new Date();
            // 24-hour reminders
            const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000);
            const visits24h = await prisma_1.default.visit.findMany({
                where: {
                    status: { in: ['scheduled', 'confirmed'] },
                    reminderSent: false,
                    scheduledAt: { gte: in23h, lte: in24h },
                },
                include: {
                    lead: { select: { customerName: true, phone: true, language: true } },
                    property: { select: { name: true, locationArea: true } },
                    company: { select: { whatsappPhone: true, settings: true } },
                },
            });
            for (const visit of visits24h) {
                await this.enqueueJob('visit_reminder_24h', `visit:${visit.id}:24h`, now, {
                    visitId: visit.id,
                    timing: '24h',
                });
            }
            // 1-hour reminders
            const in1h = new Date(now.getTime() + 60 * 60 * 1000);
            const in45m = new Date(now.getTime() + 45 * 60 * 1000);
            const visits1h = await prisma_1.default.visit.findMany({
                where: {
                    status: { in: ['scheduled', 'confirmed'] },
                    scheduledAt: { gte: in45m, lte: in1h },
                },
                include: {
                    lead: { select: { customerName: true, phone: true, language: true } },
                    property: { select: { name: true, locationArea: true } },
                    company: { select: { whatsappPhone: true, settings: true } },
                },
            });
            for (const visit of visits1h) {
                await this.enqueueJob('visit_reminder_1h', `visit:${visit.id}:1h`, now, {
                    visitId: visit.id,
                    timing: '1h',
                });
            }
            // 15-minute agent notifications
            const in15m = new Date(now.getTime() + 15 * 60 * 1000);
            const in10m = new Date(now.getTime() + 10 * 60 * 1000);
            const visits15m = await prisma_1.default.visit.findMany({
                where: {
                    status: { in: ['scheduled', 'confirmed'] },
                    scheduledAt: { gte: in10m, lte: in15m },
                },
                include: {
                    lead: { select: { customerName: true, phone: true } },
                },
            });
            for (const visit of visits15m) {
                await this.enqueueJob('visit_agent_notification_15m', `visit:${visit.id}:15m`, now, {
                    visitId: visit.id,
                });
            }
        }
        catch (err) {
            logger_1.default.error('Visit reminder processing failed', { error: err.message });
        }
    }
    /**
     * Send a visit reminder via WhatsApp.
     */
    async sendVisitReminder(visit, timing) {
        try {
            const visitTime = new Date(visit.scheduledAt);
            const timeStr = visitTime.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
            });
            const dateStr = visitTime.toLocaleDateString('en-IN', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
            });
            const customerName = visit.lead?.customerName;
            const propertyName = visit.property?.name;
            const locationArea = visit.property?.locationArea;
            // Multi-language reminder templates
            const messages = {
                en: {
                    '24h': `Hi ${customerName || 'there'}! 👋\n\nReminder: Your property visit is scheduled for *tomorrow*.\n\n📅 ${dateStr}\n⏰ ${timeStr}\n📍 ${propertyName || 'Property'}, ${locationArea || ''}\n\nReply YES to confirm or RESCHEDULE to change the time.`,
                    '1h': `Hi ${customerName || 'there'}! ⏰\n\nYour property visit is in *1 hour*!\n\n📍 ${propertyName || 'Property'}, ${locationArea || ''}\n⏰ ${timeStr}\n\nSee you soon!`,
                },
                hi: {
                    '24h': `नमस्ते ${customerName || ''}! 👋\n\nयाद दिलाना: आपकी प्रॉपर्टी विजिट *कल* के लिए है।\n\n📅 ${dateStr}\n⏰ ${timeStr}\n📍 ${propertyName || 'प्रॉपर्टी'}, ${locationArea || ''}\n\nपुष्टि के लिए YES और समय बदलने के लिए RESCHEDULE लिखें।`,
                    '1h': `नमस्ते ${customerName || ''}! ⏰\n\nआपकी प्रॉपर्टी विजिट *1 घंटे* में है!\n\n📍 ${propertyName || 'प्रॉपर्टी'}, ${locationArea || ''}\n⏰ ${timeStr}\n\nजल्द मिलते हैं!`,
                },
                kn: {
                    '24h': `ಹಲೋ ${customerName || ''}! 👋\n\nಜ್ಞಾಪನೆ: ನಿಮ್ಮ ಆಸ್ತಿ ಭೇಟಿ *ನಾಳೆ* ಇದೆ.\n\n📅 ${dateStr}\n⏰ ${timeStr}\n📍 ${propertyName || 'ಆಸ್ತಿ'}, ${locationArea || ''}\n\nದೃಢೀಕರಿಸಲು YES ಅಥವಾ ಸಮಯ ಬದಲಾಯಿಸಲು RESCHEDULE ಎಂದು ಬರೆಯಿರಿ.`,
                    '1h': `ಹಲೋ ${customerName || ''}! ⏰\n\nನಿಮ್ಮ ಆಸ್ತಿ ಭೇಟಿ *1 ಗಂಟೆ* ಯಲ್ಲಿದೆ!\n\n📍 ${propertyName || 'ಆಸ್ತಿ'}, ${locationArea || ''}\n⏰ ${timeStr}\n\nಶೀಘ್ರದಲ್ಲಿ ಭೇಟಿಯಾಗೋಣ!`,
                },
            };
            const lang = visit.lead?.language || 'en';
            const msgTemplates = messages[lang] || messages.en;
            const message = msgTemplates[timing];
            const customerPhone = visit.lead?.phone;
            if (!customerPhone) {
                logger_1.default.debug('Visit reminder skipped because customer phone is missing', { visitId: visit.id, timing });
                return;
            }
            const whatsappConfig = getCompanyWhatsAppConfig(visit.company);
            if (!whatsappConfig.isCompanyConfigured ||
                (whatsappConfig.provider === 'meta'
                    ? !whatsappConfig.phoneNumberId || !whatsappConfig.accessToken
                    : !whatsappConfig.idInstance || !whatsappConfig.apiTokenInstance)) {
                logger_1.default.debug('Visit reminder skipped because company WhatsApp is not configured', {
                    visitId: visit.id,
                    timing,
                });
                return;
            }
            const sent = await whatsapp_service_1.whatsappService.sendMessage(customerPhone, message, {
                provider: whatsappConfig.provider,
                phoneNumberId: whatsappConfig.phoneNumberId,
                accessToken: whatsappConfig.accessToken,
                verifyToken: whatsappConfig.verifyToken,
                idInstance: whatsappConfig.idInstance,
                apiTokenInstance: whatsappConfig.apiTokenInstance,
            });
            if (!sent) {
                logger_1.default.warn('Visit reminder WhatsApp send failed', { visitId: visit.id, timing });
                return;
            }
            // Mark reminder as sent (only for 24h to avoid duplicate 1h reminders)
            if (timing === '24h') {
                await prisma_1.default.visit.update({
                    where: { id: visit.id },
                    data: { reminderSent: true },
                });
            }
            logger_1.default.info('Visit reminder sent', { visitId: visit.id, timing });
        }
        catch (err) {
            logger_1.default.error('Failed to send visit reminder', { visitId: visit.id, error: err.message });
        }
    }
    /**
     * Create a notification for the agent about an upcoming visit.
     * Uses raw query because the 'details' JSONB column is not in the Prisma schema.
     */
    async createAgentNotification(visit) {
        const existing = await prisma_1.default.$queryRaw `
      SELECT id FROM notifications
      WHERE company_id = ${visit.companyId}::uuid
      AND user_id = ${visit.agentId}::uuid
      AND type = 'visit_reminder'::"NotificationType"
      AND details->>'visit_id' = ${visit.id}
      LIMIT 1
    `;
        if (existing.length > 0)
            return; // Already notified
        const msg = `Visit with ${visit.lead?.customerName || visit.lead?.phone} at ${new Date(visit.scheduledAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
        await prisma_1.default.$executeRaw `
      INSERT INTO notifications (id, company_id, user_id, type, title, message, details)
      VALUES (
        ${(0, uuid_1.v4)()}::uuid,
        ${visit.companyId}::uuid,
        ${visit.agentId}::uuid,
        'visit_reminder'::"NotificationType",
        ${'Visit in 15 minutes'},
        ${msg},
        ${JSON.stringify({ visit_id: visit.id })}::jsonb
      )
    `;
    }
    /**
     * Process follow-up automation rules:
     * - Lead in 'contacted' status for 48h without activity -> auto follow-up
     * - Visit completed -> next day follow-up asking for feedback
     * - Lead in 'negotiation' for 7 days -> reminder to agent
     */
    async processFollowUps() {
        try {
            const now = new Date();
            // 48h no-activity follow-up
            const threshold48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);
            const staleContacted = await prisma_1.default.lead.findMany({
                where: {
                    status: 'contacted',
                    lastContactAt: { lt: threshold48h },
                },
                include: {
                    company: { select: { whatsappPhone: true, settings: true } },
                },
            });
            for (const lead of staleContacted) {
                await this.enqueueJob('lead_follow_up_48h', `lead:${lead.id}:48h_no_activity`, now, {
                    leadId: lead.id,
                    reason: '48h_no_activity',
                });
            }
            // 7-day negotiation reminder to agents
            const threshold7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const staleNegotiation = await prisma_1.default.lead.findMany({
                where: {
                    status: 'negotiation',
                    updatedAt: { lt: threshold7d },
                },
            });
            for (const lead of staleNegotiation) {
                await this.enqueueJob('lead_follow_up_7d', `lead:${lead.id}:7d_negotiation`, now, {
                    leadId: lead.id,
                    reason: '7d_negotiation',
                });
            }
        }
        catch (err) {
            logger_1.default.error('Follow-up processing failed', { error: err.message });
        }
    }
    /**
     * Send an automated follow-up message.
     */
    async sendFollowUpMessage(lead, reason) {
        try {
            const messages = {
                en: `Hi ${lead.customerName || 'there'}! 👋\n\nWe noticed you were looking at properties with us. Have you found what you're looking for?\n\nWe have some great options that might interest you. Would you like me to share some recommendations?\n\nReply YES to see properties!`,
                hi: `नमस्ते ${lead.customerName || ''}! 👋\n\nहमने देखा कि आप हमारे साथ प्रॉपर्टी देख रहे थे। क्या आपको अपनी पसंद की जगह मिली?\n\nहमारे पास कुछ बेहतरीन विकल्प हैं। क्या आप देखना चाहेंगे?\n\nप्रॉपर्टी देखने के लिए YES लिखें!`,
                kn: `ಹಲೋ ${lead.customerName || ''}! 👋\n\nನೀವು ನಮ್ಮೊಂದಿಗೆ ಆಸ್ತಿಗಳನ್ನು ನೋಡುತ್ತಿದ್ದೀರಿ ಎಂದು ನಾವು ಗಮನಿಸಿದ್ದೇವೆ. ನಿಮಗೆ ಸೂಕ್ತವಾದದ್ದು ಸಿಕ್ಕಿದೆಯೇ?\n\nನಮ್ಮಲ್ಲಿ ಉತ್ತಮ ಆಯ್ಕೆಗಳಿವೆ. ನೋಡಲು ಬಯಸುವಿರಾ?\n\nಆಸ್ತಿಗಳನ್ನು ನೋಡಲು YES ಬರೆಯಿರಿ!`,
            };
            const lang = lead.language || 'en';
            const message = messages[lang] || messages.en;
            if (!lead.phone) {
                logger_1.default.debug('Follow-up skipped because lead phone is missing', { leadId: lead.id, reason });
                return;
            }
            const whatsappConfig = getCompanyWhatsAppConfig(lead.company);
            if (!whatsappConfig.isCompanyConfigured ||
                (whatsappConfig.provider === 'meta'
                    ? !whatsappConfig.phoneNumberId || !whatsappConfig.accessToken
                    : !whatsappConfig.idInstance || !whatsappConfig.apiTokenInstance)) {
                logger_1.default.debug('Follow-up skipped because company WhatsApp is not configured', {
                    leadId: lead.id,
                    reason,
                });
                return;
            }
            const sent = await whatsapp_service_1.whatsappService.sendMessage(lead.phone, message, {
                provider: whatsappConfig.provider,
                phoneNumberId: whatsappConfig.phoneNumberId,
                accessToken: whatsappConfig.accessToken,
                verifyToken: whatsappConfig.verifyToken,
                idInstance: whatsappConfig.idInstance,
                apiTokenInstance: whatsappConfig.apiTokenInstance,
            });
            if (!sent) {
                logger_1.default.warn('Follow-up WhatsApp send failed', { leadId: lead.id, reason });
                return;
            }
            // Update last contact
            await prisma_1.default.lead.update({
                where: { id: lead.id },
                data: { lastContactAt: new Date() },
            });
            logger_1.default.info('Follow-up message sent', { leadId: lead.id, reason });
        }
        catch (err) {
            logger_1.default.error('Failed to send follow-up', { leadId: lead.id, error: err.message });
        }
    }
    /**
     * Process conversation timeouts (24h inactivity -> auto-close).
     */
    async processConversationTimeouts() {
        try {
            const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const staleConversations = await prisma_1.default.conversation.findMany({
                where: {
                    status: { in: ['ai_active', 'agent_active'] },
                    updatedAt: { lt: threshold },
                },
            });
            for (const conv of staleConversations) {
                await this.enqueueJob('conversation_timeout_24h', `conversation:${conv.id}:timeout`, new Date(), {
                    conversationId: conv.id,
                });
            }
            if (staleConversations.length > 0) {
                logger_1.default.info('Closed stale conversations', { count: staleConversations.length });
            }
        }
        catch (err) {
            logger_1.default.error('Conversation timeout processing failed', { error: err.message });
        }
    }
    startWorker() {
        this.workerIntervalId = setInterval(() => {
            void this.processQueuedAutomationJobs();
        }, 30 * 1000);
        void this.processQueuedAutomationJobs();
    }
    async processQueuedAutomationJobs() {
        if (this.workerRunning) {
            return;
        }
        this.workerRunning = true;
        try {
            const processed = await automationQueue_service_1.automationQueueService.processDueJobs(async (job) => {
                await this.executeQueuedJob(job.type, job.data);
            });
            if (processed > 0) {
                logger_1.default.info('Processed automation jobs', { count: processed });
            }
        }
        catch (err) {
            logger_1.default.error('Automation queue worker failed', { error: err.message });
        }
        finally {
            this.workerRunning = false;
        }
    }
    async enqueueJob(type, uniqueKey, executeAt, data) {
        const scheduled = await automationQueue_service_1.automationQueueService.schedule(type, uniqueKey, executeAt, data);
        if (!scheduled) {
            logger_1.default.debug('Automation job already scheduled', { type, uniqueKey });
        }
    }
    async executeQueuedJob(type, data) {
        switch (type) {
            case 'visit_reminder_24h':
                await this.executeVisitReminder(String(data.visitId), '24h');
                return;
            case 'visit_reminder_1h':
                await this.executeVisitReminder(String(data.visitId), '1h');
                return;
            case 'visit_agent_notification_15m':
                await this.executeAgentNotification(String(data.visitId));
                return;
            case 'lead_follow_up_48h':
                await this.executeFollowUp(String(data.leadId), String(data.reason || '48h_no_activity'));
                return;
            case 'lead_follow_up_7d':
                await this.executeNegotiationReminder(String(data.leadId));
                return;
            case 'conversation_timeout_24h':
                await this.executeConversationTimeout(String(data.conversationId));
                return;
            default:
                logger_1.default.warn('Unknown automation job type received', { type });
        }
    }
    async executeVisitReminder(visitId, timing) {
        const visit = await prisma_1.default.visit.findUnique({
            where: { id: visitId },
            include: {
                lead: { select: { customerName: true, phone: true, language: true } },
                property: { select: { name: true, locationArea: true } },
                company: { select: { whatsappPhone: true, settings: true } },
            },
        });
        if (!visit) {
            logger_1.default.warn('Visit reminder skipped because visit no longer exists', { visitId, timing });
            return;
        }
        await this.sendVisitReminder(visit, timing);
    }
    async executeAgentNotification(visitId) {
        const visit = await prisma_1.default.visit.findUnique({
            where: { id: visitId },
            include: {
                lead: { select: { customerName: true, phone: true } },
            },
        });
        if (!visit) {
            logger_1.default.warn('Agent notification skipped because visit no longer exists', { visitId });
            return;
        }
        await this.createAgentNotification(visit);
    }
    async executeFollowUp(leadId, reason) {
        const lead = await prisma_1.default.lead.findUnique({
            where: { id: leadId },
            include: {
                company: { select: { whatsappPhone: true, settings: true } },
            },
        });
        if (!lead) {
            logger_1.default.warn('Follow-up skipped because lead no longer exists', { leadId, reason });
            return;
        }
        await this.sendFollowUpMessage(lead, reason);
    }
    async executeNegotiationReminder(leadId) {
        const lead = await prisma_1.default.lead.findUnique({
            where: { id: leadId },
            include: {
                company: { select: { whatsappPhone: true, settings: true } },
            },
        });
        if (!lead) {
            logger_1.default.warn('Negotiation reminder skipped because lead no longer exists', { leadId });
            return;
        }
        await prisma_1.default.notification.create({
            data: {
                companyId: lead.companyId,
                userId: lead.assignedAgentId,
                type: 'follow_up',
                title: 'Lead needs attention',
                message: `${lead.customerName || lead.phone} has been in negotiation for 7+ days.`,
            },
        });
        await prisma_1.default.lead.update({
            where: { id: lead.id },
            data: { lastContactAt: new Date() },
        });
    }
    async executeConversationTimeout(conversationId) {
        const conv = await prisma_1.default.conversation.findUnique({
            where: { id: conversationId },
        });
        if (!conv) {
            return;
        }
        if (conv.status === 'closed') {
            return;
        }
        await prisma_1.default.conversation.update({
            where: { id: conv.id },
            data: { status: 'closed' },
        });
    }
}
exports.AutomationService = AutomationService;
exports.automationService = new AutomationService();
//# sourceMappingURL=automation.service.js.map