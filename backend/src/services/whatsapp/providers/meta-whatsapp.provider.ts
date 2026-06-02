import { SendTextMessageResult, WhatsAppOutboundProvider, WhatsAppProviderConfig } from './whatsapp-provider';

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
      return { success: false, status: response.status, errorText };
    }

    const result = (await response.json()) as { messages?: Array<{ id: string }> };
    return { success: true, messageId: result.messages?.[0]?.id };
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
