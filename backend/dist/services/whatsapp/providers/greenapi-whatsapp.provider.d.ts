import { SendTextMessageResult, WhatsAppOutboundProvider, WhatsAppProviderConfig } from './whatsapp-provider';
export declare class GreenApiWhatsAppProvider implements WhatsAppOutboundProvider {
    private readonly apiUrl;
    constructor(params: {
        apiUrl: string;
    });
    sendTextMessage(to: string, text: string, companyConfig: WhatsAppProviderConfig): Promise<SendTextMessageResult>;
    testConnection(companyConfig: WhatsAppProviderConfig): Promise<{
        success: boolean;
        error?: string;
    }>;
    private buildUrl;
}
//# sourceMappingURL=greenapi-whatsapp.provider.d.ts.map