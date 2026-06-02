"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetaWhatsAppProvider = void 0;
class MetaWhatsAppProvider {
    constructor(params) {
        this.apiUrl = params.apiUrl;
    }
    async sendTextMessage(to, text, companyConfig) {
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
        const result = (await response.json());
        return { success: true, messageId: result.messages?.[0]?.id };
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
