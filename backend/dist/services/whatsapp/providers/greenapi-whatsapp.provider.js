"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GreenApiWhatsAppProvider = void 0;
class GreenApiWhatsAppProvider {
    constructor(params) {
        this.apiUrl = params.apiUrl.replace(/\/+$/, '');
    }
    async sendTextMessage(to, text, companyConfig) {
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
        const result = (await response.json());
        return { success: true, messageId: result.idMessage };
    }
    async testConnection(companyConfig) {
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
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    }
    buildUrl(endpoint, params) {
        return `${this.apiUrl}/waInstance${params.idInstance}/${endpoint}/${params.apiTokenInstance}`;
    }
}
exports.GreenApiWhatsAppProvider = GreenApiWhatsAppProvider;
function normalizePhoneToChatId(input) {
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
//# sourceMappingURL=greenapi-whatsapp.provider.js.map