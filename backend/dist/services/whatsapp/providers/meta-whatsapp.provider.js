"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaWhatsAppProvider = void 0;
const circuit_breaker_1 = require("../../../utils/circuit-breaker");
const retry_1 = require("../../../utils/retry");
const logger_1 = __importDefault(require("../../../config/logger"));
/** Circuit breaker shared across all Meta WhatsApp outbound calls (per process). */
const metaCircuitBreaker = (0, circuit_breaker_1.getCircuitBreaker)({
    name: 'meta_whatsapp_outbound',
    failureThreshold: 5,
    recoveryTimeoutMs: 30000,
    halfOpenMaxAttempts: 2,
});
class MetaWhatsAppProvider {
    constructor(params) {
        this.apiUrl = params.apiUrl;
    }
    async sendTextMessage(to, text, companyConfig) {
        const { phoneNumberId, accessToken } = companyConfig;
        if (!phoneNumberId || !accessToken) {
            return { success: false, status: 400, errorText: 'Missing phoneNumberId or accessToken' };
        }
        // Circuit breaker + retry for transient Meta API failures (network blips, 503s).
        // Auth errors (401, 403) and rate limits (429) are not retried.
        try {
            return await metaCircuitBreaker.execute(() => (0, retry_1.withRetry)(async () => {
                const response = await fetch(`${this.apiUrl}/${phoneNumberId}/messages`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        messaging_product: 'whatsapp',
                        to: to.replace('+', ''),
                        type: 'text',
                        text: { body: text },
                    }),
                });
                if (!response.ok) {
                    const errorText = await response.text();
                    // Don't retry auth / token errors — fail fast
                    if (response.status === 401 || response.status === 403) {
                        return { success: false, status: response.status, errorText };
                    }
                    throw new Error(`Meta API ${response.status}: ${errorText}`);
                }
                const result = (await response.json());
                return { success: true, messageId: result.messages?.[0]?.id };
            }, {
                maxAttempts: 2,
                baseDelayMs: 500,
                timeoutMs: 10000,
                label: 'meta_whatsapp_sendText',
            }));
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger_1.default.error('Meta WhatsApp sendTextMessage failed (circuit breaker or retry exhausted)', {
                error: msg,
                to: to.slice(-4).padStart(to.length, '*'),
            });
            return { success: false, status: 500, errorText: msg };
        }
    }
    async testConnection(companyConfig) {
        const { phoneNumberId, accessToken } = companyConfig;
        if (!phoneNumberId || !accessToken) {
            return { success: false, error: 'Missing phoneNumberId or accessToken' };
        }
        try {
            const response = await fetch(`${this.apiUrl}/${phoneNumberId}`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });
            if (!response.ok) {
                const error = await response.text();
                return { success: false, error: `API Error: ${response.status} - ${error}` };
            }
            await response.json();
            return {
                success: true,
                error: undefined,
            };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
}
exports.MetaWhatsAppProvider = MetaWhatsAppProvider;
