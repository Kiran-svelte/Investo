import { SendTextMessageResult, WhatsAppOutboundProvider, WhatsAppProviderConfig } from './whatsapp-provider';
import { withRetry } from '../../../utils/retry';
import logger from '../../../config/logger';
import { executeMetaApiWithCircuitBreaker } from '../../metaCircuitBreaker.service';

export class MetaWhatsAppProvider implements WhatsAppOutboundProvider {
  private readonly apiUrl: string;

  constructor(params: { apiUrl: string }) {
    this.apiUrl = params.apiUrl;
  }

  async sendTextMessage(to: string, text: string, companyConfig: WhatsAppProviderConfig): Promise<SendTextMessageResult> {
    const { phoneNumberId, accessToken } = companyConfig;

    if (!phoneNumberId || !accessToken) {
      return { success: false, status: 400, errorText: 'Missing phoneNumberId or accessToken' };
    }

    // Circuit breaker + retry for transient Meta API failures (network blips, 503s).
    // Auth errors (401, 403) and rate limits (429) are not retried.
    try {
      return await executeMetaApiWithCircuitBreaker(() =>
        withRetry(
          async () => {
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

            const result = (await response.json()) as { messages?: Array<{ id: string }> };
            return { success: true, messageId: result.messages?.[0]?.id };
          },
          {
            maxAttempts: 2,
            baseDelayMs: 500,
            timeoutMs: 10_000,
            label: 'meta_whatsapp_sendText',
          },
        ),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Meta WhatsApp sendTextMessage failed (circuit breaker or retry exhausted)', {
        error: msg,
        to: to.slice(-4).padStart(to.length, '*'),
      });
      return { success: false, status: 500, errorText: msg };
    }
  }

  async testConnection(companyConfig: WhatsAppProviderConfig): Promise<{ success: boolean; error?: string }> {
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
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
