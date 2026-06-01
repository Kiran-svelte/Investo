interface IncomingMessage {
    /** Which inbound webhook delivered this message. Defaults to 'meta' for backward compatibility. */
    provider?: 'meta' | 'greenapi';
    phoneNumberId: string;
    customerPhone: string;
    customerName: string;
    messageText: string;
    messageId: string;
    /** Optional webhook auth token, used to disambiguate duplicated GreenAPI instance mappings. */
    webhookTokenHint?: string;
    /** Optional company id hint from tenant-scoped webhook URL. */
    companyIdHint?: string;
    /** Button/List item ID for interactive responses */
    interactiveId?: string;
    /** Type of interactive response */
    interactiveType?: 'button_reply' | 'list_reply';
}
interface CompanyWhatsAppConfig {
    provider?: 'meta' | 'greenapi';
    phoneNumberId: string;
    accessToken: string;
    verifyToken: string;
    /** Green-API credentials (per company). */
    idInstance?: string;
    apiTokenInstance?: string;
}
export interface InboundPropagationResult {
    status: 'success' | 'failed' | 'not_attempted';
    reason?: string;
}
export interface IncomingMessageProcessingResult {
    status: 'processed' | 'skipped' | 'failed';
    reason?: string;
    companyId?: string;
    leadId?: string;
    conversationId?: string;
    propagation: InboundPropagationResult;
}
export declare class WhatsAppService {
    private outboundProviders;
    private resolveOutboundProviderName;
    private getOutboundProvider;
    /**
     * Get company by WhatsApp phone number ID.
     * Deterministically resolves company routing from company.settings.whatsapp.phoneNumberId.
     */
    getCompanyByPhoneNumberId(phoneNumberId: string, providerHint?: 'meta' | 'greenapi', companyIdHint?: string, webhookTokenHint?: string, customerPhoneHint?: string): Promise<{
        company: any;
        config: CompanyWhatsAppConfig | null;
    } | null>;
    /**
     * Handle an incoming WhatsApp message.
     * Flow:
     * 1. Find the company by WhatsApp phone number ID
     * 2. Find or create lead + conversation
     * 3. Store the incoming message
     * 4. If conversation is ai_active, generate AI response
     * 5. Send AI response via WhatsApp Cloud API
     */
    handleIncomingMessage(msg: IncomingMessage): Promise<IncomingMessageProcessingResult>;
    private propagateConversationUpdate;
    /**
     * Send a message via WhatsApp Cloud API.
     * Uses company-specific config for multi-tenant support.
     */
    sendMessage(to: string, text: string, whatsappConfig: CompanyWhatsAppConfig): Promise<boolean>;
    /**
     * Test WhatsApp connection by calling the phone number endpoint.
     */
    testConnection(whatsappConfig: CompanyWhatsAppConfig): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Round-robin agent assignment (least-loaded).
     */
    private assignRoundRobin;
    /**
     * Send an image via WhatsApp Cloud API.
     * @param to - Recipient phone number in E.164 format
     * @param imageUrl - Public HTTPS URL of the image (jpg, png supported)
     * @param caption - Optional caption text (max 1024 chars)
     * @param whatsappConfig - Company-specific WhatsApp credentials
     */
    sendImage(to: string, imageUrl: string, caption: string | null, whatsappConfig: CompanyWhatsAppConfig): Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    /**
     * Send a document (PDF) via WhatsApp Cloud API.
     * @param to - Recipient phone number in E.164 format
     * @param documentUrl - Public HTTPS URL of the document
     * @param filename - Display filename (e.g., "Brochure.pdf")
     * @param caption - Optional caption text (max 1024 chars)
     * @param whatsappConfig - Company-specific WhatsApp credentials
     */
    sendDocument(to: string, documentUrl: string, filename: string, caption: string | null, whatsappConfig: CompanyWhatsAppConfig): Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    /**
     * Send a location pin via WhatsApp Cloud API.
     * @param to - Recipient phone number in E.164 format
     * @param latitude - Latitude (-90 to 90)
     * @param longitude - Longitude (-180 to 180)
     * @param name - Location name (e.g., "Sunshine Apartments")
     * @param address - Full address string
     * @param whatsappConfig - Company-specific WhatsApp credentials
     */
    sendLocation(to: string, latitude: number, longitude: number, name: string, address: string, whatsappConfig: CompanyWhatsAppConfig): Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    /**
     * Send interactive buttons via WhatsApp Cloud API.
     * @param to - Recipient phone number in E.164 format
     * @param bodyText - Main message body text
     * @param buttons - Array of buttons (max 3), each with id and title
     * @param headerText - Optional header text
     * @param footerText - Optional footer text
     * @param whatsappConfig - Company-specific WhatsApp credentials
     */
    sendInteractiveButtons(to: string, bodyText: string, buttons: Array<{
        id: string;
        title: string;
    }>, headerText: string | null, footerText: string | null, whatsappConfig: CompanyWhatsAppConfig): Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    /**
     * Send interactive list (menu) via WhatsApp Cloud API.
     * @param to - Recipient phone number in E.164 format
     * @param bodyText - Main message body text
     * @param buttonText - Text on the list button (max 20 chars)
     * @param sections - Array of sections, each with title and rows
     * @param headerText - Optional header text
     * @param footerText - Optional footer text
     * @param whatsappConfig - Company-specific WhatsApp credentials
     */
    sendInteractiveList(to: string, bodyText: string, buttonText: string, sections: Array<{
        title: string;
        rows: Array<{
            id: string;
            title: string;
            description?: string;
        }>;
    }>, headerText: string | null, footerText: string | null, whatsappConfig: CompanyWhatsAppConfig): Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    /**
     * Send multiple property images with captions.
     * Limits to max 3 images to avoid overwhelming the user.
     * @param to - Recipient phone number
     * @param images - Array of image URLs (max 3 will be sent)
     * @param propertyName - Property name for captions
     * @param whatsappConfig - Company-specific WhatsApp credentials
     */
    sendPropertyImages(to: string, images: string[], propertyName: string, whatsappConfig: CompanyWhatsAppConfig): Promise<{
        success: boolean;
        sent: number;
        errors: string[];
    }>;
    /**
     * Send property brochure if available.
     * @param to - Recipient phone number
     * @param brochureUrl - URL to brochure PDF
     * @param propertyName - Property name for filename
     * @param whatsappConfig - Company-specific WhatsApp credentials
     */
    sendPropertyBrochure(to: string, brochureUrl: string, propertyName: string, whatsappConfig: CompanyWhatsAppConfig): Promise<{
        success: boolean;
        messageId?: string;
        error?: string;
    }>;
    /**
     * Handle interactive button/list response actions.
     * Called when a user clicks a button or selects a list item.
     *
     * Action ID conventions:
     * - `book-visit` / `book-visit-{propertyId}`: Book a property visit
     * - `call-me` / `callback-request`: Request a callback
     * - `more-info` / `more-info-{propertyId}`: Get more property details
     * - `prop-{propertyId}`: Select a property from a list
     * - `filter-{type}`: Property type filter (2bhk, 3bhk, villa, etc.)
     * - `emi-calculator`: Request EMI calculation
     * - `show-location` / `location-{propertyId}`: Show property location
     */
    handleInteractiveAction(params: {
        interactiveId: string;
        interactiveType?: 'button_reply' | 'list_reply';
        lead: any;
        conversation: any;
        company: any;
        whatsappConfig: CompanyWhatsAppConfig;
        customerPhone: string;
    }): Promise<{
        handled: boolean;
        action?: string;
        newState?: {
            stage?: string;
            selectedPropertyId?: string;
            proposedVisitTime?: Date;
            recommendedPropertyIds?: string[];
        };
        leadStatus?: string;
    }>;
    /**
     * CHUNK 5: Determine if we should send property media based on conversation state
     * Send media when:
     * - AI is in 'shortlist' stage (presenting properties)
     * - AI is in 'commitment' or 'visit_booking' stages (deepening engagement)
     * - Recommended properties exist and have media
     */
    private getRecommendedPropertyIds;
    private shouldSendPropertyMedia;
    /**
     * CHUNK 5: Send property media (images, brochure, floor plans, location)
     * Implements progressive disclosure - don't overwhelm user with everything at once
     *
     * Layer 1 (Visual): Media is sent
     * Layer 2 (Interactive): User can click on media
     * Layer 3 (Operational): Media is logged in conversation
     * Layer 4 (Resilient): Errors don't crash conversation, fallback to text
     * Layer 5 (Integrated): State machine tracks what was sent
     */
    private sendPropertyMediaForStage;
    /**
     * Send a complete media set for one property
     * Progressive disclosure based on stage:
     * - Initial presentation: Photos + basic brochure
     * - Deeper interest: Floor plans + price list
     * - Almost closing: Location pin
     */
    private sendPropertyMediaSet;
    /**
     * CHUNK 6: Send property type filter buttons to help qualify leads faster
     * Layer 1 (Visual): WhatsApp interactive buttons appear
     * Layer 2 (Interactive): Buttons trigger filter actions
     * Layer 3 (Operational): Database tracks selections
     * Layer 4 (Resilient): Handles errors, prevents double-clicks
     * Layer 5 (Integrated): AI flow adapts based on selection
     */
    sendPropertyTypeFilters(customerPhone: string, whatsappConfig: CompanyWhatsAppConfig, context?: {
        leadId?: string;
        conversationId?: string;
        companyId?: string;
    }): Promise<void>;
    /**
     * CHUNK 6: Determine if we should send filter buttons based on conversation state
     * Send filters when:
     * - In 'qualify' stage and haven't captured property type preference yet
     * - User seems uncertain or asking general questions
     * - No filters sent in last 5 minutes (prevent spam)
     */
    private shouldSendPropertyFilters;
}
export declare const whatsappService: WhatsAppService;
export {};
//# sourceMappingURL=whatsapp.service.d.ts.map