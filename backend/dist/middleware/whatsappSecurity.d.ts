import { Request, Response, NextFunction } from 'express';
/**
 * IP Whitelist Middleware for Meta Webhooks
 *
 * Validates that incoming requests originate from Meta's documented IP ranges.
 * This prevents spoofing attacks where malicious actors try to fake WhatsApp webhooks.
 */
export declare function whatsappIpWhitelist(req: Request, res: Response, next: NextFunction): void;
/**
 * Check if a specific IP is in Meta's whitelist
 */
export declare function isMetaIp(ip: string): boolean;
/**
 * Get all Meta IP ranges (for documentation/display)
 */
export declare function getMetaIpRanges(): string[];
//# sourceMappingURL=whatsappSecurity.d.ts.map