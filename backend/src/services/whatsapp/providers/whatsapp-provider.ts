export interface WhatsAppProviderConfig {
  /** Optional discriminator used by higher-level services. */
  provider?: 'meta' | 'greenapi';

  /** Meta Cloud API credentials (per company). */
  phoneNumberId?: string;
  accessToken?: string;

  /** Green-API credentials (per company). */
  idInstance?: string;
  apiTokenInstance?: string;

  /** Webhook verification token(s), when applicable. */
  verifyToken?: string;
}

export type SendTextMessageResult =
  | { success: true; messageId?: string; status?: undefined; errorText?: undefined }
  | { success: false; status: number; errorText: string; messageId?: undefined };

export interface WhatsAppOutboundProvider {
  sendTextMessage(to: string, text: string, companyConfig: WhatsAppProviderConfig): Promise<SendTextMessageResult>;
  testConnection(companyConfig: WhatsAppProviderConfig): Promise<{ success: boolean; error?: string }>;
}
