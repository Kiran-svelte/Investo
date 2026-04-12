import prisma from '../config/prisma';
import config from '../config';
import logger from '../config/logger';
import { maskPhoneNumberForLogs } from '../utils/maskPhoneNumberForLogs';
import { aiService } from './ai.service';
import { socketService, SOCKET_EVENTS } from './socket.service';
import {
  GreenApiWhatsAppProvider,
  MetaWhatsAppProvider,
  type WhatsAppOutboundProvider,
} from './whatsapp/providers';
import { 
  ConversationState, 
  conversationStateManager,
  ConversationStage,
  MicroCommitments,
  NextBestAction,
} from './conversationStateMachine';

interface IncomingMessage {
  phoneNumberId: string;
  customerPhone: string;
  customerName: string;
  messageText: string;
  messageId: string;
  /** Button/List item ID for interactive responses */
  interactiveId?: string;
  /** Type of interactive response */
  interactiveType?: 'button_reply' | 'list_reply';
}

interface CompanyWhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
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

export class WhatsAppService {
  private outboundProvider: WhatsAppOutboundProvider | null = null;
  private outboundProviderName: 'meta' | 'greenapi' | null = null;

  private resolveOutboundProviderName(): 'meta' | 'greenapi' {
    // Defense-in-depth: production must never instantiate GreenApi provider.
    if (config.env === 'production') {
      return 'meta';
    }

    // Some unit tests mock config with partial whatsapp object; default to meta.
    const configured = (config as any)?.whatsapp?.provider;
    return configured === 'greenapi' ? 'greenapi' : 'meta';
  }

  private getOutboundProvider(): WhatsAppOutboundProvider {
    const providerName = this.resolveOutboundProviderName();

    if (this.outboundProvider && this.outboundProviderName === providerName) {
      return this.outboundProvider;
    }

    this.outboundProviderName = providerName;
    this.outboundProvider =
      providerName === 'greenapi'
        ? new GreenApiWhatsAppProvider({
            apiUrl: (config as any)?.greenapi?.apiUrl || 'https://api.green-api.com',
            idInstance: (config as any)?.greenapi?.idInstance || '',
            apiTokenInstance: (config as any)?.greenapi?.apiTokenInstance || '',
          })
        : new MetaWhatsAppProvider({ apiUrl: config.whatsapp.apiUrl });

    return this.outboundProvider;
  }

  /**
   * Get company by WhatsApp phone number ID.
    * Deterministically resolves company routing from company.settings.whatsapp.phoneNumberId.
   */
  async getCompanyByPhoneNumberId(phoneNumberId: string): Promise<{ company: any; config: CompanyWhatsAppConfig | null } | null> {
    // Find all active companies
    const companies = await prisma.company.findMany({
      where: { status: 'active' },
      select: { id: true, name: true, settings: true, whatsappPhone: true },
    });

    const providerName = this.resolveOutboundProviderName();

    // GreenAPI inbound MUST be deterministically routed by instance identifier.
    // Fail closed if no company is explicitly mapped.
    if (providerName === 'greenapi') {
      const normalizedPhoneNumberId =
        typeof phoneNumberId === 'string' ? phoneNumberId.trim() : String(phoneNumberId ?? '').trim();

      if (!normalizedPhoneNumberId) {
        logger.error('GreenAPI company resolution failed: missing instance identifier (phoneNumberId)');
        return null;
      }

      for (const company of companies) {
        const settings = (company.settings as any) || {};
        const configuredId = typeof settings.whatsapp?.phoneNumberId === 'string' ? settings.whatsapp.phoneNumberId.trim() : '';

        if (configuredId && configuredId === normalizedPhoneNumberId) {
          return {
            company,
            config: {
              phoneNumberId: settings.whatsapp.phoneNumberId,
              accessToken: settings.whatsapp.accessToken || config.whatsapp.accessToken,
              verifyToken: settings.whatsapp.verifyToken || config.whatsapp.verifyToken,
            },
          };
        }
      }

      logger.error('No company found for GreenAPI instance', {
        phoneNumberId: normalizedPhoneNumberId,
        totalCompanies: companies.length,
      });
      return null;
    }

    const normalizedPhoneNumberId =
      typeof phoneNumberId === 'string' ? phoneNumberId.trim() : String(phoneNumberId ?? '').trim();

    if (!normalizedPhoneNumberId) {
      logger.error('Meta company resolution failed: missing phoneNumberId');
      return null;
    }

    const matches: any[] = [];
    for (const company of companies) {
      const settings = (company.settings as any) || {};
      const whatsappSettings = (settings.whatsapp as any) || {};

      const configuredId =
        typeof whatsappSettings.phoneNumberId === 'string' ? whatsappSettings.phoneNumberId.trim() : '';
      const legacyConfiguredId =
        typeof whatsappSettings.phone_number_id === 'string' ? whatsappSettings.phone_number_id.trim() : '';

      if (
        (configuredId && configuredId === normalizedPhoneNumberId) ||
        (legacyConfiguredId && legacyConfiguredId === normalizedPhoneNumberId)
      ) {
        matches.push(company);
      }
    }

    if (matches.length === 1) {
      const company = matches[0];
      const settings = (company.settings as any) || {};
      const whatsappSettings = (settings.whatsapp as any) || {};
      const configuredId =
        typeof whatsappSettings.phoneNumberId === 'string' ? whatsappSettings.phoneNumberId.trim() : '';
      const legacyConfiguredId =
        typeof whatsappSettings.phone_number_id === 'string' ? whatsappSettings.phone_number_id.trim() : '';

      return {
        company,
        config: {
          phoneNumberId: configuredId || legacyConfiguredId || normalizedPhoneNumberId,
          accessToken: whatsappSettings.accessToken || config.whatsapp.accessToken,
          verifyToken: whatsappSettings.verifyToken || config.whatsapp.verifyToken,
        },
      };
    }

    if (matches.length > 1) {
      logger.error('Meta company resolution failed: duplicate phoneNumberId mapping', {
        phoneNumberId: normalizedPhoneNumberId,
        matchingCompanyIds: matches.map((company) => company.id),
        totalCompanies: companies.length,
      });
      return null;
    }

    // No explicit mapping found.
    // Production must fail closed; non-prod may fall back only when exactly one active company exists.
    if (config.env === 'production') {
      logger.error('Meta company resolution failed: phoneNumberId is unmapped (production fail closed)', {
        phoneNumberId: normalizedPhoneNumberId,
        totalCompanies: companies.length,
      });
      return null;
    }

    if (companies.length === 1) {
      const company = companies[0];
      const settings = (company.settings as any) || {};
      const whatsappSettings = (settings.whatsapp as any) || {};
      const configuredId =
        typeof whatsappSettings.phoneNumberId === 'string' ? whatsappSettings.phoneNumberId.trim() : '';
      const legacyConfiguredId =
        typeof whatsappSettings.phone_number_id === 'string' ? whatsappSettings.phone_number_id.trim() : '';

      logger.warn('Meta company resolution fallback: single active company (non-production)', {
        companyId: company.id,
        companyName: company.name,
        requestedPhoneNumberId: normalizedPhoneNumberId,
      });

      return {
        company,
        config: {
          phoneNumberId: configuredId || legacyConfiguredId || normalizedPhoneNumberId,
          accessToken: whatsappSettings.accessToken || config.whatsapp.accessToken,
          verifyToken: whatsappSettings.verifyToken || config.whatsapp.verifyToken,
        },
      };
    }

    logger.error('Meta company resolution failed: phoneNumberId is unmapped (non-production fail closed)', {
      phoneNumberId: normalizedPhoneNumberId,
      totalCompanies: companies.length,
    });
    return null;
  }

  /**
   * Handle an incoming WhatsApp message.
   * Flow:
   * 1. Find the company by WhatsApp phone number ID
   * 2. Find or create lead + conversation
   * 3. Store the incoming message
   * 4. If conversation is ai_active, generate AI response
   * 5. Send AI response via WhatsApp Cloud API
   */
  async handleIncomingMessage(msg: IncomingMessage): Promise<IncomingMessageProcessingResult> {
    const notAttempted: InboundPropagationResult = { status: 'not_attempted' };

    logger.info('=== WHATSAPP SERVICE: handleIncomingMessage START ===', {
      phoneNumberId: msg.phoneNumberId,
      customerPhone: maskPhoneNumberForLogs(msg.customerPhone),
    });

    // 1. Find company by WhatsApp phone number ID
    const result = await this.getCompanyByPhoneNumberId(msg.phoneNumberId);

    if (!result) {
      logger.error('=== NO COMPANY FOUND ===', { phoneNumberId: msg.phoneNumberId });
      return {
        status: 'skipped',
        reason: 'company_not_found',
        propagation: notAttempted,
      };
    }

    logger.info('=== COMPANY FOUND ===', {
      companyId: result.company.id,
      companyName: result.company.name,
      hasConfig: !!result.config,
    });

    const { company, config: whatsappConfig } = result;
    const companyId = company.id;

    // 2. Find or create lead and conversation
    let lead = await prisma.lead.findFirst({
      where: { companyId, phone: msg.customerPhone },
    });

    if (!lead) {
      // Auto-create lead
      const agentId = await this.assignRoundRobin(companyId);

      lead = await prisma.lead.create({
        data: {
          companyId,
          customerName: msg.customerName || null,
          phone: msg.customerPhone,
          source: 'whatsapp',
          status: 'new',
          assignedAgentId: agentId,
          language: 'en',
        },
      });

      // Notify company admin about new lead
      await prisma.notification.create({
        data: {
          companyId,
          type: 'lead_new',
          title: 'New WhatsApp Lead',
          message: `New lead from ${msg.customerName || msg.customerPhone}`,
        },
      });

      logger.info('Auto-created lead from WhatsApp', { leadId: lead.id, companyId });
    }

    // Find or create conversation
    let conversation = await prisma.conversation.findFirst({
      where: { companyId, leadId: lead.id, status: { not: 'closed' } },
    });

    if (!conversation) {
      // Create conversation with initial state machine state
      const initialState = conversationStateManager.createInitialState();
      conversation = await prisma.conversation.create({
        data: {
          companyId,
          leadId: lead.id,
          whatsappPhone: msg.customerPhone,
          status: 'ai_active',
          language: 'en',
          aiEnabled: true,
          // State machine fields
          stage: 'rapport',
          stageEnteredAt: new Date(),
          stageMessageCount: 0,
          commitments: initialState.commitments as any,
          objectionCount: 0,
          consecutiveObjections: 0,
          urgencyScore: 5,
          valueScore: 5,
          recommendedPropertyIds: [],
        },
      });
    }

    // Reconstruct conversation state from DB
    const conversationState: ConversationState = {
      stage: (conversation.stage as ConversationStage) || 'rapport',
      previousStage: null,
      stageEnteredAt: conversation.stageEnteredAt || new Date(),
      messageCount: conversation.stageMessageCount || 0,
      commitments: (conversation.commitments as unknown as MicroCommitments) || conversationStateManager.createInitialState().commitments,
      objectionCount: conversation.objectionCount || 0,
      lastObjectionType: (conversation.lastObjectionType as any) || null,
      consecutiveObjections: conversation.consecutiveObjections || 0,
      urgencyScore: conversation.urgencyScore || 5,
      valueScore: conversation.valueScore || 5,
      escalationReason: conversation.escalationReason || null,
      recommendedProperties: (conversation.recommendedPropertyIds as unknown as string[]) || [],
      selectedPropertyId: conversation.selectedPropertyId || null,
      proposedVisitTime: conversation.proposedVisitTime || null,
    };

    // 3. Store incoming message
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType: 'customer',
        content: msg.messageText,
        whatsappMessageId: msg.messageId,
        status: 'delivered',
      },
    });

    // Update last contact
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastContactAt: new Date() },
    });

    let propagation = await this.propagateConversationUpdate({
      companyId,
      conversationId: conversation.id,
      leadId: lead.id,
      trigger: 'customer_message',
    });

    // 3.5. Handle interactive button/list responses
    if (msg.interactiveId) {
      const actionResult = await this.handleInteractiveAction({
        interactiveId: msg.interactiveId,
        interactiveType: msg.interactiveType,
        lead,
        conversation,
        company,
        whatsappConfig: whatsappConfig!,
        customerPhone: msg.customerPhone,
      });

      // If action was fully handled, don't proceed to AI response
      if (actionResult.handled) {
        logger.info('Interactive action handled', {
          interactiveId: msg.interactiveId,
          action: actionResult.action,
          conversationId: conversation.id,
        });
        
        // Update conversation state if action provided new state
        if (actionResult.newState) {
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              stage: actionResult.newState.stage as any,
              selectedPropertyId: actionResult.newState.selectedPropertyId || conversation.selectedPropertyId,
              proposedVisitTime: actionResult.newState.proposedVisitTime || conversation.proposedVisitTime,
            },
          });
        }
        
        // Update lead status if action provided new status
        if (actionResult.leadStatus) {
          await prisma.lead.update({
            where: { id: lead.id },
            data: { status: actionResult.leadStatus as any },
          });
        }
        
        propagation = await this.propagateConversationUpdate({
          companyId,
          conversationId: conversation.id,
          leadId: lead.id,
          trigger: 'interactive_action',
        });

        return {
          status: 'processed',
          companyId,
          leadId: lead.id,
          conversationId: conversation.id,
          propagation,
        };
      }
    }

    // 4. If conversation is ai_active, generate AI response with state machine
    if (conversation.status === 'ai_active' && conversation.aiEnabled) {
      try {
        // Get AI settings for this company
        const aiSettings = await prisma.aiSetting.findUnique({
          where: { companyId },
        });

        // Get conversation history
        const history = await prisma.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: 'asc' },
          take: 30,
        });

        // Get matching properties
        const properties = await prisma.property.findMany({
          where: { companyId, status: 'available' },
          take: 20,
        });

        // Generate AI response with state machine
        const aiResponse = await aiService.generateResponse({
          customerMessage: msg.messageText,
          conversationHistory: history,
          lead,
          properties,
          aiSettings: aiSettings || {},
          companyName: company.name,
          conversationState, // Pass the state machine state
        });

        logger.info('AI response generated', {
          conversationId: conversation.id,
          stage: aiResponse.newState?.stage,
          action: aiResponse.nextAction?.action,
        });

        // Store AI response
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderType: 'ai',
            content: aiResponse.text,
            language: aiResponse.detectedLanguage,
            status: 'sent',
          },
        });

        // Persist updated state machine state to conversation
        if (aiResponse.newState) {
          const newState = aiResponse.newState;
          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              stage: newState.stage,
              stageEnteredAt: newState.stageEnteredAt,
              stageMessageCount: newState.messageCount,
              commitments: newState.commitments as any,
              objectionCount: newState.objectionCount,
              lastObjectionType: newState.lastObjectionType,
              consecutiveObjections: newState.consecutiveObjections,
              urgencyScore: newState.urgencyScore,
              valueScore: newState.valueScore,
              escalationReason: newState.escalationReason,
              recommendedPropertyIds: newState.recommendedProperties as any,
              selectedPropertyId: newState.selectedPropertyId,
              proposedVisitTime: newState.proposedVisitTime,
              // Handle escalation
              ...(newState.stage === 'human_escalated' && {
                status: 'agent_active',
                escalatedAt: new Date(),
                aiEnabled: false,
              }),
            },
          });

          // Notify human agent if escalated
          if (newState.stage === 'human_escalated' && lead.assignedAgentId) {
            await prisma.notification.create({
              data: {
                companyId,
                userId: lead.assignedAgentId,
                type: 'agent_takeover',
                title: '🚨 AI Escalation - Human Agent Needed',
                message: `Lead ${lead.customerName || lead.phone} escalated: ${newState.escalationReason}`,
                data: {
                  leadId: lead.id,
                  conversationId: conversation.id,
                  reason: newState.escalationReason,
                  valueScore: newState.valueScore,
                },
              },
            });
          }
        }

        // Update lead language if detected
        if (aiResponse.detectedLanguage && aiResponse.detectedLanguage !== lead.language) {
          await prisma.lead.update({ where: { id: lead.id }, data: { language: aiResponse.detectedLanguage } });
          await prisma.conversation.update({ where: { id: conversation.id }, data: { language: aiResponse.detectedLanguage } });
        }

        // Update lead fields if AI extracted info
        if (aiResponse.extractedInfo) {
          const info = aiResponse.extractedInfo;
          const updates: any = {};
          if (info.budget_min) updates.budgetMin = info.budget_min;
          if (info.budget_max) updates.budgetMax = info.budget_max;
          if (info.location_preference) updates.locationPreference = info.location_preference;
          if (info.property_type) updates.propertyType = info.property_type;
          if (info.customer_name && !lead.customerName) updates.customerName = info.customer_name;
          await prisma.lead.update({ where: { id: lead.id }, data: updates });
        }

        // If lead is 'new', auto-transition to 'contacted'
        if (lead.status === 'new') {
          await prisma.lead.update({ where: { id: lead.id }, data: { status: 'contacted' } });
        }

        // Send via WhatsApp Cloud API using company-specific config
        await this.sendMessage(msg.customerPhone, aiResponse.text, whatsappConfig!);

        // CHUNK 5: AI Rich Media Presentation
        // If AI recommended properties and they have media, send it automatically
        if (aiResponse.newState && this.shouldSendPropertyMedia(aiResponse.newState, aiResponse.nextAction)) {
          await this.sendPropertyMediaForStage(
            msg.customerPhone,
            whatsappConfig!,
            aiResponse.newState,
            properties,
            lead,
            conversation.id
          );
        }

        // CHUNK 6: AI Interactive Filters
        // If AI is qualifying and lead hasn't specified preference, send filter buttons
        if (aiResponse.newState && this.shouldSendPropertyFilters(aiResponse.newState, lead, aiResponse.nextAction)) {
          await this.sendPropertyTypeFilters(
            msg.customerPhone,
            whatsappConfig!,
            {
              leadId: lead.id,
              conversationId: conversation.id,
              companyId,
            }
          );
        }

        logger.info('AI response sent', {
          conversationId: conversation.id,
          language: aiResponse.detectedLanguage,
        });
      } catch (err: any) {
        logger.error('AI response generation failed', { error: err.message });
      }
    } else {
      // Conversation is agent_active - AI does NOT send messages
      // Notify the assigned agent
      if (lead.assignedAgentId) {
        await prisma.notification.create({
          data: {
            companyId,
            userId: lead.assignedAgentId,
            type: 'agent_takeover',
            title: 'New message from customer',
            message: `${msg.customerName || msg.customerPhone}: ${msg.messageText.substring(0, 100)}`,
          },
        });
      }
    }

    return {
      status: 'processed',
      companyId,
      leadId: lead.id,
      conversationId: conversation.id,
      propagation,
    };
  }

  private async propagateConversationUpdate(payload: {
    companyId: string;
    conversationId: string;
    leadId: string;
    trigger: string;
  }): Promise<InboundPropagationResult> {
    try {
      const emitted = socketService.emitToCompany(payload.companyId, SOCKET_EVENTS.CONVERSATION_UPDATED, {
        conversationId: payload.conversationId,
        leadId: payload.leadId,
        trigger: payload.trigger,
        occurredAt: new Date().toISOString(),
      });

      if (!emitted) {
        logger.warn('Conversation propagation not emitted (socket unavailable)', payload);
        return { status: 'failed', reason: 'socket_unavailable' };
      }

      return { status: 'success' };
    } catch (err: any) {
      logger.error('Conversation propagation failed', {
        ...payload,
        error: err.message,
      });
      return { status: 'failed', reason: 'socket_emit_exception' };
    }
  }

  /**
   * Send a message via WhatsApp Cloud API.
   * Uses company-specific config for multi-tenant support.
   */
  async sendMessage(to: string, text: string, whatsappConfig: CompanyWhatsAppConfig): Promise<boolean> {
    const providerName = this.resolveOutboundProviderName();

    if (providerName === 'meta') {
      const { phoneNumberId, accessToken } = whatsappConfig;

      if (!phoneNumberId || !accessToken) {
        logger.error('WhatsApp config missing phoneNumberId or accessToken');
        return false;
      }
    }

    try {
      const result = await this.getOutboundProvider().sendTextMessage(to, text, whatsappConfig);

      if (!result.success) {
        logger.error('WhatsApp API error', { status: result.status, error: result.errorText });
        return false;
      }

      logger.info('WhatsApp message sent', { messageId: result.messageId });
      return true;
    } catch (err: any) {
      logger.error('Failed to send WhatsApp message', { error: err.message });
      return false;
    }
  }

  /**
   * Test WhatsApp connection by calling the phone number endpoint.
   */
  async testConnection(whatsappConfig: CompanyWhatsAppConfig): Promise<{ success: boolean; error?: string }> {
    return this.getOutboundProvider().testConnection(whatsappConfig);
  }

  /**
   * Round-robin agent assignment (least-loaded).
   */
  private async assignRoundRobin(companyId: string): Promise<string | null> {
    const agents = await prisma.user.findMany({
      where: { companyId, role: 'sales_agent', status: 'active' },
      select: { id: true },
    });

    if (agents.length === 0) return null;

    const leadCounts = await prisma.lead.groupBy({
      by: ['assignedAgentId'],
      where: {
        companyId,
        status: { notIn: ['closed_won', 'closed_lost'] },
        assignedAgentId: { in: agents.map((a) => a.id) },
      },
      _count: { id: true },
    });

    const countMap = new Map(leadCounts.map((l) => [l.assignedAgentId, l._count.id]));

    let minAgent = agents[0].id;
    let minCount = countMap.get(agents[0].id) || 0;
    for (const agent of agents) {
      const count = countMap.get(agent.id) || 0;
      if (count < minCount) {
        minCount = count;
        minAgent = agent.id;
      }
    }

    return minAgent;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RICH MEDIA SENDING METHODS (WhatsApp Cloud API)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Send an image via WhatsApp Cloud API.
   * @param to - Recipient phone number in E.164 format
   * @param imageUrl - Public HTTPS URL of the image (jpg, png supported)
   * @param caption - Optional caption text (max 1024 chars)
   * @param whatsappConfig - Company-specific WhatsApp credentials
   */
  async sendImage(
    to: string,
    imageUrl: string,
    caption: string | null,
    whatsappConfig: CompanyWhatsAppConfig
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (this.resolveOutboundProviderName() !== 'meta') {
      return {
        success: false,
        error: "Not supported: rich media sends require WHATSAPP_PROVIDER='meta'",
      };
    }

    const { phoneNumberId, accessToken } = whatsappConfig;

    if (!phoneNumberId || !accessToken) {
      logger.error('WhatsApp config missing for sendImage');
      return { success: false, error: 'Missing WhatsApp configuration' };
    }

    if (!imageUrl || !imageUrl.startsWith('https://')) {
      logger.error('Invalid image URL', { imageUrl });
      return { success: false, error: 'Image URL must be HTTPS' };
    }

    try {
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'image',
        image: {
          link: imageUrl,
        },
      };

      if (caption) {
        payload.image.caption = caption.substring(0, 1024); // WhatsApp limit
      }

      const response = await fetch(`${config.whatsapp.apiUrl}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('WhatsApp sendImage API error', { status: response.status, error: errorText });
        return { success: false, error: `API Error: ${response.status}` };
      }

      const result = await response.json() as { messages?: Array<{ id: string }> };
      const messageId = result.messages?.[0]?.id;
      logger.info('WhatsApp image sent', { messageId, to, imageUrl: imageUrl.substring(0, 50) });
      return { success: true, messageId };
    } catch (err: any) {
      logger.error('Failed to send WhatsApp image', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Send a document (PDF) via WhatsApp Cloud API.
   * @param to - Recipient phone number in E.164 format
   * @param documentUrl - Public HTTPS URL of the document
   * @param filename - Display filename (e.g., "Brochure.pdf")
   * @param caption - Optional caption text (max 1024 chars)
   * @param whatsappConfig - Company-specific WhatsApp credentials
   */
  async sendDocument(
    to: string,
    documentUrl: string,
    filename: string,
    caption: string | null,
    whatsappConfig: CompanyWhatsAppConfig
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (this.resolveOutboundProviderName() !== 'meta') {
      return {
        success: false,
        error: "Not supported: rich media sends require WHATSAPP_PROVIDER='meta'",
      };
    }

    const { phoneNumberId, accessToken } = whatsappConfig;

    if (!phoneNumberId || !accessToken) {
      logger.error('WhatsApp config missing for sendDocument');
      return { success: false, error: 'Missing WhatsApp configuration' };
    }

    if (!documentUrl || !documentUrl.startsWith('https://')) {
      logger.error('Invalid document URL', { documentUrl });
      return { success: false, error: 'Document URL must be HTTPS' };
    }

    try {
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'document',
        document: {
          link: documentUrl,
          filename: filename || 'document.pdf',
        },
      };

      if (caption) {
        payload.document.caption = caption.substring(0, 1024);
      }

      const response = await fetch(`${config.whatsapp.apiUrl}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('WhatsApp sendDocument API error', { status: response.status, error: errorText });
        return { success: false, error: `API Error: ${response.status}` };
      }

      const result = await response.json() as { messages?: Array<{ id: string }> };
      const messageId = result.messages?.[0]?.id;
      logger.info('WhatsApp document sent', { messageId, to, filename });
      return { success: true, messageId };
    } catch (err: any) {
      logger.error('Failed to send WhatsApp document', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Send a location pin via WhatsApp Cloud API.
   * @param to - Recipient phone number in E.164 format
   * @param latitude - Latitude (-90 to 90)
   * @param longitude - Longitude (-180 to 180)
   * @param name - Location name (e.g., "Sunshine Apartments")
   * @param address - Full address string
   * @param whatsappConfig - Company-specific WhatsApp credentials
   */
  async sendLocation(
    to: string,
    latitude: number,
    longitude: number,
    name: string,
    address: string,
    whatsappConfig: CompanyWhatsAppConfig
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (this.resolveOutboundProviderName() !== 'meta') {
      return {
        success: false,
        error: "Not supported: rich media sends require WHATSAPP_PROVIDER='meta'",
      };
    }

    const { phoneNumberId, accessToken } = whatsappConfig;

    if (!phoneNumberId || !accessToken) {
      logger.error('WhatsApp config missing for sendLocation');
      return { success: false, error: 'Missing WhatsApp configuration' };
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      logger.error('Invalid coordinates', { latitude, longitude });
      return { success: false, error: 'Invalid coordinates' };
    }

    try {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'location',
        location: {
          latitude,
          longitude,
          name: name || 'Property Location',
          address: address || '',
        },
      };

      const response = await fetch(`${config.whatsapp.apiUrl}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('WhatsApp sendLocation API error', { status: response.status, error: errorText });
        return { success: false, error: `API Error: ${response.status}` };
      }

      const result = await response.json() as { messages?: Array<{ id: string }> };
      const messageId = result.messages?.[0]?.id;
      logger.info('WhatsApp location sent', { messageId, to, name });
      return { success: true, messageId };
    } catch (err: any) {
      logger.error('Failed to send WhatsApp location', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Send interactive buttons via WhatsApp Cloud API.
   * @param to - Recipient phone number in E.164 format
   * @param bodyText - Main message body text
   * @param buttons - Array of buttons (max 3), each with id and title
   * @param headerText - Optional header text
   * @param footerText - Optional footer text
   * @param whatsappConfig - Company-specific WhatsApp credentials
   */
  async sendInteractiveButtons(
    to: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
    headerText: string | null,
    footerText: string | null,
    whatsappConfig: CompanyWhatsAppConfig
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (this.resolveOutboundProviderName() !== 'meta') {
      return {
        success: false,
        error: "Not supported: interactive sends require WHATSAPP_PROVIDER='meta'",
      };
    }

    const { phoneNumberId, accessToken } = whatsappConfig;

    if (!phoneNumberId || !accessToken) {
      logger.error('WhatsApp config missing for sendInteractiveButtons');
      return { success: false, error: 'Missing WhatsApp configuration' };
    }

    if (!buttons || buttons.length === 0 || buttons.length > 3) {
      logger.error('Invalid buttons array', { count: buttons?.length });
      return { success: false, error: 'Must have 1-3 buttons' };
    }

    try {
      const interactive: any = {
        type: 'button',
        body: {
          text: bodyText.substring(0, 1024),
        },
        action: {
          buttons: buttons.map((btn) => ({
            type: 'reply',
            reply: {
              id: btn.id.substring(0, 256),
              title: btn.title.substring(0, 20), // WhatsApp limit
            },
          })),
        },
      };

      if (headerText) {
        interactive.header = { type: 'text', text: headerText.substring(0, 60) };
      }

      if (footerText) {
        interactive.footer = { text: footerText.substring(0, 60) };
      }

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'interactive',
        interactive,
      };

      const response = await fetch(`${config.whatsapp.apiUrl}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('WhatsApp sendInteractiveButtons API error', { status: response.status, error: errorText });
        return { success: false, error: `API Error: ${response.status}` };
      }

      const result = await response.json() as { messages?: Array<{ id: string }> };
      const messageId = result.messages?.[0]?.id;
      logger.info('WhatsApp interactive buttons sent', { messageId, to, buttonCount: buttons.length });
      return { success: true, messageId };
    } catch (err: any) {
      logger.error('Failed to send WhatsApp interactive buttons', { error: err.message });
      return { success: false, error: err.message };
    }
  }

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
  async sendInteractiveList(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>,
    headerText: string | null,
    footerText: string | null,
    whatsappConfig: CompanyWhatsAppConfig
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (this.resolveOutboundProviderName() !== 'meta') {
      return {
        success: false,
        error: "Not supported: interactive sends require WHATSAPP_PROVIDER='meta'",
      };
    }

    const { phoneNumberId, accessToken } = whatsappConfig;

    if (!phoneNumberId || !accessToken) {
      logger.error('WhatsApp config missing for sendInteractiveList');
      return { success: false, error: 'Missing WhatsApp configuration' };
    }

    if (!sections || sections.length === 0) {
      logger.error('No sections provided for interactive list');
      return { success: false, error: 'Must have at least one section' };
    }

    // WhatsApp limit: max 10 total rows across all sections
    const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
    if (totalRows > 10) {
      logger.error('Too many rows in interactive list', { totalRows });
      return { success: false, error: 'Maximum 10 rows allowed' };
    }

    try {
      const interactive: any = {
        type: 'list',
        body: {
          text: bodyText.substring(0, 1024),
        },
        action: {
          button: buttonText.substring(0, 20),
          sections: sections.map((section) => ({
            title: section.title.substring(0, 24),
            rows: section.rows.map((row) => ({
              id: row.id.substring(0, 200),
              title: row.title.substring(0, 24),
              description: row.description?.substring(0, 72) || undefined,
            })),
          })),
        },
      };

      if (headerText) {
        interactive.header = { type: 'text', text: headerText.substring(0, 60) };
      }

      if (footerText) {
        interactive.footer = { text: footerText.substring(0, 60) };
      }

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'interactive',
        interactive,
      };

      const response = await fetch(`${config.whatsapp.apiUrl}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('WhatsApp sendInteractiveList API error', { status: response.status, error: errorText });
        return { success: false, error: `API Error: ${response.status}` };
      }

      const result = await response.json() as { messages?: Array<{ id: string }> };
      const messageId = result.messages?.[0]?.id;
      logger.info('WhatsApp interactive list sent', { messageId, to, sections: sections.length, rows: totalRows });
      return { success: true, messageId };
    } catch (err: any) {
      logger.error('Failed to send WhatsApp interactive list', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Send multiple property images with captions.
   * Limits to max 3 images to avoid overwhelming the user.
   * @param to - Recipient phone number
   * @param images - Array of image URLs (max 3 will be sent)
   * @param propertyName - Property name for captions
   * @param whatsappConfig - Company-specific WhatsApp credentials
   */
  async sendPropertyImages(
    to: string,
    images: string[],
    propertyName: string,
    whatsappConfig: CompanyWhatsAppConfig
  ): Promise<{ success: boolean; sent: number; errors: string[] }> {
    const errors: string[] = [];
    let sent = 0;

    // Limit to 3 images
    const imagesToSend = images.slice(0, 3);

    for (let i = 0; i < imagesToSend.length; i++) {
      const caption = i === 0 ? `📸 ${propertyName}` : null;
      const result = await this.sendImage(to, imagesToSend[i], caption, whatsappConfig);
      
      if (result.success) {
        sent++;
      } else {
        errors.push(`Image ${i + 1}: ${result.error}`);
      }

      // Small delay between messages to avoid rate limiting
      if (i < imagesToSend.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return { success: errors.length === 0, sent, errors };
  }

  /**
   * Send property brochure if available.
   * @param to - Recipient phone number
   * @param brochureUrl - URL to brochure PDF
   * @param propertyName - Property name for filename
   * @param whatsappConfig - Company-specific WhatsApp credentials
   */
  async sendPropertyBrochure(
    to: string,
    brochureUrl: string,
    propertyName: string,
    whatsappConfig: CompanyWhatsAppConfig
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!brochureUrl) {
      return { success: false, error: 'No brochure URL provided' };
    }

    const filename = `${propertyName.replace(/[^a-zA-Z0-9]/g, '_')}_Brochure.pdf`;
    const caption = `📋 Brochure - ${propertyName}`;

    return this.sendDocument(to, brochureUrl, filename, caption, whatsappConfig);
  }

  // ============================================================================
  // CHUNK 3: Interactive Button/List Action Handlers
  // ============================================================================

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
  async handleInteractiveAction(params: {
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
    newState?: { stage?: string; selectedPropertyId?: string; proposedVisitTime?: Date; recommendedPropertyIds?: string[] };
    leadStatus?: string;
  }> {
    const { interactiveId, lead, conversation, company, whatsappConfig, customerPhone } = params;
    
    logger.info('Processing interactive action', {
      interactiveId,
      leadId: lead.id,
      conversationId: conversation.id,
    });

    // ---- Book Visit Action ----
    if (interactiveId === 'book-visit' || interactiveId.startsWith('book-visit-')) {
      const propertyId = interactiveId.replace('book-visit-', '') !== 'book-visit' 
        ? interactiveId.replace('book-visit-', '') 
        : conversation.selectedPropertyId;

      // If no property selected, ask them to select first
      if (!propertyId) {
        await this.sendMessage(
          customerPhone,
          "I'd love to schedule a visit! Could you tell me which property you're interested in?",
          whatsappConfig
        );
        return { handled: true, action: 'book-visit-no-property' };
      }

      // Look up the property
      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      
      if (!property) {
        await this.sendMessage(
          customerPhone,
          "I couldn't find that property. Let me show you our available options.",
          whatsappConfig
        );
        return { handled: true, action: 'book-visit-invalid-property' };
      }

      // Send confirmation with visit scheduling buttons
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date();
      dayAfter.setDate(dayAfter.getDate() + 2);

      const formatDate = (d: Date) => d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });

      await this.sendInteractiveButtons(
        customerPhone,
        `Great choice! 🏠 Let's schedule your visit to *${property.name}*.\n\nWhen would you prefer to visit?`,
        [
          { id: `visit-time-${propertyId}-tomorrow-10am`, title: `${formatDate(tomorrow)} 10AM` },
          { id: `visit-time-${propertyId}-tomorrow-3pm`, title: `${formatDate(tomorrow)} 3PM` },
          { id: `visit-time-${propertyId}-dayafter`, title: `${formatDate(dayAfter)}` },
        ],
        `📅 Schedule Visit`,
        `Or tell me your preferred time`,
        whatsappConfig
      );

      // Notify assigned agent
      if (lead.assignedAgentId) {
        await prisma.notification.create({
          data: {
            companyId: company.id,
            userId: lead.assignedAgentId,
            type: 'visit_scheduled', // Using visit_scheduled as closest match for visit interest
            title: '📅 Visit Interest - Action Required',
            message: `${lead.customerName || lead.phone} wants to visit ${property.name}`,
            data: {
              leadId: lead.id,
              propertyId: property.id,
              propertyName: property.name,
            },
          },
        });
      }

      return { 
        handled: true, 
        action: 'book-visit-initiated',
        newState: { stage: 'visit_booking', selectedPropertyId: propertyId },
      };
    }

    // ---- Visit Time Selection ----
    if (interactiveId.startsWith('visit-time-')) {
      // Parse: visit-time-{propertyId}-{slot}
      const parts = interactiveId.replace('visit-time-', '').split('-');
      const propertyId = parts[0];
      const slot = parts.slice(1).join('-'); // tomorrow-10am, tomorrow-3pm, dayafter

      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      
      // Calculate proposed time
      let proposedTime = new Date();
      if (slot.includes('tomorrow')) {
        proposedTime.setDate(proposedTime.getDate() + 1);
        if (slot.includes('10am')) proposedTime.setHours(10, 0, 0, 0);
        else if (slot.includes('3pm')) proposedTime.setHours(15, 0, 0, 0);
      } else if (slot.includes('dayafter')) {
        proposedTime.setDate(proposedTime.getDate() + 2);
        proposedTime.setHours(11, 0, 0, 0);
      }

      // Confirm the visit
      const propertyName = property?.name || 'the property';
      await this.sendMessage(
        customerPhone,
        `✅ *Visit Confirmed!*\n\n📍 Property: ${propertyName}\n📅 Date: ${proposedTime.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' })}\n⏰ Time: ${proposedTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}\n\nOur representative will call you to confirm the details. Looking forward to seeing you! 🙏`,
        whatsappConfig
      );

      // Notify assigned agent with urgency
      if (lead.assignedAgentId) {
        await prisma.notification.create({
          data: {
            companyId: company.id,
            userId: lead.assignedAgentId,
            type: 'visit_scheduled',
            title: '🎯 Visit Scheduled - Call Customer',
            message: `${lead.customerName || lead.phone} confirmed visit to ${propertyName} on ${proposedTime.toLocaleDateString()}`,
            data: {
              leadId: lead.id,
              propertyId,
              visitTime: proposedTime.toISOString(),
            },
          },
        });
      }

      return {
        handled: true,
        action: 'visit-scheduled',
        newState: { stage: 'visit_booking', selectedPropertyId: propertyId, proposedVisitTime: proposedTime },
        leadStatus: 'visit_scheduled',
      };
    }

    // ---- Call Me / Callback Request ----
    if (interactiveId === 'call-me' || interactiveId === 'callback-request') {
      await this.sendMessage(
        customerPhone,
        `📞 Sure! Our sales representative will call you within the next 15 minutes.\n\nIn the meantime, feel free to ask me any questions about our properties! 😊`,
        whatsappConfig
      );

      // Create urgent notification for assigned agent
      if (lead.assignedAgentId) {
        await prisma.notification.create({
          data: {
            companyId: company.id,
            userId: lead.assignedAgentId,
            type: 'agent_takeover', // Using agent_takeover for callback requests
            title: '📞 URGENT: Callback Requested',
            message: `${lead.customerName || lead.phone} requested a callback - call within 15 minutes!`,
            data: {
              leadId: lead.id,
              conversationId: conversation.id,
              requestedAt: new Date().toISOString(),
            },
          },
        });
      }

      // Update lead status
      return {
        handled: true,
        action: 'callback-requested',
        leadStatus: 'contacted',
      };
    }

    // ---- More Info Request ----
    if (interactiveId === 'more-info' || interactiveId.startsWith('more-info-')) {
      const propertyId = interactiveId.replace('more-info-', '') !== 'more-info'
        ? interactiveId.replace('more-info-', '')
        : conversation.selectedPropertyId;

      if (!propertyId) {
        // No property context - let AI handle it
        return { handled: false };
      }

      const property = await prisma.property.findUnique({ where: { id: propertyId } });
      
      if (!property) {
        return { handled: false };
      }

      // Format price range (using priceMin/priceMax from schema)
      const formatPrice = (p: any) => {
        const min = p.priceMin ? Number(p.priceMin) : null;
        const max = p.priceMax ? Number(p.priceMax) : null;
        if (min && max) return `₹${(min / 100000).toFixed(0)}L - ₹${(max / 100000).toFixed(0)}L`;
        if (min) return `From ₹${(min / 100000).toFixed(0)} Lakhs`;
        if (max) return `Up to ₹${(max / 100000).toFixed(0)} Lakhs`;
        return 'Contact for price';
      };

      // Format location from locationCity/locationArea
      const formatLocation = (p: any) => {
        const parts = [p.locationArea, p.locationCity].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : null;
      };

      // Send detailed property info
      const details = [
        `🏠 *${property.name}*`,
        '',
        property.description || '',
        '',
        `💰 Price: ${formatPrice(property)}`,
        property.propertyType ? `🏢 Type: ${property.propertyType}` : '',
        property.bedrooms ? `🛏️ Bedrooms: ${property.bedrooms}` : '',
        formatLocation(property) ? `📍 Location: ${formatLocation(property)}` : '',
        property.builder ? `🏗️ Builder: ${property.builder}` : '',
      ].filter(Boolean).join('\n');

      await this.sendMessage(customerPhone, details, whatsappConfig);

      // Send brochure if available
      const brochureUrl = (property as any).brochureUrl;
      if (brochureUrl) {
        await this.sendPropertyBrochure(customerPhone, brochureUrl, property.name, whatsappConfig);
      }

      // Send images if available
      const images = (property as any).images as string[] | undefined;
      if (images && images.length > 0) {
        await this.sendPropertyImages(customerPhone, images, property.name, whatsappConfig);
      }

      // Follow up with action buttons
      await this.sendInteractiveButtons(
        customerPhone,
        `Would you like to take the next step? 🚀`,
        [
          { id: `book-visit-${propertyId}`, title: 'Book Visit' },
          { id: 'call-me', title: 'Call Me' },
          { id: `location-${propertyId}`, title: 'Show Location' },
        ],
        null,
        null,
        whatsappConfig
      );

      return {
        handled: true,
        action: 'more-info-sent',
        newState: { selectedPropertyId: propertyId },
      };
    }

    // ---- Property Selection from List ----
    if (interactiveId.startsWith('prop-')) {
      const propertyId = interactiveId.replace('prop-', '');
      
      // This should trigger the more-info flow
      return this.handleInteractiveAction({
        ...params,
        interactiveId: `more-info-${propertyId}`,
      });
    }

    // ---- Property Filter Selection ----
    // CHUNK 6: Enhanced with all 5 layers
    if (interactiveId.startsWith('filter-')) {
      const filterValue = interactiveId.replace('filter-', '');
      
      // Layer 4 (Resilient): Prevent double-click/duplicate processing
      const recentFilterAction = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          content: { contains: `Filter applied: ${filterValue}` },
          createdAt: {
            gte: new Date(Date.now() - 30 * 1000), // Last 30 seconds
          },
        },
      });

      if (recentFilterAction) {
        logger.info('Filter already applied recently, skipping duplicate', {
          filter: filterValue,
          conversationId: conversation.id,
        });
        return { handled: true, action: 'filter-duplicate-prevented' };
      }

      // Map filter IDs to property types/preferences
      const filterMap: Record<string, { propertyType?: string; bedrooms?: number; displayName: string }> = {
        '1bhk': { bedrooms: 1, displayName: '1 BHK' },
        '2bhk': { bedrooms: 2, displayName: '2 BHK' },
        '3bhk': { bedrooms: 3, displayName: '3 BHK' },
        '4bhk': { bedrooms: 4, displayName: '4 BHK' },
        '5bhk': { bedrooms: 5, displayName: '5 BHK' },
        'villa': { propertyType: 'villa', displayName: 'Villa' },
        'apartment': { propertyType: 'apartment', displayName: 'Apartment' },
        'plot': { propertyType: 'plot', displayName: 'Plot' },
        'commercial': { propertyType: 'commercial', displayName: 'Commercial' },
      };

      const filter = filterMap[filterValue.toLowerCase()];
      
      if (!filter) {
        // Unknown filter - let AI handle it
        logger.warn('Unknown filter value', { filterValue });
        return { handled: false };
      }

      try {
        // Layer 3 (Operational): Update lead preferences in database
        const updatedLead = await prisma.lead.update({
          where: { id: lead.id },
          data: {
            propertyType: filter.propertyType || lead.propertyType,
            ...(filter.bedrooms && { 
              notes: lead.notes 
                ? `${lead.notes}; Prefers ${filter.bedrooms} BHK` 
                : `Prefers ${filter.bedrooms} BHK` 
            }),
          },
        });

        // Layer 5 (Integrated): Update conversation state
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            stage: 'shortlist' as any, // Move to shortlist after filter selection
            stageEnteredAt: new Date(),
            stageMessageCount: 0,
          },
        });

        // Layer 3 (Operational): Log the filter action
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderType: 'customer',
            content: `Filter applied: ${filter.displayName}`,
            status: 'sent',
          },
        });

        // Build property filter query with budget considerations
        const propertyWhere: any = {
          companyId: company.id,
          status: 'available',
        };
        
        if (filter.propertyType) propertyWhere.propertyType = filter.propertyType as any;
        if (filter.bedrooms) propertyWhere.bedrooms = filter.bedrooms;
        
        // Apply budget filter if lead has budget preference
        if (updatedLead.budgetMin || updatedLead.budgetMax) {
          propertyWhere.AND = [];
          if (updatedLead.budgetMin) {
            propertyWhere.AND.push({ priceMin: { gte: updatedLead.budgetMin } });
          }
          if (updatedLead.budgetMax) {
            propertyWhere.AND.push({ priceMax: { lte: updatedLead.budgetMax } });
          }
        }

        // Find matching properties
        const properties = await prisma.property.findMany({
          where: propertyWhere,
          take: 10, // Get up to 10 matches
          orderBy: { createdAt: 'desc' },
        });

        // Layer 4 (Resilient): Handle no results gracefully
        if (properties.length === 0) {
          await this.sendMessage(
            customerPhone,
            `I couldn't find any ${filter.displayName} properties that match your criteria right now. ${updatedLead.budgetMin || updatedLead.budgetMax ? 'Would you like to adjust your budget or see other property types?' : 'Would you like to see other options?'}`,
            whatsappConfig
          );

          // Log no results
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              senderType: 'ai',
              content: `No ${filter.displayName} properties found`,
              status: 'sent',
            },
          });

          return { 
            handled: true, 
            action: 'filter-no-results',
            newState: { stage: 'qualify' }, // Go back to qualify if no results
          };
        }

        // Helper to format price for list row
        const formatListPrice = (p: any) => {
          const min = p.priceMin ? Number(p.priceMin) : null;
          if (min) return `₹${(min / 100000).toFixed(0)}L`;
          return 'Call';
        };

        // Layer 1 (Visual): Send property list with interactive buttons
        const sections = [{
          title: `${filter.displayName} Options (${properties.length})`,
          rows: properties.slice(0, 10).map((p) => ({
            id: `prop-${p.id}`,
            title: p.name.substring(0, 24),
            description: `${formatListPrice(p)} - ${p.locationArea || p.locationCity || 'TBD'}`.substring(0, 72),
          })),
        }];

        await this.sendInteractiveList(
          customerPhone,
          `Great choice! Found ${properties.length} ${filter.displayName} ${properties.length === 1 ? 'property' : 'properties'} for you! 🏠✨`,
          'View Properties',
          sections,
          `${filter.displayName} Properties`,
          `Select to know more`,
          whatsappConfig
        );

        // Layer 5 (Integrated): Update conversation with recommended properties
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            recommendedPropertyIds: properties.map(p => p.id) as any,
          },
        });

        // Log success
        logger.info('Filter applied successfully', {
          filter: filter.displayName,
          matchCount: properties.length,
          conversationId: conversation.id,
          leadId: lead.id,
        });

        return { 
          handled: true, 
          action: 'filter-applied',
          newState: { 
            stage: 'shortlist',
            recommendedPropertyIds: properties.map(p => p.id),
          },
        };

      } catch (error: any) {
        // Layer 4 (Resilient): Handle all errors gracefully
        logger.error('Filter application failed', {
          error: error.message,
          filter: filterValue,
          conversationId: conversation.id,
        });

        // Fallback message
        await this.sendMessage(
          customerPhone,
          `I'm having trouble filtering properties right now. Let me help you manually - what specific ${filter.displayName} properties would you like to know about?`,
          whatsappConfig
        );

        return { handled: true, action: 'filter-error' };
      }
    }

    // ---- Show Location ----
    if (interactiveId.startsWith('location-')) {
      const propertyId = interactiveId.replace('location-', '');
      const property = await prisma.property.findUnique({ where: { id: propertyId } });

      if (!property) {
        return { handled: false };
      }

      // Use latitude/longitude from schema
      const lat = property.latitude ? Number(property.latitude) : null;
      const lng = property.longitude ? Number(property.longitude) : null;

      // Format address from available fields
      const formatAddress = (p: any) => {
        const parts = [p.locationArea, p.locationCity, p.locationPincode].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : '';
      };

      if (lat && lng) {
        await this.sendLocation(
          customerPhone,
          lat,
          lng,
          property.name,
          formatAddress(property),
          whatsappConfig
        );
      } else {
        // No coordinates - send address as text
        const addressText = formatAddress(property) || 'Address not available';
        await this.sendMessage(
          customerPhone,
          `📍 *${property.name}*\n\n${addressText}\n\nPlease contact us for directions.`,
          whatsappConfig
        );
      }

      return { handled: true, action: 'location-sent' };
    }

    // ---- EMI Calculator Request ----
    if (interactiveId === 'emi-calculator' || interactiveId === 'calculate-emi') {
      // This will be fully implemented in CHUNK 7
      // For now, send a placeholder message
      const propertyId = conversation.selectedPropertyId;
      const property = propertyId 
        ? await prisma.property.findUnique({ where: { id: propertyId } })
        : null;

      // Use priceMin for EMI calculation
      const propertyPrice = property?.priceMin ? Number(property.priceMin) : null;

      if (property && propertyPrice) {
        // Quick EMI estimate (assuming 20% down payment, 8.5% interest, 20 years)
        const principal = propertyPrice * 0.8;
        const monthlyRate = 0.085 / 12;
        const months = 240;
        const emi = (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / 
                    (Math.pow(1 + monthlyRate, months) - 1);

        await this.sendMessage(
          customerPhone,
          `📊 *EMI Estimate for ${property.name}*\n\n💰 Property Price: ₹${(propertyPrice / 100000).toFixed(2)} Lakhs\n📉 Down Payment (20%): ₹${(propertyPrice * 0.2 / 100000).toFixed(2)} Lakhs\n📈 Loan Amount: ₹${(principal / 100000).toFixed(2)} Lakhs\n💳 EMI (20 yrs @ 8.5%): ₹${Math.round(emi).toLocaleString('en-IN')}/month\n\n_This is an estimate. Actual EMI may vary based on your bank's interest rate._`,
          whatsappConfig
        );
      } else {
        await this.sendMessage(
          customerPhone,
          `I can help you calculate EMI! Please tell me the property price you're considering, or select a property first.`,
          whatsappConfig
        );
      }

      return { handled: true, action: 'emi-calculated' };
    }

    // ---- Unrecognized action - let AI handle it ----
    logger.info('Unrecognized interactive action, passing to AI', { interactiveId });
    return { handled: false };
  }

  /**
   * CHUNK 5: Determine if we should send property media based on conversation state
   * Send media when:
   * - AI is in 'shortlist' stage (presenting properties)
   * - AI is in 'commitment' or 'visit_booking' stages (deepening engagement)
   * - Recommended properties exist and have media
   */
  private shouldSendPropertyMedia(state: ConversationState, action?: NextBestAction): boolean {
    // Send media when presenting properties (shortlist stage)
    if (state.stage === 'shortlist') {
      return state.recommendedProperties && state.recommendedProperties.length > 0;
    }

    // Also send when advancing to shortlist or commitment stages
    if (action?.action === 'advance_stage' && (action.targetStage === 'shortlist' || action.targetStage === 'commitment')) {
      return state.recommendedProperties && state.recommendedProperties.length > 0;
    }

    return false;
  }

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
  private async sendPropertyMediaForStage(
    customerPhone: string,
    whatsappConfig: any,
    state: ConversationState,
    allProperties: any[],
    lead: any,
    conversationId: string
  ): Promise<void> {
    try {
      // Get properties that were recommended
      const recommendedIds = state.recommendedProperties || [];
      if (recommendedIds.length === 0) return;

      // Limit to top 3 properties to avoid overwhelming user
      const propertiesToShow = recommendedIds.slice(0, 3);
      
      for (const propertyId of propertiesToShow) {
        const property = allProperties.find(p => p.id === propertyId);
        if (!property) continue;

        await this.sendPropertyMediaSet(
          customerPhone,
          whatsappConfig,
          property,
          state,
          conversationId
        );

        // Rate limit: 200ms between properties to avoid overwhelming WhatsApp API
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      logger.info('Property media sent successfully', {
        conversationId,
        propertyCount: propertiesToShow.length,
        stage: state.stage,
      });

    } catch (error: any) {
      // Layer 4 (Resilient): Log error but don't crash the conversation
      logger.error('Failed to send property media', {
        error: error.message,
        conversationId,
        stage: state.stage,
      });

      // Fallback: Send a text message explaining media couldn't be sent
      try {
        await this.sendMessage(
          customerPhone,
          `_I'm having trouble sending the property images right now. You can view them at our website or I can send the details via text. Would you like that?_`,
          whatsappConfig
        );
      } catch (fallbackError: any) {
        logger.error('Even fallback message failed', { error: fallbackError.message });
      }
    }
  }

  /**
   * Send a complete media set for one property
   * Progressive disclosure based on stage:
   * - Initial presentation: Photos + basic brochure
   * - Deeper interest: Floor plans + price list
   * - Almost closing: Location pin
   */
  private async sendPropertyMediaSet(
    customerPhone: string,
    whatsappConfig: any,
    property: any,
    state: ConversationState,
    conversationId: string
  ): Promise<void> {
    const mediasSent: string[] = [];
    const errors: string[] = [];

    // 1. ALWAYS send property photos (if available) - most engaging
    if (property.images && Array.isArray(property.images) && property.images.length > 0) {
      try {
        // Send up to 3 photos
        const imagesToSend = property.images.slice(0, 3);
        await this.sendPropertyImages(
          customerPhone,
          imagesToSend,
          property.name,
          whatsappConfig
        );
        mediasSent.push('images');
      } catch (error: any) {
        errors.push(`images: ${error.message}`);
        logger.error('Failed to send property images', {
          propertyId: property.id,
          error: error.message,
        });
      }
    }

    // 2. Send brochure if available (initial presentation or deeper interest)
    if (property.brochureUrl && (state.stage === 'shortlist' || state.stage === 'commitment')) {
      try {
        await this.sendPropertyBrochure(
          customerPhone,
          property.brochureUrl,
          property.name,
          whatsappConfig
        );
        mediasSent.push('brochure');
      } catch (error: any) {
        errors.push(`brochure: ${error.message}`);
        logger.error('Failed to send brochure', {
          propertyId: property.id,
          error: error.message,
        });
      }
    }

    // 3. Send floor plans if showing deeper interest
    if (property.floorPlanUrls && Array.isArray(property.floorPlanUrls) && property.floorPlanUrls.length > 0) {
      if (state.stage === 'commitment' || state.stage === 'visit_booking' || state.messageCount > 3) {
        try {
          // Send floor plans as documents
          for (const floorPlanUrl of property.floorPlanUrls.slice(0, 3)) {
            await this.sendDocument(
              customerPhone,
              floorPlanUrl,
              `${property.name} - Floor Plan.pdf`,
              `Floor plan for ${property.name}`,
              whatsappConfig
            );
          }
          mediasSent.push('floor_plans');
        } catch (error: any) {
          errors.push(`floor_plans: ${error.message}`);
          logger.error('Failed to send floor plans', {
            propertyId: property.id,
            error: error.message,
          });
        }
      }
    }

    // 4. Send price list if available and appropriate stage
    if (property.priceListUrl && (state.stage === 'commitment' || state.stage === 'visit_booking')) {
      try {
        await this.sendDocument(
          customerPhone,
          property.priceListUrl,
          `${property.name} - Price List.pdf`,
          `Complete pricing details for ${property.name}`,
          whatsappConfig
        );
        mediasSent.push('price_list');
      } catch (error: any) {
        errors.push(`price_list: ${error.message}`);
        logger.error('Failed to send price list', {
          propertyId: property.id,
          error: error.message,
        });
      }
    }

    // 5. Send location pin if property has coordinates
    if (property.latitude && property.longitude) {
      try {
        const address = [
          property.locationArea,
          property.locationCity,
          property.locationPincode
        ].filter(Boolean).join(', ');

        await this.sendLocation(
          customerPhone,
          property.latitude,
          property.longitude,
          property.name,
          address || 'Property Location',
          whatsappConfig
        );
        mediasSent.push('location');
      } catch (error: any) {
        errors.push(`location: ${error.message}`);
        logger.error('Failed to send location', {
          propertyId: property.id,
          error: error.message,
        });
      }
    }

    // Log what was sent (for analytics and debugging)
    logger.info('Property media set sent', {
      conversationId,
      propertyId: property.id,
      propertyName: property.name,
      mediasSent,
      errors: errors.length > 0 ? errors : undefined,
    });

    // Store media sending event in conversation for tracking
    if (mediasSent.length > 0) {
      await prisma.message.create({
        data: {
          conversationId,
          senderType: 'ai', // Use 'ai' instead of 'system'
          content: `📎 Sent media for ${property.name}: ${mediasSent.join(', ')}`,
          status: 'sent',
        },
      });
    }
  }

  /**
   * CHUNK 6: Send property type filter buttons to help qualify leads faster
   * Layer 1 (Visual): WhatsApp interactive buttons appear
   * Layer 2 (Interactive): Buttons trigger filter actions
   * Layer 3 (Operational): Database tracks selections
   * Layer 4 (Resilient): Handles errors, prevents double-clicks
   * Layer 5 (Integrated): AI flow adapts based on selection
   */
  async sendPropertyTypeFilters(
    customerPhone: string,
    whatsappConfig: CompanyWhatsAppConfig,
    context?: {
      leadId?: string;
      conversationId?: string;
      companyId?: string;
    }
  ): Promise<void> {
    try {
      // Check if we've already sent filters recently (prevent spam/double-click)
      if (context?.conversationId) {
        const recentFilterMessage = await prisma.message.findFirst({
          where: {
            conversationId: context.conversationId,
            content: { contains: 'property type are you looking for' },
            createdAt: {
              gte: new Date(Date.now() - 5 * 60 * 1000), // Last 5 minutes
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (recentFilterMessage) {
          logger.info('Filters already sent recently, skipping', {
            conversationId: context.conversationId,
            lastSent: recentFilterMessage.createdAt,
          });
          return; // Prevent duplicate
        }
      }

      // Get available property types from database for this company
      const availableTypes = context?.companyId
        ? await prisma.property.groupBy({
            by: ['propertyType', 'bedrooms'],
            where: {
              companyId: context.companyId,
              status: 'available',
            },
            _count: true,
          })
        : [];

      // Build button list based on what's actually available
      const buttons: Array<{ id: string; title: string }> = [];

      // BHK filters (WhatsApp allows max 3 buttons)
      const bedroomCounts = availableTypes
        .filter(t => t.bedrooms)
        .map(t => t.bedrooms!)
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort((a, b) => a - b)
        .slice(0, 3);

      for (const bhk of bedroomCounts) {
        buttons.push({
          id: `filter-${bhk}bhk`,
          title: `${bhk} BHK`,
        });
      }

      // If less than 3 buttons, add property types
      if (buttons.length < 3) {
        const propertyTypes = ['villa', 'apartment', 'plot'];
        for (const type of propertyTypes) {
          if (buttons.length >= 3) break;
          const hasType = availableTypes.some(t => t.propertyType === type);
          if (hasType) {
            buttons.push({
              id: `filter-${type}`,
              title: type.charAt(0).toUpperCase() + type.slice(1),
            });
          }
        }
      }

      // Fallback if no properties available or can't determine
      if (buttons.length === 0) {
        buttons.push(
          { id: 'filter-2bhk', title: '2 BHK' },
          { id: 'filter-3bhk', title: '3 BHK' },
          { id: 'filter-villa', title: 'Villa' }
        );
      }

      // Send interactive buttons
      await this.sendInteractiveButtons(
        customerPhone,
        'What type of property are you looking for? 🏠',
        buttons.slice(0, 3), // WhatsApp limit
        null,
        null,
        whatsappConfig
      );

      // Log the filter send in conversation (Layer 3: Operational)
      if (context?.conversationId) {
        await prisma.message.create({
          data: {
            conversationId: context.conversationId,
            senderType: 'ai',
            content: 'What type of property are you looking for? 🏠 [Filter buttons sent]',
            status: 'sent',
          },
        });
      }

      logger.info('Property type filters sent', {
        ...context,
        buttonCount: buttons.length,
        buttons: buttons.map(b => b.id),
      });

    } catch (error: any) {
      // Layer 4 (Resilient): Don't crash conversation if filters fail
      logger.error('Failed to send property type filters', {
        error: error.message,
        ...context,
      });

      // Fallback to text question if buttons fail
      try {
        await this.sendMessage(
          customerPhone,
          'What type of property are you looking for? (2BHK, 3BHK, Villa, Apartment, etc.)',
          whatsappConfig
        );
      } catch (fallbackError: any) {
        logger.error('Filter fallback message also failed', {
          error: fallbackError.message,
        });
      }
    }
  }

  /**
   * CHUNK 6: Determine if we should send filter buttons based on conversation state
   * Send filters when:
   * - In 'qualify' stage and haven't captured property type preference yet
   * - User seems uncertain or asking general questions
   * - No filters sent in last 5 minutes (prevent spam)
   */
  private shouldSendPropertyFilters(
    state: ConversationState,
    lead: any,
    action?: NextBestAction
  ): boolean {
    // Don't send if already in later stages
    if (['shortlist', 'commitment', 'visit_booking', 'confirmation', 'closed_won', 'closed_lost'].includes(state.stage)) {
      return false;
    }

    // Don't send if lead already has clear property type preference
    if (lead.propertyType && lead.propertyType !== 'any') {
      return false;
    }

    // Send in qualify stage
    if (state.stage === 'qualify') {
      return true;
    }

    // Send if AI is advancing to qualify stage
    if (action?.action === 'advance_stage' && action.targetStage === 'qualify') {
      return true;
    }

    return false;
  }
}

export const whatsappService = new WhatsAppService();
