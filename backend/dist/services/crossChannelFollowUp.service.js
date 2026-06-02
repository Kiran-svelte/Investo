"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryCrossChannelFollowUp = tryCrossChannelFollowUp;
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const conversionSettings_service_1 = require("./conversionSettings.service");
const email_service_1 = require("./email.service");
/**
 * When WhatsApp is blocked/unavailable, attempt email re-engagement if lead has email.
 */
async function tryCrossChannelFollowUp(leadId, reason, whatsappBody) {
    const lead = await prisma_1.default.lead.findUnique({
        where: { id: leadId },
        select: {
            id: true,
            companyId: true,
            email: true,
            customerName: true,
        },
    });
    if (!lead?.email?.trim()) {
        return;
    }
    const settings = await (0, conversionSettings_service_1.getConversionSettings)(lead.companyId);
    if (!settings.cross_channel_followup_enabled) {
        return;
    }
    const subject = reason.includes('30d')
        ? 'Your personalised market update'
        : reason.includes('7d')
            ? 'Market moved — still interested?'
            : 'New properties matching your search';
    try {
        const sent = await email_service_1.emailService.sendReEngagementEmail({
            toEmail: lead.email.trim(),
            toName: lead.customerName,
            subject,
            bodyText: whatsappBody.replace(/\*/g, ''),
        });
        if (sent) {
            await prisma_1.default.lead.update({
                where: { id: lead.id },
                data: { lastContactAt: new Date() },
            });
        }
    }
    catch (err) {
        logger_1.default.warn('Cross-channel follow-up email failed', {
            leadId,
            error: err?.message,
        });
    }
}
