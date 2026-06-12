"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = exports.EmailService = void 0;
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
const mailConfig_service_1 = require("./mailConfig.service");
const resend_email_service_1 = require("./resend-email.service");
class EmailService {
    async verifyConnection(force = false) {
        void force;
        return (0, resend_email_service_1.verifyResendApi)();
    }
    async sendEmail(mail) {
        return (0, resend_email_service_1.sendResendEmail)(mail);
    }
    async sendPasswordResetEmail(params) {
        if (!(0, mailConfig_service_1.isMailConfigured)()) {
            logger_1.default.warn('Password reset email skipped: mail not configured', {
                userEmail: params.toEmail,
                transport: config_1.default.mail.transport,
                resendConfigured: (0, resend_email_service_1.isResendConfigured)(),
            });
            return { sent: false, reason: 'mail_not_configured' };
        }
        if (!config_1.default.mail.from) {
            logger_1.default.warn('Password reset email skipped: MAIL_FROM not configured', {
                userEmail: params.toEmail,
            });
            return { sent: false, reason: 'mail_from_missing' };
        }
        const displayName = (params.toName || '').trim();
        const greetingName = displayName ? displayName : 'there';
        const subject = 'Reset your Investo password';
        const text = `Hi ${greetingName},\n\n` +
            `We received a request to reset your Investo password.\n\n` +
            `Reset your password using this link:\n${params.resetUrl}\n\n` +
            `If you did not request this, you can ignore this email.\n`;
        const html = `
      <p>Hi ${escapeHtml(greetingName)},</p>
      <p>We received a request to reset your Investo password.</p>
      <p><a href="${escapeHtmlAttr(params.resetUrl)}">Reset your password</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `;
        try {
            const result = await this.sendEmail({
                to: params.toEmail,
                subject,
                text,
                html,
            });
            logger_1.default.info('Password reset email sent', {
                userEmail: params.toEmail,
                transport: config_1.default.mail.transport,
                messageId: result.id,
            });
            return { sent: true, messageId: result.id };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger_1.default.error('Password reset email failed', {
                userEmail: params.toEmail,
                transport: config_1.default.mail.transport,
                error: message,
            });
            return { sent: false, reason: message };
        }
    }
    async sendWelcomeInviteEmail(params) {
        if (!(0, mailConfig_service_1.isMailConfigured)() || !config_1.default.mail.from) {
            logger_1.default.warn('Welcome invite email skipped: Resend not configured', {
                userEmail: params.toEmail,
            });
            return false;
        }
        const greetingName = (params.toName || '').trim() || 'there';
        const companyLine = params.companyName ? ` for ${params.companyName}` : '';
        const passwordLine = params.temporaryPassword
            ? `\n\nTemporary password: ${params.temporaryPassword}\n(You may be asked to change it on first login.)`
            : '\n\nUse the password your platform admin shared with you.';
        const subject = `Your Investo company admin account${companyLine}`;
        const text = `Hi ${greetingName},\n\n` +
            `You have been invited as Company Admin on Investo${companyLine}.\n\n` +
            `Log in here:\n${params.loginUrl}${passwordLine}\n\n` +
            `After login, complete the 6-step onboarding wizard (company profile, team, WhatsApp, properties).`;
        const html = `
      <p>Hi ${escapeHtml(greetingName)},</p>
      <p>You have been invited as <strong>Company Admin</strong> on Investo${escapeHtml(companyLine)}.</p>
      <p><a href="${escapeHtmlAttr(params.loginUrl)}">Log in to Investo</a></p>
      ${params.temporaryPassword ? `<p>Temporary password: <code>${escapeHtml(params.temporaryPassword)}</code><br><small>Change it on first login if prompted.</small></p>` : ''}
      <p>Complete the 6-step onboarding wizard after login.</p>
    `;
        try {
            const result = await this.sendEmail({
                to: params.toEmail,
                subject,
                text,
                html,
            });
            logger_1.default.info('Welcome invite email sent', { userEmail: params.toEmail, messageId: result.id });
            return true;
        }
        catch (err) {
            logger_1.default.warn('Welcome invite email failed', {
                userEmail: params.toEmail,
                error: err instanceof Error ? err.message : String(err),
            });
            return false;
        }
    }
    async sendReEngagementEmail(params) {
        if (!(0, mailConfig_service_1.isMailConfigured)() || !config_1.default.mail.from) {
            logger_1.default.warn('Re-engagement email skipped: Resend not configured', {
                userEmail: params.toEmail,
            });
            return false;
        }
        const greetingName = (params.toName || '').trim() || 'there';
        const text = `Hi ${greetingName},\n\n${params.bodyText}`;
        const html = `<p>Hi ${escapeHtml(greetingName)},</p><p>${escapeHtml(params.bodyText).replace(/\n/g, '<br>')}</p>`;
        try {
            const result = await this.sendEmail({
                to: params.toEmail,
                subject: params.subject,
                text,
                html,
            });
            logger_1.default.info('Re-engagement email sent', { userEmail: params.toEmail, messageId: result.id });
            return true;
        }
        catch (err) {
            logger_1.default.warn('Re-engagement email failed', {
                userEmail: params.toEmail,
                error: err instanceof Error ? err.message : String(err),
            });
            return false;
        }
    }
}
exports.EmailService = EmailService;
function escapeHtml(input) {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function escapeHtmlAttr(input) {
    return escapeHtml(input).replace(/\n/g, '');
}
exports.emailService = new EmailService();
