"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = exports.EmailService = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
const ses_email_service_1 = require("./ses-email.service");
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
function isMailConfigured() {
    if (config_1.default.mail.transport === 'ses-api') {
        return (0, ses_email_service_1.isSesApiConfigured)();
    }
    return isSmtpConfigured(resolveSmtpConfig());
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
/**
 * Detect if the configured SMTP host is AWS SES.
 * SES SMTP requires STARTTLS on port 587 and does not allow plain auth.
 *
 * @param host - SMTP hostname from config
 * @returns True if this is an AWS SES SMTP endpoint
 */
function isAwsSesSmtpHost(host) {
    return host.includes('amazonaws.com') || host.includes('email-smtp.');
}
function buildTransportOptions(smtp) {
    const auth = smtp.user && smtp.pass ? { user: smtp.user, pass: smtp.pass } : undefined;
    const isSesSstp = isAwsSesSmtpHost(smtp.host);
    // AWS SES SMTP always uses STARTTLS on port 587 — force it
    if (isSesSstp) {
        return {
            host: smtp.host,
            port: 587,
            secure: false, // STARTTLS — not direct TLS
            requireTLS: true, // Mandatory STARTTLS for SES
            auth,
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 30000,
            tls: {
                // SES has a valid cert — enforce it
                rejectUnauthorized: true,
            },
        };
    }
    const useTls = smtp.port === 587 && !smtp.secure;
    return {
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
        ...(useTls ? { requireTLS: true } : {}),
    };
}
class EmailService {
    constructor() {
        this.transporter = null;
        this.lastVerifyAt = 0;
        this.lastVerifyOk = false;
        this.lastVerifyDetail = '';
    }
    resetTransporter() {
        this.transporter = null;
        this.lastVerifyAt = 0;
    }
    getTransporter() {
        if (this.transporter) {
            return this.transporter;
        }
        const smtp = resolveSmtpConfig();
        if (!isSmtpConfigured(smtp)) {
            throw new Error('SMTP is not configured');
        }
        this.transporter = nodemailer_1.default.createTransport(buildTransportOptions(smtp));
        return this.transporter;
    }
    async verifyConnection(force = false) {
        const smtp = resolveSmtpConfig();
        if (!isSmtpConfigured(smtp)) {
            return { ok: false, detail: 'SMTP_HOST and SMTP_PORT are not configured.' };
        }
        if (!config_1.default.mail.from?.trim()) {
            return { ok: false, detail: 'MAIL_FROM is not configured.' };
        }
        const now = Date.now();
        if (!force && this.lastVerifyAt && now - this.lastVerifyAt < 5 * 60 * 1000) {
            return { ok: this.lastVerifyOk, detail: this.lastVerifyDetail };
        }
        try {
            const transporter = this.getTransporter();
            await transporter.verify();
            this.lastVerifyAt = now;
            this.lastVerifyOk = true;
            this.lastVerifyDetail = `SMTP verified (${smtp.host}:${smtp.port}).`;
            return { ok: true, detail: this.lastVerifyDetail };
        }
        catch (err) {
            this.resetTransporter();
            const message = err instanceof Error ? err.message : String(err);
            this.lastVerifyAt = now;
            this.lastVerifyOk = false;
            this.lastVerifyDetail = `SMTP verification failed: ${message}`;
            logger_1.default.warn('SMTP verify failed', { smtp: sanitizeSmtpConfigForLogs(smtp), error: message });
            return { ok: false, detail: this.lastVerifyDetail };
        }
    }
    async sendWithRetry(mail) {
        let lastError = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const transporter = this.getTransporter();
                await transporter.sendMail(mail);
                return;
            }
            catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                this.resetTransporter();
                if (attempt === 0) {
                    logger_1.default.warn('Email send failed, retrying once', { to: mail.to, error: lastError.message });
                    await new Promise((r) => setTimeout(r, 1200));
                }
            }
        }
        throw lastError || new Error('Email send failed');
    }
    async sendPasswordResetEmail(params) {
        const smtp = resolveSmtpConfig();
        if (!isMailConfigured()) {
            logger_1.default.warn('Password reset email skipped: mail not configured', {
                userEmail: params.toEmail,
                transport: config_1.default.mail.transport,
                smtp: sanitizeSmtpConfigForLogs(smtp),
            });
            return { sent: false, reason: 'smtp_not_configured' };
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
        await this.sendWithRetry({
            from: config_1.default.mail.from,
            to: params.toEmail,
            subject,
            text,
            html,
        });
        logger_1.default.info('Password reset email sent', {
            userEmail: params.toEmail,
        });
        return { sent: true };
    }
    async sendWelcomeInviteEmail(params) {
        const smtp = resolveSmtpConfig();
        if (!isMailConfigured() || !config_1.default.mail.from) {
            logger_1.default.warn('Welcome invite email skipped: SMTP not configured', {
                userEmail: params.toEmail,
                smtp: sanitizeSmtpConfigForLogs(smtp),
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
        await this.sendWithRetry({
            from: config_1.default.mail.from,
            to: params.toEmail,
            subject,
            text,
            html,
        });
        logger_1.default.info('Welcome invite email sent', { userEmail: params.toEmail });
        return true;
    }
    async sendReEngagementEmail(params) {
        const smtp = resolveSmtpConfig();
        if (!isMailConfigured() || !config_1.default.mail.from) {
            logger_1.default.warn('Re-engagement email skipped: SMTP not configured', {
                userEmail: params.toEmail,
                smtp: sanitizeSmtpConfigForLogs(smtp),
            });
            return false;
        }
        const greetingName = (params.toName || '').trim() || 'there';
        const text = `Hi ${greetingName},\n\n${params.bodyText}`;
        const html = `<p>Hi ${escapeHtml(greetingName)},</p><p>${escapeHtml(params.bodyText).replace(/\n/g, '<br>')}</p>`;
        await this.sendWithRetry({
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
