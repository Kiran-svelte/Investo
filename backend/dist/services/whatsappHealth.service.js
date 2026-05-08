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
exports.getWhatsAppHealth = exports.checkWhatsAppConnection = exports.whatsappHealthService = exports.WhatsAppHealthService = void 0;
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
const redis_1 = require("../config/redis");
/**
 * WhatsApp Health Check Service
 *
 * Monitors the health of WhatsApp API connections and provides
 * status information for monitoring and alerting.
 */
class WhatsAppHealthService {
    constructor() {
        this.lastHealthStatus = null;
        this.apiUrl = config_1.default.whatsapp.apiUrl;
    }
    /**
     * Check if the WhatsApp API is reachable
     *
     * Makes a lightweight API call to verify connectivity.
     * Uses the /app-subscribedcriptions endpoint as a health check.
     *
     * @param companyId - Company ID for multi-tenant scenarios
     * @returns Promise<HealthStatus> - Connection health status
     */
    async checkConnection(companyId) {
        const startTime = Date.now();
        // Check config completeness before making any network call.
        // Return a clear "not configured" status rather than "disconnected" noise.
        const configCheck = await this.checkConfigCompleteness(companyId);
        if (!configCheck.complete) {
            // #region agent log
            fetch('http://127.0.0.1:7571/ingest/b04febcc-8277-456d-aee1-de68df62bb9e', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '765cca' }, body: JSON.stringify({ sessionId: '765cca', runId: 'run1', hypothesisId: 'H3', location: 'whatsappHealth.service.ts:checkConnection-config-incomplete', message: 'WhatsApp config incomplete before health check', data: { hasCompanyId: Number(Boolean(companyId)), reason: configCheck.reason }, timestamp: Date.now() }) }).catch(() => { });
            // #endregion
            const status = {
                connected: false,
                responseTime: null,
                lastChecked: new Date(),
                error: configCheck.reason,
            };
            this.lastHealthStatus = status;
            logger_1.default.warn('WhatsApp health check: config incomplete', { companyId, reason: configCheck.reason });
            return status;
        }
        try {
            const provider = await this.resolveProvider(companyId);
            // #region agent log
            fetch('http://127.0.0.1:7571/ingest/b04febcc-8277-456d-aee1-de68df62bb9e', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '765cca' }, body: JSON.stringify({ sessionId: '765cca', runId: 'run1', hypothesisId: 'H4', location: 'whatsappHealth.service.ts:checkConnection-provider', message: 'WhatsApp health check provider resolved', data: { provider, hasCompanyId: Number(Boolean(companyId)) }, timestamp: Date.now() }) }).catch(() => { });
            // #endregion
            const response = provider === 'greenapi'
                ? await this.checkGreenApiConnection(companyId)
                : await this.checkMetaConnection(companyId);
            const responseTime = Date.now() - startTime;
            if (response.ok) {
                const status = {
                    connected: true,
                    responseTime,
                    lastChecked: new Date(),
                    error: null,
                };
                this.lastHealthStatus = status;
                logger_1.default.debug('WhatsApp health check: connected', { responseTime });
                return status;
            }
            else {
                const errorText = await response.text();
                const status = {
                    connected: false,
                    responseTime,
                    lastChecked: new Date(),
                    error: `WhatsApp ${provider} API error: ${response.status} - ${errorText}`,
                };
                this.lastHealthStatus = status;
                logger_1.default.warn('WhatsApp health check: failed', {
                    provider,
                    status: response.status,
                    error: errorText
                });
                return status;
            }
        }
        catch (err) {
            const responseTime = Date.now() - startTime;
            const status = {
                connected: false,
                responseTime,
                lastChecked: new Date(),
                error: `Connection failed: ${err.message}`,
            };
            this.lastHealthStatus = status;
            logger_1.default.error('WhatsApp health check: exception', { error: err.message });
            return status;
        }
    }
    /**
     * Get the overall system health status
     *
     * Includes WhatsApp API status, Redis availability,
     * and deduplication metrics.
     *
     * @returns Promise<SystemHealth> - Complete system health status
     */
    async getHealthStatus() {
        const whatsapp = this.lastHealthStatus || await this.checkConnection();
        // Check Redis
        const redis = await this.checkRedis();
        // Get deduplication stats
        const dedupStats = await this.getDeduplicationStats();
        return {
            whatsapp,
            redis,
            deduplication: dedupStats,
            timestamp: new Date(),
        };
    }
    /**
     * Verify a phone number is active on WhatsApp
     *
     * @param phoneNumberId - The phone number ID to verify
     * @param accessToken - Access token for the API
     * @returns Promise<boolean> - True if phone number is valid and active
     */
    async verifyPhoneNumber(phoneNumberId, accessToken) {
        const token = accessToken || config_1.default.whatsapp.accessToken;
        if (!token) {
            logger_1.default.warn('Cannot verify phone number: no access token');
            return false;
        }
        try {
            const response = await fetch(`${this.apiUrl}/${phoneNumberId}`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });
            if (response.ok) {
                const data = await response.json();
                // Check if the phone number is verified and has a valid status
                const isValid = data.verified_name || data.display_phone_number;
                logger_1.default.debug('Phone number verification', { phoneNumberId, isValid });
                return !!isValid;
            }
            logger_1.default.warn('Phone number verification failed', {
                phoneNumberId,
                status: response.status
            });
            return false;
        }
        catch (err) {
            logger_1.default.error('Phone number verification error', {
                phoneNumberId,
                error: err.message
            });
            return false;
        }
    }
    /**
     * Get the last cached health status
     *
     * @returns HealthStatus | null - Last known health status
     */
    getLastStatus() {
        return this.lastHealthStatus;
    }
    // ===== Private helper methods =====
    async getCompanyAccessToken(companyId) {
        try {
            const prisma = (await Promise.resolve().then(() => __importStar(require('../config/prisma')))).default;
            const company = await prisma.company.findUnique({
                where: { id: companyId },
                select: { settings: true },
            });
            const settings = company?.settings || {};
            const whatsapp = settings.whatsapp || {};
            const meta = whatsapp.meta || {};
            return meta.accessToken || whatsapp.accessToken || config_1.default.whatsapp.accessToken;
        }
        catch {
            return config_1.default.whatsapp.accessToken;
        }
    }
    async checkConfigCompleteness(companyId) {
        try {
            const provider = await this.resolveProvider(companyId);
            if (provider === 'greenapi') {
                const creds = await this.getGreenApiCredentials(companyId);
                if (!creds.idInstance || !creds.apiTokenInstance) {
                    return { complete: false, reason: 'Green-API not configured: missing idInstance or apiTokenInstance' };
                }
            }
            else {
                const accessToken = companyId
                    ? await this.getCompanyAccessToken(companyId)
                    : config_1.default.whatsapp.accessToken;
                if (!accessToken) {
                    return { complete: false, reason: 'Meta WhatsApp not configured: missing accessToken' };
                }
            }
            return { complete: true, reason: '' };
        }
        catch (err) {
            return { complete: false, reason: `Config check error: ${err.message}` };
        }
    }
    async resolveProvider(companyId) {
        if (!companyId) {
            return config_1.default.whatsapp.provider === 'greenapi' ? 'greenapi' : 'meta';
        }
        try {
            const prisma = (await Promise.resolve().then(() => __importStar(require('../config/prisma')))).default;
            const company = await prisma.company.findUnique({
                where: { id: companyId },
                select: { settings: true },
            });
            const settings = company?.settings || {};
            const whatsapp = settings.whatsapp || {};
            return whatsapp.provider === 'greenapi' ? 'greenapi' : 'meta';
        }
        catch {
            return config_1.default.whatsapp.provider === 'greenapi' ? 'greenapi' : 'meta';
        }
    }
    async checkMetaConnection(companyId) {
        const accessToken = companyId
            ? await this.getCompanyAccessToken(companyId)
            : config_1.default.whatsapp.accessToken;
        if (!accessToken) {
            throw new Error('No WhatsApp access token configured');
        }
        return fetch(`${this.apiUrl}/me`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        });
    }
    async checkGreenApiConnection(companyId) {
        const greenApiConfig = await this.getGreenApiCredentials(companyId);
        if (!greenApiConfig.idInstance || !greenApiConfig.apiTokenInstance) {
            throw new Error('Missing Green-API idInstance or apiTokenInstance');
        }
        const endpoint = `${config_1.default.greenapi.apiUrl}/waInstance${greenApiConfig.idInstance}/getSettings/${greenApiConfig.apiTokenInstance}`;
        return fetch(endpoint, { method: 'GET' });
    }
    async getGreenApiCredentials(companyId) {
        if (!companyId) {
            return {
                idInstance: config_1.default.greenapi.idInstance || '',
                apiTokenInstance: config_1.default.greenapi.apiTokenInstance || '',
            };
        }
        try {
            const prisma = (await Promise.resolve().then(() => __importStar(require('../config/prisma')))).default;
            const company = await prisma.company.findUnique({
                where: { id: companyId },
                select: { settings: true },
            });
            const settings = company?.settings || {};
            const whatsapp = settings.whatsapp || {};
            const greenapi = whatsapp.greenapi || whatsapp;
            return {
                idInstance: greenapi.idInstance || whatsapp.phoneNumberId || '',
                apiTokenInstance: greenapi.apiTokenInstance || whatsapp.apiTokenInstance || '',
            };
        }
        catch {
            return {
                idInstance: config_1.default.greenapi.idInstance || '',
                apiTokenInstance: config_1.default.greenapi.apiTokenInstance || '',
            };
        }
    }
    async checkRedis() {
        const startTime = Date.now();
        const redis = (0, redis_1.getRedis)();
        if (!redis) {
            return {
                available: false,
                type: 'memory',
                responseTime: null,
            };
        }
        try {
            await redis.ping();
            const responseTime = Date.now() - startTime;
            return {
                available: true,
                type: 'upstash',
                responseTime,
            };
        }
        catch (err) {
            logger_1.default.warn('Redis health check failed', { error: err.message });
            return {
                available: false,
                type: 'upstash',
                responseTime: null,
            };
        }
    }
    async getDeduplicationStats() {
        try {
            const { deduplicationService } = await Promise.resolve().then(() => __importStar(require('./deduplication.service')));
            const count = await deduplicationService.getProcessedCount();
            return {
                processedCount: count,
                ttlSeconds: config_1.default.whatsapp.dedupTtlSeconds || 300,
            };
        }
        catch (err) {
            logger_1.default.warn('Failed to get deduplication stats', { error: err.message });
            return {
                processedCount: 0,
                ttlSeconds: config_1.default.whatsapp.dedupTtlSeconds || 300,
            };
        }
    }
}
exports.WhatsAppHealthService = WhatsAppHealthService;
/**
 * Default health check service instance
 */
exports.whatsappHealthService = new WhatsAppHealthService();
/**
 * Convenience function for checking WhatsApp connection
 */
const checkWhatsAppConnection = (companyId) => exports.whatsappHealthService.checkConnection(companyId);
exports.checkWhatsAppConnection = checkWhatsAppConnection;
/**
 * Convenience function for getting system health
 */
const getWhatsAppHealth = () => exports.whatsappHealthService.getHealthStatus();
exports.getWhatsAppHealth = getWhatsAppHealth;
//# sourceMappingURL=whatsappHealth.service.js.map