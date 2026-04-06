import config from '../config';
import logger from '../config/logger';
import { getRedis } from '../config/redis';

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
export class WhatsAppHealthService {
  private apiUrl: string;
  private lastHealthStatus: HealthStatus | null = null;

  constructor() {
    this.apiUrl = config.whatsapp.apiUrl;
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
  async checkConnection(companyId?: string): Promise<HealthStatus> {
    const startTime = Date.now();
    
    try {
      // Use the access token from config (or company-specific if provided)
      const accessToken = companyId 
        ? await this.getCompanyAccessToken(companyId)
        : config.whatsapp.accessToken;

      if (!accessToken) {
        const status: HealthStatus = {
          connected: false,
          responseTime: null,
          lastChecked: new Date(),
          error: 'No WhatsApp access token configured',
        };
        this.lastHealthStatus = status;
        return status;
      }

      // Make a lightweight API call to check connectivity
      // Using the phone number endpoint is a good health check
      const response = await fetch(`${this.apiUrl}/me?access_token=${accessToken}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        const status: HealthStatus = {
          connected: true,
          responseTime,
          lastChecked: new Date(),
          error: null,
        };
        this.lastHealthStatus = status;
        logger.debug('WhatsApp health check: connected', { responseTime });
        return status;
      } else {
        const errorText = await response.text();
        const status: HealthStatus = {
          connected: false,
          responseTime,
          lastChecked: new Date(),
          error: `WhatsApp API error: ${response.status} - ${errorText}`,
        };
        this.lastHealthStatus = status;
        logger.warn('WhatsApp health check: failed', { 
          status: response.status, 
          error: errorText 
        });
        return status;
      }
    } catch (err: any) {
      const responseTime = Date.now() - startTime;
      const status: HealthStatus = {
        connected: false,
        responseTime,
        lastChecked: new Date(),
        error: `Connection failed: ${err.message}`,
      };
      this.lastHealthStatus = status;
      logger.error('WhatsApp health check: exception', { error: err.message });
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
  async getHealthStatus(): Promise<SystemHealth> {
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
  async verifyPhoneNumber(phoneNumberId: string, accessToken?: string): Promise<boolean> {
    const token = accessToken || config.whatsapp.accessToken;
    
    if (!token) {
      logger.warn('Cannot verify phone number: no access token');
      return false;
    }

    try {
      const response = await fetch(
        `${this.apiUrl}/${phoneNumberId}?access_token=${token}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.ok) {
        const data = await response.json() as Record<string, unknown>;
        // Check if the phone number is verified and has a valid status
        const isValid = data.verified_name || data.display_phone_number;
        logger.debug('Phone number verification', { phoneNumberId, isValid });
        return !!isValid;
      }

      logger.warn('Phone number verification failed', { 
        phoneNumberId, 
        status: response.status 
      });
      return false;
    } catch (err: any) {
      logger.error('Phone number verification error', { 
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
  getLastStatus(): HealthStatus | null {
    return this.lastHealthStatus;
  }

  // ===== Private helper methods =====

  private async getCompanyAccessToken(companyId: string): Promise<string | null> {
    // In a multi-tenant scenario, you would look up the company's
    // specific access token from the database
    // For now, we use the global config token
    return config.whatsapp.accessToken;
  }

  private async checkRedis(): Promise<{
    available: boolean;
    type: string;
    responseTime: number | null;
  }> {
    const startTime = Date.now();
    const redis = getRedis();

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
    } catch (err: any) {
      logger.warn('Redis health check failed', { error: err.message });
      return {
        available: false,
        type: 'upstash',
        responseTime: null,
      };
    }
  }

  private async getDeduplicationStats(): Promise<{
    processedCount: number;
    ttlSeconds: number;
  }> {
    try {
      const { deduplicationService } = await import('./deduplication.service');
      const count = await deduplicationService.getProcessedCount();
      
      return {
        processedCount: count,
        ttlSeconds: config.whatsapp.dedupTtlSeconds || 300,
      };
    } catch (err: any) {
      logger.warn('Failed to get deduplication stats', { error: err.message });
      return {
        processedCount: 0,
        ttlSeconds: config.whatsapp.dedupTtlSeconds || 300,
      };
    }
  }
}

/**
 * Default health check service instance
 */
export const whatsappHealthService = new WhatsAppHealthService();

/**
 * Convenience function for checking WhatsApp connection
 */
export const checkWhatsAppConnection = (companyId?: string) =>
  whatsappHealthService.checkConnection(companyId);

/**
 * Convenience function for getting system health
 */
export const getWhatsAppHealth = () => whatsappHealthService.getHealthStatus();