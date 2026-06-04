/**
 * Brochure Tools
 *
 * WhatsApp agent tool for sending a property brochure to a customer.
 * Looks up the property's brochure URL and delivers it via WhatsApp.
 *
 * @module agent/tools/brochure-tools
 */

import { z } from 'zod';
import prisma from '../../../config/prisma';
import { ToolContext } from '../agent-state';
import { buildAgentScopeFilter, maskPhone } from './format-helpers';
import { DynamicStructuredTool, type AgentTool } from './langchain-runtime';

/**
 * Builds the lead scope filter for the calling user.
 *
 * @param context - Caller context containing role and userId.
 * @returns Prisma where-clause fragment scoped to the caller.
 */
function leadScope(context: ToolContext): Record<string, unknown> {
  return buildAgentScopeFilter(context.companyId, context.userRole, context.userId);
}

/**
 * Creates the sendBrochureToClient tool for the WhatsApp agent.
 *
 * @param context - Caller's role and company scope.
 * @returns Array containing the sendBrochureToClient tool.
 */
export function createBrochureTools(context: ToolContext): AgentTool[] {
  return [
    new DynamicStructuredTool({
      name: 'sendBrochureToClient',
      description:
        'Send a property brochure PDF to a customer via WhatsApp. ' +
        'Use when a lead asks for a brochure or when the agent wants to share details.',
      schema: z.object({
        leadId: z.string().uuid().describe('Lead who will receive the brochure'),
        propertyId: z.string().uuid().describe('Property whose brochure to send'),
      }),
      func: async ({ leadId, propertyId }) => {
        const lead = await prisma.lead.findFirst({
          where: { id: leadId, ...leadScope(context) },
          select: { id: true, customerName: true, phone: true },
        });
        if (!lead) return 'Lead not found or access denied.';

        const property = await prisma.property.findFirst({
          where: { id: propertyId, companyId: context.companyId },
          select: { name: true, brochureUrl: true },
        });
        if (!property) return 'Property not found.';
        if (!property.brochureUrl) {
          return `No brochure is uploaded for ${property.name} yet. Upload one in the property settings.`;
        }

        const conversation = await prisma.conversation.findFirst({
          where: { leadId, companyId: context.companyId },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        });
        if (!conversation) {
          return 'No active conversation found for this lead. Cannot send WhatsApp.';
        }

        const intro =
          `Hi ${lead.customerName ?? 'there'}! 👋\n\n` +
          `Here is the brochure for *${property.name}* (PDF attached).\n\n` +
          `Feel free to reply with any questions!`;

        await prisma.message.create({
          data: { conversationId: conversation.id, senderType: 'agent', content: intro },
        });

        const { whatsappService } = await import('../../whatsapp.service');
        const waConfig = await whatsappService.resolveCompanyWhatsAppConfig(context.companyId);
        if (!waConfig) {
          return 'WhatsApp is not configured for this company.';
        }

        const pdfResult = await whatsappService.sendPropertyBrochure(
          lead.phone,
          property.brochureUrl,
          property.name,
          waConfig,
        );
        if (!pdfResult.success) {
          return `Could not send brochure PDF: ${pdfResult.error ?? 'unknown error'}`;
        }

        await whatsappService.sendMessage(lead.phone, intro, waConfig);

        return `Brochure PDF for ${property.name} sent to ${lead.customerName ?? maskPhone(lead.phone)}.`;
      },
    }),
  ];
}
