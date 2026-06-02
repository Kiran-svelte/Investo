"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = exports.EmailService = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
function sanitizeSmtpConfigForLogs(smtp) {
    return {
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        hasAuth: Boolean(smtp.user && smtp.pass),
    };
}
function isSmtpConfigured(smtp) {
    return Boolean(smtp.host) && Number.isFinite(smtp.port) && smtp.port > 0;
}
function resolveSmtpConfig() {
    return {
        host: config_1.default.mail.smtp.host,
        port: config_1.default.mail.smtp.port,
        secure: config_1.default.mail.smtp.secure,
        user: config_1.default.mail.smtp.user || undefined,
        pass: config_1.default.mail.smtp.pass || undefined,
    };
}
class EmailService {
    constructor() {
        this.transporter = null;
    }
    getTransporter() {
        if (this.transporter) {
            return this.transporter;
        }
        const smtp = resolveSmtpConfig();
        if (!isSmtpConfigured(smtp)) {
            throw new Error('SMTP is not configured');
        }
        const auth = smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined;
        this.transporter = nodemailer_1.default.createTransport({
            host: smtp.host,
            port: smtp.port,
            secure: smtp.secure,
            auth,
        });
        return this.transporter;
    }
    async sendPasswordResetEmail(params) {
        const smtp = resolveSmtpConfig();
        if (!isSmtpConfigured(smtp)) {
            logger_1.default.warn('Password reset email skipped: SMTP not configured', {
                userEmail: params.toEmail,
                smtp: sanitizeSmtpConfigForLogs(smtp),
            });
            return;
        }
        if (!config_1.default.mail.from) {
            logger_1.default.warn('Password reset email skipped: MAIL_FROM not configured', {
                userEmail: params.toEmail,
                smtp: sanitizeSmtpConfigForLogs(smtp),
            });
            return;
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
        const transporter = this.getTransporter();
        await transporter.sendMail({
            from: config_1.default.mail.from,
            to: params.toEmail,
            subject,
            text,
            html,
        });
        logger_1.default.info('Password reset email sent', {
            userEmail: params.toEmail,
        });
    }
    async sendReEngagementEmail(params) {
        const smtp = resolveSmtpConfig();
        if (!isSmtpConfigured(smtp) || !config_1.default.mail.from) {
            logger_1.default.warn('Re-engagement email skipped: SMTP not configured', {
                userEmail: params.toEmail,
                smtp: sanitizeSmtpConfigForLogs(smtp),
            });
            return false;
        }
        const greetingName = (params.toName || '').trim() || 'there';
        const text = `Hi ${greetingName},\n\n${params.bodyText}`;
        const html = `<p>Hi ${escapeHtml(greetingName)},</p><p>${escapeHtml(params.bodyText).replace(/\n/g, '<br>')}</p>`;
        await this.getTransporter().sendMail({
            from: config_1.default.mail.from,
            to: params.toEmail,
            subject: params.subject,
            text,
            html,
        });
        logger_1.default.info('Re-engagement email sent', { userEmail: params.toEmail });
        return true;
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
