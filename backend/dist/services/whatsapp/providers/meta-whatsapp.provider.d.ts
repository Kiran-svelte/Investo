import { SendTextMessageResult, WhatsAppOutboundProvider, WhatsAppProviderConfig } from './whatsapp-provider';
export declare class MetaWhatsAppProvider implements WhatsAppOutboundProvider {
    private readonly apiUrl;
    constructor(params: {
        apiUrl: string;
    });
    sendTextMessage(to: string, text: string, companyConfig: WhatsAppProviderConfig): Promise<SendTextMessageResult>;
    testConnection(companyConfig: WhatsAppProviderConfig): Promise<{
        success: boolean;
        error?: string;
    }>;
}
//# sourceMappingURL=meta-whatsapp.provider.d.ts.map