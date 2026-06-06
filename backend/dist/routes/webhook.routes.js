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
const langgraphAdapter_service_1 = require("../services/langgraphAdapter.service");
const enterpriseAgentBridge_1 = require("../services/enterpriseAgentBridge");
const whatsappSecurity_1 = require("../middleware/whatsappSecurity");
const whatsappHealth_service_1 = require("../services/whatsappHealth.service");
const maskPhoneNumberForLogs_1 = require("../utils/maskPhoneNumberForLogs");
const router = (0, express_1.Router)();
async function getPrisma() {
    const module = await Promise.resolve().then(() => __importStar(require('../config/prisma')));
    return module.default;
}
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
    // Must respond quickly to satisfy Meta retry behavior (before any async work).
    res.sendStatus(200);
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
    // Debug bypass
    if (process.env.BYPASS_WHATSAPP_SIGNATURE === 'true') {
        logger_1.default.warn('Webhook signature verification BYPASSED via BYPASS_WHATSAPP_SIGNATURE=true');
        return { allowed: true, reason: 'debug_bypass' };
    }
    if (!config_1.default.whatsapp.appSecret) {
        if (config_1.default.env === 'production') {
            logger_1.default.error('Webhook signature verification failed: WHATSAPP_APP_SECRET is missing in production');
            return { allowed: false, reason: 'app_secret_missing' };
        }
        logger_1.default.warn('WHATSAPP_APP_SECRET not configured - allowing webhook only in non-production');
        return { allowed: true, reason: 'non_prod_missing_app_secret' };
    }
    if (!signature) {
        if (config_1.default.env !== 'production') {
            logger_1.default.warn('Webhook signature missing in non-production - allowing');
            return { allowed: true, reason: 'non_prod_missing_signature' };
        }
        logger_1.default.error('Webhook signature missing in production');
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
        logger_1.default.error('Webhook signature length mismatch', {
            actualLength: actual.length,
            expectedLength: expected.length,
        });
        return { allowed: false, reason: 'signature_invalid_length' };
    }
    const isValid = crypto_1.default.timingSafeEqual(actual, expected);
    if (!isValid) {
        logger_1.default.error('Webhook signature mismatch', {
            received: signature.substring(0, 15) + '...',
            expected: expectedSignature.substring(0, 15) + '...',
            payloadLength: payload.length,
        });
    }
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
                    const customerPhoneE164 = '+' + customerPhone;
                    const companyResolution = await whatsapp_service_1.whatsappService.getCompanyByPhoneNumberId(phoneNumberId, 'meta', undefined, undefined, customerPhoneE164, metadata?.display_phone_number);
                    if (!companyResolution) {
                        outcome.status = 'skipped';
                        outcome.reason = 'company_not_found';
                        summary.skipped += 1;
                        summary.outcomes.push(outcome);
                        logger_1.default.error('Inbound Meta message skipped: company not resolved', { phoneNumberId, messageId });
                        continue;
                    }
                    // Staff vs prospect routing runs inside handleIncomingMessage (single global entry point).
                    // If LangGraph integration is enabled, send normalized payload.
                    if (config_1.default.langgraph?.enabled) {
                        try {
                            const lgPayload = {
                                event: 'onmessage',
                                session: String(metadata?.session || phoneNumberId || 'default'),
                                body: messageText,
                                type: normalizedType === 'text' ? 'chat' : 'interactive',
                                isNewMsg: true,
                                sender: { id: (message.from || '') + '@s.whatsapp.net', isUser: true },
                                isGroupMsg: !!message?.context?.isGroup || false,
                            };
                            const lgResp = await (0, langgraphAdapter_service_1.sendToLangGraph)(lgPayload);
                            if (config_1.default.langgraph.mode === 'replace' && lgResp?.ok) {
                                outcome.propagationStatus = 'success';
                                outcome.status = 'processed';
                                outcome.reason = 'handled_by_langgraph';
                                summary.processed += 1;
                                summary.outcomes.push(outcome);
                                logger_1.default.info('Message handled by LangGraph; skipping default processing', { messageId });
                                continue;
                            }
                        }
                        catch (lgErr) {
                            logger_1.default.warn('LangGraph adapter failed for message, continuing default processing', { error: lgErr?.message });
                        }
                    }
                    if (!config_1.default.langgraph?.enabled && config_1.default.enterpriseAgent?.enabled) {
                        try {
                            const bridgeResp = await (0, enterpriseAgentBridge_1.runEnterpriseAgent)({ phone: '+' + customerPhone, message: messageText, conversationState: undefined });
                            if (config_1.default.enterpriseAgent.mode === 'replace' && bridgeResp?.ok) {
                                outcome.propagationStatus = 'success';
                                outcome.status = 'processed';
                                outcome.reason = 'handled_by_enterprise_agent';
                                summary.processed += 1;
                                summary.outcomes.push(outcome);
                                logger_1.default.info('Message handled by EnterpriseAgent bridge; skipping default processing', { messageId });
                                continue;
                            }
                        }
                        catch (bridgeErr) {
                            logger_1.default.warn('EnterpriseAgent bridge failed; continuing default processing', { error: bridgeErr?.message });
                        }
                    }
                    const processingResult = await whatsapp_service_1.whatsappService.handleIncomingMessage({
                        phoneNumberId,
                        customerPhone: '+' + customerPhone,
                        customerName,
                        messageText,
                        messageId,
                        interactiveId: extracted.interactiveId,
                        interactiveType: extracted.interactiveType,
                        businessDisplayPhone: metadata?.display_phone_number,
                    });
                    outcome.propagationStatus = processingResult.propagation.status;
                    if (processingResult.status === 'processed') {
                        outcome.status = 'processed';
                        outcome.reason = 'message_processed';
                        summary.processed += 1;
                    }
                    else if (processingResult.status === 'skipped') {
                        const duplicateReasons = new Set([
                            'duplicate_message_id',
                            'duplicate_customer_fingerprint',
                            'concurrent_customer_processing',
                        ]);
                        if (duplicateReasons.has(processingResult.reason || '')) {
                            outcome.status = 'duplicate';
                            outcome.reason = processingResult.reason || 'duplicate_message_id';
                            summary.duplicate += 1;
                        }
                        else {
                            outcome.status = 'skipped';
                            outcome.reason = processingResult.reason || 'service_skipped';
                            summary.skipped += 1;
                        }
                    }
                    else {
                        outcome.status = 'failed';
                        outcome.reason = processingResult.reason || 'service_failed';
                        summary.failed += 1;
                    }
                    summary.outcomes.push(outcome);
                    logger_1.default.info('=== MESSAGE HANDLED SUCCESSFULLY ===', { messageId });
                }
                catch (err) {
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
        const prisma = await getPrisma();
        const requestedProvider = req.body?.provider === 'greenapi' ? 'greenapi' : req.body?.provider === 'meta' ? 'meta' : null;
        const explicitPhoneNumberId = typeof req.body?.phoneNumberId === 'string' ? req.body.phoneNumberId.trim() : '';
        let resolvedPhoneNumberId = explicitPhoneNumberId || (config_1.default.whatsapp.phoneNumberId || '').trim();
        let resolvedProvider = requestedProvider || (config_1.default?.whatsapp?.provider === 'greenapi' ? 'greenapi' : 'meta');
        let candidateDerivedFromGreenApi = false;
        if (!resolvedPhoneNumberId) {
            const activeCompanies = await prisma.company.findMany({
                where: { status: 'active' },
                select: { settings: true },
            });
            const candidateIds = activeCompanies
                .map((company) => {
                const settings = company?.settings || {};
                const whatsapp = settings.whatsapp || {};
                const meta = whatsapp.meta || whatsapp;
                const greenapi = whatsapp.greenapi || whatsapp;
                return ((typeof meta.phoneNumberId === 'string' && meta.phoneNumberId.trim()) ||
                    (typeof meta.phone_number_id === 'string' && meta.phone_number_id.trim()) ||
                    (typeof whatsapp.phoneNumberId === 'string' && whatsapp.phoneNumberId.trim()) ||
                    (typeof greenapi.idInstance === 'string' && greenapi.idInstance.trim()) ||
                    '');
            })
                .filter((value) => value.length > 0);
            if (candidateIds.length === 1) {
                resolvedPhoneNumberId = candidateIds[0];
                const matchedCompany = activeCompanies.find((company) => {
                    const settings = company?.settings || {};
                    const whatsapp = settings.whatsapp || {};
                    const greenapi = whatsapp.greenapi || whatsapp;
                    const instanceId = (typeof greenapi.idInstance === 'string' && greenapi.idInstance.trim()) ||
                        (typeof whatsapp.idInstance === 'string' && whatsapp.idInstance.trim()) ||
                        '';
                    return instanceId === resolvedPhoneNumberId;
                });
                candidateDerivedFromGreenApi = !!matchedCompany;
            }
        }
        if (!requestedProvider && candidateDerivedFromGreenApi) {
            resolvedProvider = 'greenapi';
        }
        if (!resolvedPhoneNumberId) {
            res.status(400).json({
                error: 'Unable to resolve phoneNumberId for test message. Provide phoneNumberId in request body or configure company WhatsApp settings.',
            });
            return;
        }
        await whatsapp_service_1.whatsappService.handleIncomingMessage({
            provider: resolvedProvider,
            phoneNumberId: resolvedPhoneNumberId,
            customerPhone: phone,
            customerName: name || 'Test Customer',
            messageText: message,
            messageId: `test_${Date.now()}`,
        });
        // Get the latest conversation and AI response
        const lead = await prisma.lead.findFirst({
            where: { phone },
            orderBy: { createdAt: 'desc' },
        });
        if (!lead) {
            res.json({ message: 'Message processed but no lead found' });
            return;
        }
        const conversation = await prisma.conversation.findFirst({
            where: { leadId: lead.id },
            orderBy: { updatedAt: 'desc' },
        });
        const messages = conversation
            ? await prisma.message.findMany({
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
 * Synchronous webhook flow debugger — development only.
 * Returns step-by-step processing details. Disabled in production.
 */
router.post('/debug', express_1.default.json({ limit: '1mb' }), async (req, res) => {
    if (config_1.default.env === 'production') {
        res.status(403).json({ error: 'Debug endpoint is disabled in production' });
        return;
    }
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
                if (change.field !== 'messages')
                    continue;
                const value = change.value;
                const metadata = value.metadata;
                const phoneNumberId = metadata?.phone_number_id;
                const messages = value.messages || [];
                const contacts = value.contacts || [];
                log(`Phone Number ID in payload: ${phoneNumberId}`);
                log(`Messages: ${messages.length}, Contacts: ${contacts.length}`);
                // Try to find company
                log('Looking up company by phoneNumberId...');
                let companyResult = await whatsapp_service_1.whatsappService.getCompanyByPhoneNumberId(phoneNumberId);
                if (!companyResult) {
                    log('ERROR: No company found for phoneNumberId');
                    res.json({ success: false, error: 'No company found', debugLog });
                    return;
                }
                log(`Found company: ${companyResult.company.name} (${companyResult.company.id})`);
                for (let i = 0; i < messages.length; i++) {
                    const message = messages[i];
                    const contact = contacts[i];
                    log(`Message ${i}: type=${message.type}, from=${(0, maskPhoneNumberForLogs_1.maskPhoneNumberForLogs)(message.from) ?? '****'}`);
                    if (message.type !== 'text')
                        continue;
                    const customerPhone = '+' + message.from;
                    const customerName = contact?.profile?.name || '';
                    const messageText = message.text?.body || '';
                    log(`Processing: phone=${(0, maskPhoneNumberForLogs_1.maskPhoneNumberForLogs)(customerPhone) ?? '****'}, name=${customerName}, text=${messageText}`);
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
        const prisma = await getPrisma();
        const recentLeads = await prisma.lead.findMany({
            orderBy: { createdAt: 'desc' },
            take: 3,
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
