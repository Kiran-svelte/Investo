/**
 * Health status for a single WhatsApp connection
 */
export interface HealthStatus {
    connected: boolean;
    responseTime: number | null;
    lastChecked: Date;
    error: string | null;
}
/**
 * Overall system health status
 */
export interface SystemHealth {
    whatsapp: HealthStatus;
    redis: {
        available: boolean;
        type: string;
        responseTime: number | null;
    };
    deduplication: {
        processedCount: number;
        ttlSeconds: number;
    };
    timestamp: Date;
}
/**
 * WhatsApp Health Check Service
 *
 * Monitors the health of WhatsApp API connections and provides
 * status information for monitoring and alerting.
 */
export declare class WhatsAppHealthService {
    private apiUrl;
    private lastHealthStatus;
    constructor();
    /**
     * Check if the WhatsApp API is reachable
     *
     * Makes a lightweight API call to verify connectivity.
     * Uses the /app-subscribedcriptions endpoint as a health check.
     *
     * @param companyId - Company ID for multi-tenant scenarios
     * @returns Promise<HealthStatus> - Connection health status
     */
    checkConnection(companyId?: string): Promise<HealthStatus>;
    /**
     * Get the overall system health status
     *
     * Includes WhatsApp API status, Redis availability,
     * and deduplication metrics.
     *
     * @returns Promise<SystemHealth> - Complete system health status
     */
    getHealthStatus(): Promise<SystemHealth>;
    /**
     * Verify a phone number is active on WhatsApp
     *
     * @param phoneNumberId - The phone number ID to verify
     * @param accessToken - Access token for the API
     * @returns Promise<boolean> - True if phone number is valid and active
     */
    verifyPhoneNumber(phoneNumberId: string, accessToken?: string): Promise<boolean>;
    /**
     * Get the last cached health status
     *
     * @returns HealthStatus | null - Last known health status
     */
    getLastStatus(): HealthStatus | null;
    private getCompanyAccessToken;
    private checkRedis;
    private getDeduplicationStats;
}
/**
 * Default health check service instance
 */
export declare const whatsappHealthService: WhatsAppHealthService;
/**
 * Convenience function for checking WhatsApp connection
 */
export declare const checkWhatsAppConnection: (companyId?: string) => Promise<HealthStatus>;
/**
 * Convenience function for getting system health
 */
export declare const getWhatsAppHealth: () => Promise<SystemHealth>;
//# sourceMappingURL=whatsappHealth.service.d.ts.map