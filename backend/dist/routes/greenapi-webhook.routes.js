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
exports.greenApiWebhookRouteInternals = void 0;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = __importStar(require("express"));
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
const deduplication_service_1 = require("../services/deduplication.service");
const whatsapp_service_1 = require("../services/whatsapp.service");
const maskPhoneNumberForLogs_1 = require("../utils/maskPhoneNumberForLogs");
const router = (0, express_1.Router)();
router.post('/', express_1.default.json({ limit: '1mb' }), async (req, res) => {
    const providedToken = extractAuthorizationToken(req.headers.authorization);
    // Removed production restriction for GreenAPI
    if (!providedToken) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const globalToken = extractAuthorizationToken(config_1.default.greenapi.webhookUrlToken);
    // Fail closed in GreenAPI mode: require deterministic instance→company mapping before ack.
    const extracted = extractIncomingTextNotifications(req.body);
    if (extracted.length > 0) {
        const instanceIds = new Set(extracted
            .map((item) => item.instanceId)
            .filter((value) => typeof value === 'string' && value.trim().length > 0));
        if (instanceIds.size === 0) {
            res.status(422).json({ error: 'missing_instance_identifier', code: 'greenapi_missing_instance_identifier' });
            return;
        }
        if (instanceIds.size > 1) {
            res.status(422).json({ error: 'multiple_instance_identifiers', code: 'greenapi_multiple_instance_identifiers' });
            return;
        }
        const [instanceId] = Array.from(instanceIds);
        const companyResult = await whatsapp_service_1.whatsappService.getCompanyByPhoneNumberId(instanceId, 'greenapi', providedToken);
        if (!companyResult) {
            res.status(404).json({ error: 'company_not_found', code: 'greenapi_company_not_found' });
            return;
        }
        const companySettings = companyResult.company?.settings || {};
        const companyWhatsapp = companySettings.whatsapp || {};
        const companyGreenApi = companyWhatsapp.greenapi || {};
        const companyToken = extractAuthorizationToken(companyGreenApi.webhookUrlToken || companyWhatsapp.webhookUrlToken || undefined);
        const effectiveExpectedToken = companyToken || globalToken;
        if (!effectiveExpectedToken) {
            logger_1.default.error('GreenAPI webhook token not configured');
            res.status(500).json({ error: 'webhook_token_not_configured' });
            return;
        }
        const authorized = timingSafeEquals(providedToken, effectiveExpectedToken) ||
            (globalToken ? timingSafeEquals(providedToken, globalToken) : false);
        if (!authorized) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
    }
    else {
        if (!globalToken) {
            logger_1.default.error('GreenAPI webhook token not configured');
            res.status(500).json({ error: 'webhook_token_not_configured' });
            return;
        }
        if (!timingSafeEquals(providedToken, globalToken)) {
            res.status(401).json({ error: 'unauthorized' });
            return;
        }
    }
    // Respond quickly; process async to avoid webhook retries.
    res.status(200).json({ status: 'received' });
    processGreenApiWebhook(req.body)
        .then((summary) => {
        logger_1.default.info('GreenAPI webhook processing summary', { summary: redactGreenApiSummaryForLogs(summary) });
    })
        .catch((err) => {
        logger_1.default.error('GreenAPI webhook processing failed', { error: err.message });
    });
});
function extractAuthorizationToken(header) {
    const value = Array.isArray(header) ? header[0] : header;
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const match = trimmed.match(/^(?:Bearer|Basic)\s+(.+)$/i);
    return (match ? match[1] : trimmed).trim();
}
function timingSafeEquals(a, b) {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) {
        return false;
    }
    return crypto_1.default.timingSafeEqual(aBuf, bBuf);
}
function normalizeSenderToE164Like(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const digits = value.replace(/[^0-9]/g, '');
    if (digits.length < 8) {
        return null;
    }
    return `+${digits}`;
}
function normalizeInstanceIdentifier(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return null;
}
function extractGreenApiInstanceIdentifier(notification) {
    const idInstance = normalizeInstanceIdentifier(notification?.instanceData?.idInstance);
    if (idInstance) {
        return idInstance;
    }
    const wid = normalizeInstanceIdentifier(notification?.instanceData?.wid ?? notification?.wid);
    return wid;
}
function redactGreenApiSummaryForLogs(summary) {
    return {
        ...summary,
        outcomes: summary.outcomes.map((outcome) => ({
            ...outcome,
            from: (0, maskPhoneNumberForLogs_1.maskPhoneNumberForLogs)(outcome.from),
        })),
    };
}
function extractTextFromGreenApiMessageData(messageData) {
    if (!messageData || typeof messageData !== 'object') {
        return null;
    }
    const typeMessage = messageData.typeMessage;
    if (typeMessage === 'textMessage') {
        const text = messageData.textMessageData?.textMessage;
        return typeof text === 'string' ? text : null;
    }
    if (typeMessage === 'extendedTextMessage') {
        const text = messageData.extendedTextMessageData?.text;
        return typeof text === 'string' ? text : null;
    }
    const candidates = [
        messageData.textMessageData?.textMessage,
        messageData.extendedTextMessageData?.text,
        messageData.text,
        messageData.message,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === 'string') {
            return candidate;
        }
    }
    return null;
}
function isIncomingMessageNotification(notification) {
    const typeWebhook = notification?.typeWebhook;
    if (typeof typeWebhook !== 'string') {
        return false;
    }
    return typeWebhook.trim().toLowerCase() === 'incomingmessagereceived';
}
function extractIncomingTextNotifications(body) {
    const notifications = Array.isArray(body) ? body : [body];
    const extracted = [];
    for (const notification of notifications) {
        if (!isIncomingMessageNotification(notification)) {
            continue;
        }
        const messageId = typeof notification?.idMessage === 'string' ? notification.idMessage : null;
        const senderData = notification?.senderData;
        const messageData = notification?.messageData;
        const typeWebhook = typeof notification?.typeWebhook === 'string' ? notification.typeWebhook : null;
        const typeMessage = typeof messageData?.typeMessage === 'string' ? messageData.typeMessage : null;
        const rawSender = senderData?.sender ?? senderData?.chatId ?? null;
        const customerPhone = normalizeSenderToE164Like(rawSender);
        const customerNameRaw = (typeof senderData?.senderName === 'string' && senderData.senderName) ||
            (typeof senderData?.senderContactName === 'string' && senderData.senderContactName) ||
            '';
        const messageText = extractTextFromGreenApiMessageData(messageData);
        const instanceId = extractGreenApiInstanceIdentifier(notification);
        extracted.push({
            instanceId,
            messageId,
            customerPhone,
            customerName: customerNameRaw,
            messageText,
            typeWebhook,
            typeMessage,
        });
    }
    return extracted;
}
async function processGreenApiWebhook(body) {
    const summary = {
        totalNotifications: Array.isArray(body) ? body.length : 1,
        totalMessages: 0,
        processed: 0,
        skipped: 0,
        duplicate: 0,
        failed: 0,
        outcomes: [],
    };
    const extracted = extractIncomingTextNotifications(body);
    for (const msg of extracted) {
        summary.totalMessages += 1;
        const outcome = {
            messageId: msg.messageId,
            from: msg.customerPhone,
            typeWebhook: msg.typeWebhook,
            typeMessage: msg.typeMessage,
            status: 'skipped',
            reason: 'uninitialized',
            propagationStatus: 'not_attempted',
        };
        if (!msg.messageId) {
            outcome.status = 'skipped';
            outcome.reason = 'missing_message_id';
            summary.skipped += 1;
            summary.outcomes.push(outcome);
            continue;
        }
        if (!msg.instanceId) {
            outcome.status = 'skipped';
            outcome.reason = 'missing_instance_identifier';
            summary.skipped += 1;
            summary.outcomes.push(outcome);
            continue;
        }
        if (!msg.customerPhone) {
            outcome.status = 'skipped';
            outcome.reason = 'missing_sender_phone';
            summary.skipped += 1;
            summary.outcomes.push(outcome);
            continue;
        }
        if (typeof msg.messageText !== 'string') {
            outcome.status = 'skipped';
            outcome.reason = 'unsupported_message_type';
            summary.skipped += 1;
            summary.outcomes.push(outcome);
            continue;
        }
        const phoneNumberId = msg.instanceId;
        const dedupKey = `greenapi:${phoneNumberId}:${msg.messageId}`;
        const isClaimed = await deduplication_service_1.deduplicationService.claimMessageProcessing(dedupKey);
        if (!isClaimed) {
            outcome.status = 'duplicate';
            outcome.reason = 'duplicate_message_id';
            summary.duplicate += 1;
            summary.outcomes.push(outcome);
            continue;
        }
        try {
            const result = await whatsapp_service_1.whatsappService.handleIncomingMessage({
                provider: 'greenapi',
                phoneNumberId,
                customerPhone: msg.customerPhone,
                customerName: msg.customerName,
                messageText: msg.messageText,
                messageId: msg.messageId,
            });
            outcome.propagationStatus = result.propagation.status;
            if (result.status === 'processed') {
                outcome.status = 'processed';
                outcome.reason = 'message_processed';
                summary.processed += 1;
            }
            else if (result.status === 'skipped') {
                outcome.status = 'skipped';
                outcome.reason = result.reason || 'service_skipped';
                summary.skipped += 1;
            }
            else {
                outcome.status = 'failed';
                outcome.reason = result.reason || 'service_failed';
                summary.failed += 1;
                await deduplication_service_1.deduplicationService.release(dedupKey);
            }
            summary.outcomes.push(outcome);
        }
        catch (err) {
            await deduplication_service_1.deduplicationService.release(dedupKey);
            outcome.status = 'failed';
            outcome.reason = 'exception';
            outcome.error = err.message;
            summary.failed += 1;
            summary.outcomes.push(outcome);
        }
    }
    return summary;
}
exports.greenApiWebhookRouteInternals = {
    extractAuthorizationToken,
    timingSafeEquals,
    normalizeSenderToE164Like,
    extractGreenApiInstanceIdentifier,
    extractTextFromGreenApiMessageData,
    extractIncomingTextNotifications,
    processGreenApiWebhook,
};
exports.default = router;
//# sourceMappingURL=greenapi-webhook.routes.js.map