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
exports.webhookRouteInternals = void 0;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = __importStar(require("express"));
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
const whatsapp_service_1 = require("../services/whatsapp.service");
const whatsappSecurity_1 = require("../middleware/whatsappSecurity");
const deduplication_service_1 = require("../services/deduplication.service");
const whatsappHealth_service_1 = require("../services/whatsappHealth.service");
const maskPhoneNumberForLogs_1 = require("../utils/maskPhoneNumberForLogs");
const router = (0, express_1.Router)();
// Apply IP whitelist middleware to all webhook routes
router.use(whatsappSecurity_1.whatsappIpWhitelist);
/**
 * GET /api/webhook
 * WhatsApp webhook verification endpoint - no auth required.
 * Meta sends a challenge that must be echoed back.
 */
router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === config_1.default.whatsapp.verifyToken) {
        logger_1.default.info('WhatsApp webhook verified');
        res.status(200).send(challenge);
        return;
    }
    res.status(403).json({ error: 'Webhook verification failed' });
});
/**
 * POST /api/webhook
 * WhatsApp incoming message handler.
 * Verifies Meta signature before processing.
 *
 * Applies webhook-specific size limit: 1mb (not the global 10mb)
 */
router.post('/', express_1.default.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    },
}), async (req, res) => {
    // Log all incoming webhook requests for debugging
    logger_1.default.info('Webhook POST received', {
        hasSignature: !!req.headers['x-hub-signature-256'],
        bodyObject: req.body?.object,
        hasEntries: !!req.body?.entry?.length,
        ip: req.ip || req.headers['x-forwarded-for'],
    });
    const signatureHeader = req.headers['x-hub-signature-256'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const rawBody = req.rawBody;
    const signatureCheck = verifyWebhookSignature(rawBody ?? req.body, signature);
    if (!signatureCheck.allowed) {
        logger_1.default.warn('Webhook signature verification failed', {
            reason: signatureCheck.reason,
            hasSignature: !!signature,
            hasAppSecret: !!config_1.default.whatsapp.appSecret,
            env: config_1.default.env,
        });
        res.status(403).json({ status: 'rejected', reason: signatureCheck.reason });
        return;
    }
    // Must respond quickly to satisfy Meta retry behavior.
    res.status(200).json({ status: 'received' });
    processWebhook(req.body)
        .then((summary) => {
        logger_1.default.info('Webhook processing summary', { summary: redactWebhookSummaryForLogs(summary) });
    })
        .catch((err) => {
        logger_1.default.error('Webhook processing failed', { error: err.message });
    });
});
/**
 * Verify the webhook payload signature from Meta.
 */
function verifyWebhookSignature(body, signature) {
    if (!config_1.default.whatsapp.appSecret) {
        if (config_1.default.env === 'production') {
            return { allowed: false, reason: 'app_secret_missing' };
        }
        logger_1.default.warn('WHATSAPP_APP_SECRET not configured - allowing webhook only in non-production');
        return { allowed: true, reason: 'non_prod_missing_app_secret' };
    }
    if (!signature) {
        if (config_1.default.env !== 'production') {
            return { allowed: true, reason: 'non_prod_missing_signature' };
        }
        return { allowed: false, reason: 'signature_missing' };
    }
    const payload = Buffer.isBuffer(body)
        ? body
        : typeof body === 'string'
            ? body
            : JSON.stringify(body);
    const expectedSignature = 'sha256=' + crypto_1.default
        .createHmac('sha256', config_1.default.whatsapp.appSecret)
        .update(payload)
        .digest('hex');
    const actual = Buffer.from(signature);
    const expected = Buffer.from(expectedSignature);
    if (actual.length !== expected.length) {
        return { allowed: false, reason: 'signature_invalid_length' };
    }
    const isValid = crypto_1.default.timingSafeEqual(actual, expected);
    return {
        allowed: isValid,
        reason: isValid ? 'signature_valid' : 'signature_mismatch',
    };
}
function redactWebhookSummaryForLogs(summary) {
    return {
        ...summary,
        outcomes: summary.outcomes.map((outcome) => ({
            ...outcome,
            from: (0, maskPhoneNumberForLogs_1.maskPhoneNumberForLogs)(outcome.from),
        })),
    };
}
/**
 * Process incoming webhook payload from Meta.
 */
async function processWebhook(body) {
    const summary = {
        object: body?.object || null,
        totalMessages: 0,
        processed: 0,
        skipped: 0,
        duplicate: 0,
        failed: 0,
        outcomes: [],
    };
    logger_1.default.info('=== PROCESS WEBHOOK START ===', {
        object: body.object,
        entryCount: body.entry?.length || 0,
    });
    if (body.object !== 'whatsapp_business_account') {
        logger_1.default.warn('Ignoring non-WhatsApp webhook', { object: body.object });
        summary.skipped += 1;
        summary.outcomes.push({
            messageId: null,
            type: null,
            from: null,
            status: 'skipped',
            reason: 'unsupported_object',
            propagationStatus: 'not_attempted',
        });
        return summary;
    }
    logger_1.default.info('Object check passed, processing entries...');
    const entries = body.entry || [];
    for (const entry of entries) {
        const changes = entry.changes || [];
        logger_1.default.info('Processing entry', { entryId: entry.id, changeCount: changes.length });
        for (const change of changes) {
            logger_1.default.info('Processing change', { field: change.field, hasValue: !!change.value });
            if (change.field !== 'messages') {
                logger_1.default.info('Skipping non-messages field', { field: change.field });
                continue;
            }
            const value = change.value;
            const metadata = value.metadata;
            const phoneNumberId = metadata?.phone_number_id;
            const messages = value.messages || [];
            const contacts = value.contacts || [];
            logger_1.default.info('=== MESSAGE PAYLOAD ===', {
                phoneNumberId,
                messageCount: messages.length,
                contactCount: contacts.length,
                hasMetadata: !!metadata,
            });
            for (let i = 0; i < messages.length; i++) {
                summary.totalMessages += 1;
                const message = messages[i];
                const contact = contacts[i];
                const messageId = message?.id || null;
                const outcome = {
                    messageId,
                    type: message?.type || null,
                    from: message?.from || null,
                    status: 'skipped',
                    reason: 'uninitialized',
                    propagationStatus: 'not_attempted',
                };
                logger_1.default.info('=== PROCESSING MESSAGE ===', {
                    index: i,
                    type: message.type,
                    id: message.id,
                    from: (0, maskPhoneNumberForLogs_1.maskPhoneNumberForLogs)(message.from),
                    hasContact: !!contact,
                });
                const extracted = extractCustomerMessage(message);
                if (!extracted) {
                    outcome.status = 'skipped';
                    outcome.reason = 'unsupported_message_type';
                    summary.skipped += 1;
                    summary.outcomes.push(outcome);
                    logger_1.default.info('Skipping unsupported message type', { type: message.type, messageId });
                    continue;
                }
                if (!messageId) {
                    outcome.status = 'skipped';
                    outcome.reason = 'missing_message_id';
                    summary.skipped += 1;
                    summary.outcomes.push(outcome);
                    logger_1.default.warn('Skipping message without message.id');
                    continue;
                }
                const customerPhone = message.from; // E.164 format without +
                if (!customerPhone) {
                    outcome.status = 'skipped';
                    outcome.reason = 'missing_customer_phone';
                    summary.skipped += 1;
                    summary.outcomes.push(outcome);
                    logger_1.default.warn('Skipping message without sender phone', { messageId });
                    continue;
                }
                const dedupKey = `meta:${phoneNumberId}:${messageId}`;
                const isClaimed = await deduplication_service_1.deduplicationService.claimMessageProcessing(dedupKey);
                if (!isClaimed) {
                    outcome.status = 'duplicate';
                    outcome.reason = 'duplicate_message_id';
                    summary.duplicate += 1;
                    summary.outcomes.push(outcome);
                    logger_1.default.info('Duplicate message ignored', { messageId });
                    continue;
                }
                const customerName = contact?.profile?.name || '';
                const { messageText, normalizedType } = extracted;
                logger_1.default.info('=== CALLING handleIncomingMessage ===', {
                    phoneNumberId,
                    customerPhone: (0, maskPhoneNumberForLogs_1.maskPhoneNumberForLogs)(customerPhone),
                    customerName,
                    text: messageText.substring(0, 50),
                    normalizedType,
                    interactiveId: extracted.interactiveId,
                    interactiveType: extracted.interactiveType,
                });
                try {
                    const processingResult = await whatsapp_service_1.whatsappService.handleIncomingMessage({
                        phoneNumberId,
                        customerPhone: '+' + customerPhone,
                        customerName,
                        messageText,
                        messageId,
                        interactiveId: extracted.interactiveId,
                        interactiveType: extracted.interactiveType,
                    });
                    outcome.propagationStatus = processingResult.propagation.status;
                    if (processingResult.status === 'processed') {
                        outcome.status = 'processed';
                        outcome.reason = 'message_processed';
                        summary.processed += 1;
                    }
                    else if (processingResult.status === 'skipped') {
                        outcome.status = 'skipped';
                        outcome.reason = processingResult.reason || 'service_skipped';
                        summary.skipped += 1;
                    }
                    else {
                        outcome.status = 'failed';
                        outcome.reason = processingResult.reason || 'service_failed';
                        summary.failed += 1;
                        await deduplication_service_1.deduplicationService.release(dedupKey);
                    }
                    summary.outcomes.push(outcome);
                    logger_1.default.info('=== MESSAGE HANDLED SUCCESSFULLY ===', { messageId });
                }
                catch (err) {
                    await deduplication_service_1.deduplicationService.release(dedupKey);
                    outcome.status = 'failed';
                    outcome.reason = 'exception';
                    outcome.error = err.message;
                    summary.failed += 1;
                    summary.outcomes.push(outcome);
                    logger_1.default.error('=== MESSAGE HANDLING FAILED ===', {
                        messageId,
                        error: err.message,
                        stack: err.stack?.substring(0, 500),
                    });
                }
            }
        }
    }
    return summary;
}
function extractCustomerMessage(message) {
    if (message.type === 'text' && typeof message.text?.body === 'string') {
        return {
            messageText: message.text.body,
            normalizedType: 'text',
        };
    }
    if (message.type === 'interactive') {
        // Handle button replies (quick reply buttons)
        if (message.interactive?.button_reply) {
            const buttonReply = message.interactive.button_reply;
            return {
                messageText: buttonReply.title || '',
                normalizedType: 'interactive',
                interactiveId: buttonReply.id,
                interactiveType: 'button_reply',
            };
        }
        // Handle list replies (scrollable list selections)
        if (message.interactive?.list_reply) {
            const listReply = message.interactive.list_reply;
            // Use description if title is too short, otherwise title
            const text = listReply.description || listReply.title || '';
            return {
                messageText: text,
                normalizedType: 'interactive',
                interactiveId: listReply.id,
                interactiveType: 'list_reply',
            };
        }
        return null;
    }
    return null;
}
exports.webhookRouteInternals = {
    verifyWebhookSignature,
    processWebhook,
    extractCustomerMessage,
};
/**
 * GET /api/webhook/health
 * WhatsApp connection health check endpoint.
 * Returns the current status of WhatsApp API connectivity.
 */
router.get('/health', async (req, res) => {
    try {
        const health = await whatsappHealth_service_1.whatsappHealthService.getHealthStatus();
        // Return appropriate status code based on WhatsApp connection
        const statusCode = health.whatsapp.connected ? 200 : 503;
        res.status(statusCode).json(health);
    }
    catch (err) {
        logger_1.default.error('Health check failed', { error: err.message });
        res.status(500).json({
            error: 'Health check failed',
            message: err.message,
        });
    }
});
/**
 * POST /api/webhook/test
 * Simulate a WhatsApp message for testing (dev mode only).
 * Body: { phone, name, message }
 */
router.post('/test', express_1.default.json({ limit: '1mb' }), async (req, res) => {
    if (config_1.default.env !== 'development') {
        res.status(403).json({ error: 'Test endpoint only available in development' });
        return;
    }
    const { phone, name, message } = req.body;
    if (!phone || !message) {
        res.status(400).json({ error: 'phone and message are required' });
        return;
    }
    try {
        await whatsapp_service_1.whatsappService.handleIncomingMessage({
            phoneNumberId: 'test',
            customerPhone: phone,
            customerName: name || 'Test Customer',
            messageText: message,
            messageId: `test_${Date.now()}`,
        });
        // Get the latest conversation and AI response
        const lead = await (await Promise.resolve().then(() => __importStar(require('../config/prisma')))).default.lead.findFirst({
            where: { phone },
            orderBy: { createdAt: 'desc' },
        });
        if (!lead) {
            res.json({ message: 'Message processed but no lead found' });
            return;
        }
        const conversation = await (await Promise.resolve().then(() => __importStar(require('../config/prisma')))).default.conversation.findFirst({
            where: { leadId: lead.id },
            orderBy: { updatedAt: 'desc' },
        });
        const messages = conversation
            ? await (await Promise.resolve().then(() => __importStar(require('../config/prisma')))).default.message.findMany({
                where: { conversationId: conversation.id },
                orderBy: { createdAt: 'desc' },
                take: 2,
            })
            : [];
        res.json({
            data: {
                leadId: lead.id,
                conversationId: conversation?.id,
                messages: messages.reverse().map((m) => ({
                    sender: m.senderType,
                    content: m.content,
                    language: m.language,
                    createdAt: m.createdAt,
                })),
            },
        });
    }
    catch (err) {
        logger_1.default.error('Test webhook failed', { error: err.message });
        res.status(500).json({ error: err.message });
    }
});
/**
 * POST /api/webhook/debug
 * Debug endpoint to test the full webhook flow synchronously.
 * Returns detailed step-by-step info about what happens.
 * TEMPORARY - remove after debugging.
 */
router.post('/debug', express_1.default.json({ limit: '1mb' }), async (req, res) => {
    const debugLog = [];
    const log = (msg) => {
        debugLog.push(`[${new Date().toISOString()}] ${msg}`);
        logger_1.default.info(`DEBUG: ${msg}`);
    };
    try {
        log('Starting debug webhook processing');
        const body = req.body;
        log(`Body object: ${body.object}`);
        log(`Entry count: ${body.entry?.length || 0}`);
        if (body.object !== 'whatsapp_business_account') {
            log('ERROR: Not a whatsapp_business_account object');
            res.json({ success: false, debugLog });
            return;
        }
        const entries = body.entry || [];
        for (const entry of entries) {
            const changes = entry.changes || [];
            log(`Entry has ${changes.length} changes`);
            for (const change of changes) {
                log(`Change field: ${change.field}`);
                if (change.field !== 'messages') {
                    log('Skipping non-messages change');
                    continue;
                }
                const value = change.value;
                const metadata = value.metadata;
                const phoneNumberId = metadata?.phone_number_id;
                const messages = value.messages || [];
                const contacts = value.contacts || [];
                log(`Phone Number ID: ${phoneNumberId}`);
                log(`Messages: ${messages.length}, Contacts: ${contacts.length}`);
                // Try to find company
                log('Looking up company by phoneNumberId...');
                const companyResult = await whatsapp_service_1.whatsappService.getCompanyByPhoneNumberId(phoneNumberId);
                if (!companyResult) {
                    log('ERROR: No company found for phoneNumberId!');
                    res.json({ success: false, error: 'No company found', debugLog });
                    return;
                }
                log(`Found company: ${companyResult.company.name} (${companyResult.company.id})`);
                for (let i = 0; i < messages.length; i++) {
                    const message = messages[i];
                    const contact = contacts[i];
                    log(`Message ${i}: type=${message.type}, from=${(0, maskPhoneNumberForLogs_1.maskPhoneNumberForLogs)(message.from) ?? '****'}`);
                    if (message.type !== 'text') {
                        log('Skipping non-text message');
                        continue;
                    }
                    const customerPhone = '+' + message.from;
                    const customerName = contact?.profile?.name || '';
                    const messageText = message.text?.body || '';
                    log(`Processing: phone=${(0, maskPhoneNumberForLogs_1.maskPhoneNumberForLogs)(customerPhone) ?? '****'}, name=${customerName}, text=${messageText}`);
                    // Call handleIncomingMessage
                    log('Calling whatsappService.handleIncomingMessage...');
                    await whatsapp_service_1.whatsappService.handleIncomingMessage({
                        phoneNumberId,
                        customerPhone,
                        customerName,
                        messageText,
                        messageId: message.id,
                    });
                    log('handleIncomingMessage completed successfully');
                }
            }
        }
        // Check if lead was created
        const prisma = (await Promise.resolve().then(() => __importStar(require('../config/prisma')))).default;
        const recentLeads = await prisma.lead.findMany({
            where: { companyId: entries[0]?.changes?.[0]?.value?.metadata?.phone_number_id ? undefined : undefined },
            orderBy: { createdAt: 'desc' },
            take: 3,
        });
        log(`Recent leads in DB: ${recentLeads.length}`);
        recentLeads.forEach((l, i) => {
            log(`Lead ${i}: ${(0, maskPhoneNumberForLogs_1.maskPhoneNumberForLogs)(l.phone) ?? '****'} - ${l.customerName} - ${l.createdAt}`);
        });
        res.json({
            success: true,
            debugLog,
            recentLeads: recentLeads.map((l) => ({
                id: l.id,
                phone: (0, maskPhoneNumberForLogs_1.maskPhoneNumberForLogs)(l.phone) ?? '****',
                name: l.customerName,
            })),
        });
    }
    catch (err) {
        log(`EXCEPTION: ${err.message}`);
        log(`Stack: ${err.stack?.substring(0, 500)}`);
        res.json({ success: false, error: err.message, debugLog });
    }
});
exports.default = router;
//# sourceMappingURL=webhook.routes.js.map