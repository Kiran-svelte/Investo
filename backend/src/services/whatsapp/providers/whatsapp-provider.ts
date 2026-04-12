export interface WhatsAppProviderConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken?: string;
}

export type SendTextMessageResult =
  | { success: true; messageId?: string; status?: undefined; errorText?: undefined }
  | { success: false; status: number; errorText: string; messageId?: undefined };

export interface WhatsAppOutboundProvider {
  sendTextMessage(to: string, text: string, companyConfig: WhatsAppProviderConfig): Promise<SendTextMessageResult>;
  testConnection(companyConfig: WhatsAppProviderConfig): Promise<{ success: boolean; error?: string }>;
}
