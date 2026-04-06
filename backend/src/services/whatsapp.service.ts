import prisma from '../config/prisma';
import config from '../config';
import logger from '../config/logger';
import { aiService } from './ai.service';

interface IncomingMessage {
  phoneNumberId: string;
  customerPhone: string;
  customerName: string;
  messageText: string;
  messageId: string;
}

interface CompanyWhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
}

export class WhatsAppService {
  /**
   * Get company by WhatsApp phone number ID.
   * First checks company.settings.whatsapp.phoneNumberId, then falls back to whatsappPhone field.
   */
  async getCompanyByPhoneNumberId(phoneNumberId: string): Promise<{ company: any; config: CompanyWhatsAppConfig | null } | null> {
    // Find all active companies
    const companies = await prisma.company.findMany({
      where: { status: 'active' },
      select: { id: true, name: true, settings: true, whatsappPhone: true },
    });

    // Check each company's settings.whatsapp.phoneNumberId
    for (const company of companies) {
      const settings = company.settings as any || {};
      if (settings.whatsapp?.phoneNumberId === phoneNumberId) {
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

    // Fallback: Check whatsappPhone field (legacy)
    const legacyCompany = companies.find(c => c.whatsappPhone === phoneNumberId);
    if (legacyCompany) {
      return {
        company: legacyCompany,
        config: {
          phoneNumberId,
          accessToken: config.whatsapp.accessToken,
          verifyToken: config.whatsapp.verifyToken,
        },
      };
    }

    // Fallback: If only one company has WhatsApp configured, use it
    // This handles test webhooks where Meta sends fake phone_number_id
    const companiesWithWhatsApp = companies.filter(c => {
      const settings = c.settings as any || {};
      return settings.whatsapp?.phoneNumberId || settings.whatsapp?.accessToken;
    });

    if (companiesWithWhatsApp.length === 1) {
      const company = companiesWithWhatsApp[0];
      const settings = company.settings as any || {};
      logger.info('Using company with WhatsApp config (fallback)', { 
        companyId: company.id, 
        companyName: company.name,
        requestedPhoneNumberId: phoneNumberId,
      });
      return {
        company,
        config: {
          phoneNumberId: settings.whatsapp?.phoneNumberId || phoneNumberId,
          accessToken: settings.whatsapp?.accessToken || config.whatsapp.accessToken,
          verifyToken: settings.whatsapp?.verifyToken || config.whatsapp.verifyToken,
        },
      };
    }

    // Last resort fallback: Use first active company if env var has access token
    if (companies.length > 0 && config.whatsapp.accessToken) {
      const company = companies[0];
      logger.warn('Using first active company as fallback', { 
        companyId: company.id,
        companyName: company.name,
      });
      return {
        company,
        config: {
          phoneNumberId: config.whatsapp.phoneNumberId || phoneNumberId,
          accessToken: config.whatsapp.accessToken,
          verifyToken: config.whatsapp.verifyToken,
        },
      };
    }

    logger.error('No company found for WhatsApp', { 
      phoneNumberId,
      totalCompanies: companies.length,
      companiesWithWhatsApp: companiesWithWhatsApp.length,
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
  async handleIncomingMessage(msg: IncomingMessage): Promise<void> {
    logger.info('=== WHATSAPP SERVICE: handleIncomingMessage START ===', {
      phoneNumberId: msg.phoneNumberId,
      customerPhone: msg.customerPhone,
    });

    // 1. Find company by WhatsApp phone number ID
    const result = await this.getCompanyByPhoneNumberId(msg.phoneNumberId);

    if (!result) {
      logger.error('=== NO COMPANY FOUND ===', { phoneNumberId: msg.phoneNumberId });
      return;
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
      conversation = await prisma.conversation.create({
        data: {
          companyId,
          leadId: lead.id,
          whatsappPhone: msg.customerPhone,
          status: 'ai_active',
          language: 'en',
          aiEnabled: true,
        },
      });
    }

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

    // 4. If conversation is ai_active, generate AI response
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

        // Generate AI response
        const aiResponse = await aiService.generateResponse({
          customerMessage: msg.messageText,
          conversationHistory: history,
          lead,
          properties,
          aiSettings: aiSettings || {},
          companyName: company.name,
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
  }

  /**
   * Send a message via WhatsApp Cloud API.
   * Uses company-specific config for multi-tenant support.
   */
  async sendMessage(to: string, text: string, whatsappConfig: CompanyWhatsAppConfig): Promise<boolean> {
    const { phoneNumberId, accessToken } = whatsappConfig;

    if (!phoneNumberId || !accessToken) {
      logger.error('WhatsApp config missing phoneNumberId or accessToken');
      return false;
    }

    try {
      const response = await fetch(`${config.whatsapp.apiUrl}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
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
        const error = await response.text();
        logger.error('WhatsApp API error', { status: response.status, error });
        return false;
      }

      const result = await response.json() as { messages?: Array<{ id: string }> };
      logger.info('WhatsApp message sent', { messageId: result.messages?.[0]?.id });
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
    const { phoneNumberId, accessToken } = whatsappConfig;

    if (!phoneNumberId || !accessToken) {
      return { success: false, error: 'Missing phoneNumberId or accessToken' };
    }

    try {
      const response = await fetch(`${config.whatsapp.apiUrl}/${phoneNumberId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `API Error: ${response.status} - ${error}` };
      }

      const data = await response.json();
      return { 
        success: true, 
        error: undefined,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
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
}

export const whatsappService = new WhatsAppService();
