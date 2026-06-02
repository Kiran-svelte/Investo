import { SendTextMessageResult, WhatsAppOutboundProvider, WhatsAppProviderConfig } from './whatsapp-provider';

type GreenApiSendMessageResponse = {
  idMessage?: string;
};

export class GreenApiWhatsAppProvider implements WhatsAppOutboundProvider {
  private readonly apiUrl: string;

  constructor(params: { apiUrl: string }) {
    this.apiUrl = params.apiUrl.replace(/\/+$/, '');
  }

  async sendTextMessage(to: string, text: string, companyConfig: WhatsAppProviderConfig): Promise<SendTextMessageResult> {
    const { idInstance, apiTokenInstance } = companyConfig;

    if (!idInstance || !apiTokenInstance) {
      return { success: false, status: 400, errorText: 'Missing idInstance or apiTokenInstance' };
    }

    const response = await fetch(this.buildUrl('sendMessage', { idInstance, apiTokenInstance }), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chatId: normalizePhoneToChatId(to),
        message: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, status: response.status, errorText };
    }

    const result = (await response.json()) as GreenApiSendMessageResponse;
    return { success: true, messageId: result.idMessage };
  }

  async testConnection(companyConfig: WhatsAppProviderConfig): Promise<{ success: boolean; error?: string }> {
    const { idInstance, apiTokenInstance } = companyConfig;

    if (!idInstance || !apiTokenInstance) {
      return { success: false, error: 'Missing idInstance or apiTokenInstance' };
    }

    try {
      const response = await fetch(this.buildUrl('getSettings', { idInstance, apiTokenInstance }), {
        method: 'GET',
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `API Error: ${response.status} - ${error}` };
      }

      await response.json();
      return { success: true, error: undefined };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  private buildUrl(endpoint: 'sendMessage' | 'getSettings', params: { idInstance: string; apiTokenInstance: string }): string {
    return `${this.apiUrl}/waInstance${params.idInstance}/${endpoint}/${params.apiTokenInstance}`;
  }
}

function normalizePhoneToChatId(input: string): string {
  const trimmed = input.trim();

  // If the caller already provided a chat id (e.g. 919876543210@c.us or 1203630@g.us), do not mutate it.
  if (trimmed.includes('@')) {
    return trimmed;
  }

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) {
    throw new Error('Invalid phone number for WhatsApp chatId');
  }

  return `${digits}@c.us`;
}
