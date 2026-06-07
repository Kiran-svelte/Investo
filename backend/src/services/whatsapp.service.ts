import prisma from '../config/prisma';
import { Prisma } from '@prisma/client';
import config from '../config';
import logger from '../config/logger';
import { maskPhoneNumberForLogs } from '../utils/maskPhoneNumberForLogs';
import { aiService } from './ai.service';
import { calculateEmi } from './emi.service';
import { buildNeverSayNoContext } from './neverSayNoEngine.service';
import { criteriaFromLead } from './alternativeInventory.service';
import { sanitizeBuyerOutbound } from './whatsapp/whatsappResponseSanitizer.service';
import { buildButtonMessage, buildListMessage } from './whatsapp/metaMessageBuilder.service';
import type { TurnResult, WhatsAppComponent } from '../types/whatsapp-turn.types';
import { incrementOpsMetric } from './opsMetrics.service';
import { simulateHumanReplyPacing } from './whatsappPresence.service';
import { withRetry } from '../utils/retry';
import { buildGroundedFactsBlock } from './groundingGuard.service';
import { propertyToCompletenessInput } from './propertyCompleteness.service';
import { matchCatalogPropertiesForQuery } from './propertyKnowledge.service';
import { normalizeInboundWhatsAppPhone, phonesMatchLast10 } from '../utils/phoneMatch';
import {
  routeCompanyScopedInbound,
} from './inboundWhatsAppRouting.service';
import {
  claimInboundMessageFull,
  claimCustomerInboundFingerprint,
  claimCustomerProcessingTurn,
  releaseCustomerProcessingTurn,
  claimOutboundAiReply,
} from './inboundMessageGuard.service';
import { type QuickReplyRecentAction } from '../utils/contextQuickReplies.util';
import { resolveBuyerComponents } from './buyer/buyerButtonPolicy.service';
import {
  beginOutboundTurn,
  endOutboundTurn,
  logOutboundBranch,
  logOutboundSend,
} from './outboundTurnDebug.service';

import {
  parseVisitTimeInteractiveId,
  resolveVisitSlotToDate,
  scheduleVisitFromWhatsApp,
} from './visitBooking.service';
import { transitionLeadStatus, transitionLeadToVisitScheduled } from './leadTransition.service';
import { socketService, SOCKET_EVENTS } from './socket.service';
import { notifyAgentOfNewLead } from './leadAssignment.service';
import { assignLeadWithRouting } from './leadRouting.service';
import { syncLeadScoreFromConversation } from './leadScoring.service';
import { logAgentAction } from './agent-action-log.service';
import { tryCommitCustomerVisitBooking } from './customerVisitBooking.service';
import {
  isVisitCancelOrRescheduleMessage,
  isVisitSchedulingMessage,
} from './visitIntentFromMessage.service';
import {
  buildBuyerVisitStatusReply,
  isBuyerVisitStatusQuery,
} from './buyerVisitQuery.service';
import { formatCustomerSalutation } from './customerMessageFastPath.service';

import {
  handleWrongReport,
  isWrongReportMessage,
  WRONG_ACK_MESSAGE,
} from './wrongReport.service';
import {
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

/**
 * Safely deserializes the `commitments` JSONB field from Prisma.
 * Never use a bare type cast here — old DB rows may be missing fields
 * added in later migrations (e.g., `visitSlotDiscussed` added after launch).
 * Missing fields are filled with safe boolean `false` defaults.
 *
 * @param raw - Raw Prisma JsonValue from the conversation row
 * @returns A fully populated MicroCommitments object
 */
function safeParseCommitments(raw: unknown): MicroCommitments {
  const defaults = conversationStateManager.createInitialState().commitments;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
  const r = raw as Record<string, unknown>;
  return {
    budgetConfirmed:       typeof r.budgetConfirmed === 'boolean'       ? r.budgetConfirmed       : defaults.budgetConfirmed,
    locationConfirmed:     typeof r.locationConfirmed === 'boolean'     ? r.locationConfirmed     : defaults.locationConfirmed,
    propertyTypeConfirmed: typeof r.propertyTypeConfirmed === 'boolean' ? r.propertyTypeConfirmed : defaults.propertyTypeConfirmed,
    timelineConfirmed:     typeof r.timelineConfirmed === 'boolean'     ? r.timelineConfirmed     : defaults.timelineConfirmed,
    propertyInterestShown: typeof r.propertyInterestShown === 'boolean' ? r.propertyInterestShown : defaults.propertyInterestShown,
    visitSlotDiscussed:    typeof r.visitSlotDiscussed === 'boolean'    ? r.visitSlotDiscussed    : defaults.visitSlotDiscussed,
    visitSlotConfirmed:    typeof r.visitSlotConfirmed === 'boolean'    ? r.visitSlotConfirmed    : defaults.visitSlotConfirmed,
    contactInfoShared:     typeof r.contactInfoShared === 'boolean'     ? r.contactInfoShared     : defaults.contactInfoShared,
  };
}

interface IncomingMessage {
  /** Which inbound webhook delivered this message. Defaults to 'meta' for backward compatibility. */
  provider?: 'meta';
  phoneNumberId: string;
  customerPhone: string;
  customerName: string;
  messageText: string;
  messageId: string;
  /** Optional webhook auth token, retained for older callers. */
  webhookTokenHint?: string;
  /** Optional company id hint from tenant-scoped webhook URL. */
  companyIdHint?: string;
  /** Button/List item ID for interactive responses */
  interactiveId?: string;
  /** Type of interactive response */
  interactiveType?: 'button_reply' | 'list_reply';
  /** Meta display phone on the business line (for tenant disambiguation). */
  businessDisplayPhone?: string;
}

export interface CompanyWhatsAppConfig {
  provider?: 'meta';
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
  private outboundProviders: Partial<Record<'meta', WhatsAppOutboundProvider>> = {};

  private resolveOutboundProviderName(_whatsappConfig?: CompanyWhatsAppConfig | null): 'meta' {
    void _whatsappConfig;
    // Meta Cloud API is the only outbound provider.
    return 'meta';
  }

  private getOutboundProvider(providerName: 'meta'): WhatsAppOutboundProvider {
    const cached = this.outboundProviders[providerName];
    if (cached) {
      return cached;
    }

    const provider = new MetaWhatsAppProvider({ apiUrl: config.whatsapp.apiUrl });

    this.outboundProviders[providerName] = provider;
    return provider;
  }

  /**
   * Get company by WhatsApp phone number ID.
   * Deterministically resolves company routing from company.settings.whatsapp.phoneNumberId.
   */
  async getCompanyByPhoneNumberId(
    phoneNumberId: string,
    providerHint?: 'meta',
    companyIdHint?: string,
    webhookTokenHint?: string,
    customerPhoneHint?: string,
    businessDisplayPhoneHint?: string,
  ): Promise<{ company: any; config: CompanyWhatsAppConfig | null } | null> {
    // Find all active companies
    const companies = await prisma.company.findMany({
      where: { status: 'active' },
      select: { id: true, name: true, settings: true, whatsappPhone: true, updatedAt: true },
    });

    void providerHint;

    const normalizeStringLike = (value: unknown): string => {
      if (typeof value === 'string') {
        return value.trim();
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
      return '';
    };

    const normalizedPhoneNumberId =
      typeof phoneNumberId === 'string' ? phoneNumberId.trim() : String(phoneNumberId ?? '').trim();

    if (!normalizedPhoneNumberId) {
      logger.error('Meta company resolution failed: missing phoneNumberId');
      return null;
    }

    const matches: any[] = [];
    for (const company of companies) {
      const settings = (company.settings as any) || {};
      const whatsapp = (settings.whatsapp as any) || {};
      const meta = (whatsapp.meta as any) || whatsapp;

      const configuredId = normalizeStringLike(meta.phoneNumberId);
      const legacyConfiguredId = normalizeStringLike(meta.phone_number_id);

      if (
        (configuredId && configuredId === normalizedPhoneNumberId) ||
        (legacyConfiguredId && legacyConfiguredId === normalizedPhoneNumberId)
      ) {
        matches.push(company);
      }
    }

    // EXACT MATCH FOUND
    if (matches.length === 1) {
      const company = matches[0];
      const settings = (company.settings as any) || {};
      const whatsapp = (settings.whatsapp as any) || {};
      const meta = (whatsapp.meta as any) || whatsapp;
      const configuredId = normalizeStringLike(meta.phoneNumberId);
      const legacyConfiguredId = normalizeStringLike(meta.phone_number_id);

      return {
        company,
        config: {
          provider: 'meta',
          phoneNumberId: configuredId || legacyConfiguredId || normalizedPhoneNumberId,
          accessToken: normalizeStringLike(meta.accessToken) || config.whatsapp.accessToken,
          verifyToken: normalizeStringLike(meta.verifyToken) || config.whatsapp.verifyToken,
        },
      };
    }

    if (matches.length > 1) {
      const resolvedDuplicate = await this.resolveDuplicateMetaPhoneNumberMatches(
        matches,
        normalizedPhoneNumberId,
        normalizeStringLike,
        customerPhoneHint,
        businessDisplayPhoneHint,
      );
      if (resolvedDuplicate) {
        return resolvedDuplicate;
      }
    }

    // NO EXPLICIT MAPPING FOUND
    // Fallback logic: If WHATSAPP_PHONE_NUMBER_ID is set in env and matches the incoming ID,
    // use the first active company (useful for single-tenant or initial setup).
    const globalPhoneId = normalizeStringLike(config.whatsapp.phoneNumberId);
    const globalAccessToken = normalizeStringLike(config.whatsapp.accessToken);
    if (globalPhoneId && globalPhoneId === normalizedPhoneNumberId && companies.length > 0) {
      const globalTokenMatches = globalAccessToken
        ? companies.filter((company) => {
            const meta = (((company.settings as any) || {}).whatsapp as any) || {};
            const nested = meta.meta || meta;
            return normalizeStringLike(nested.accessToken) === globalAccessToken;
          })
        : [];

      const company = globalTokenMatches.length === 1 ? globalTokenMatches[0] : companies[0];

      logger.info('Meta company resolution: matched via global WHATSAPP_PHONE_NUMBER_ID fallback', {
        companyId: company.id,
        phoneNumberId: normalizedPhoneNumberId,
        usedTokenMatch: globalTokenMatches.length === 1,
      });

      const settings = (company.settings as any) || {};
      const whatsapp = (settings.whatsapp as any) || {};
      const meta = (whatsapp.meta as any) || whatsapp;

      return {
        company,
        config: {
          provider: 'meta',
          phoneNumberId: normalizedPhoneNumberId,
          accessToken: normalizeStringLike(meta.accessToken) || config.whatsapp.accessToken,
          verifyToken: normalizeStringLike(meta.verifyToken) || config.whatsapp.verifyToken,
        },
      };
    }

    // Non-production fallback for single company
    if (config.env !== 'production' && companies.length === 1) {
      const company = companies[0];
      const settings = (company.settings as any) || {};
      const whatsapp = (settings.whatsapp as any) || {};
      const meta = (whatsapp.meta as any) || whatsapp;

      logger.warn('Meta company resolution fallback: single active company (non-production)', {
        companyId: company.id,
        requestedPhoneNumberId: normalizedPhoneNumberId,
      });

      return {
        company,
        config: {
          provider: 'meta',
          phoneNumberId: normalizedPhoneNumberId,
          accessToken: normalizeStringLike(meta.accessToken) || config.whatsapp.accessToken,
          verifyToken: normalizeStringLike(meta.verifyToken) || config.whatsapp.verifyToken,
        },
      };
    }

    logger.error('Meta company resolution failed: phoneNumberId is unmapped', {
      phoneNumberId: normalizedPhoneNumberId,
      globalPhoneId,
      totalCompanies: companies.length,
      env: config.env,
    });
    return null;
  }

  private buildMetaCompanyConfig(
    company: { settings: unknown },
    normalizedPhoneNumberId: string,
    normalizeStringLike: (value: unknown) => string,
  ): { company: typeof company; config: CompanyWhatsAppConfig } {
    const settings = (company.settings as any) || {};
    const whatsapp = (settings.whatsapp as any) || {};
    const meta = (whatsapp.meta as any) || whatsapp;
    const configuredId = normalizeStringLike(meta.phoneNumberId);
    const legacyConfiguredId = normalizeStringLike(meta.phone_number_id);

    return {
      company,
      config: {
        provider: 'meta',
        phoneNumberId: configuredId || legacyConfiguredId || normalizedPhoneNumberId,
        accessToken: normalizeStringLike(meta.accessToken) || config.whatsapp.accessToken,
        verifyToken: normalizeStringLike(meta.verifyToken) || config.whatsapp.verifyToken,
      },
    };
  }

  private async resolveDuplicateMetaPhoneNumberMatches(
    matches: Array<{ id: string; settings: unknown; updatedAt?: Date }>,
    normalizedPhoneNumberId: string,
    normalizeStringLike: (value: unknown) => string,
    customerPhoneHint?: string,
    businessDisplayPhoneHint?: string,
  ): Promise<{ company: any; config: CompanyWhatsAppConfig } | null> {
    if (normalizeStringLike(businessDisplayPhoneHint)) {
      const { companyMatchesDisplayPhone } = await import('./whatsappTenantGuard.service');
      const displayMatches = matches.filter((company) =>
        companyMatchesDisplayPhone(company as { whatsappPhone?: string | null }, businessDisplayPhoneHint),
      );
      if (displayMatches.length === 1) {
        logger.info('Meta company resolution: duplicate phoneNumberId resolved via display phone', {
          phoneNumberId: normalizedPhoneNumberId,
          companyId: displayMatches[0].id,
        });
        return this.buildMetaCompanyConfig(displayMatches[0], normalizedPhoneNumberId, normalizeStringLike);
      }
    }

    if (normalizeStringLike(customerPhoneHint)) {
      const digits = normalizeStringLike(customerPhoneHint).replace(/[^0-9]/g, '');
      const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
      const phoneCandidates = Array.from(
        new Set(
          [
            normalizeStringLike(customerPhoneHint),
            digits,
            last10 ? `+${last10}` : '',
            last10 ? `91${last10}` : '',
            last10 ? `+91${last10}` : '',
          ].filter(Boolean),
        ),
      );

      const leads = await prisma.lead.findMany({
        where: {
          companyId: { in: matches.map((company) => company.id) },
          OR: phoneCandidates.map((candidate) => ({ phone: { contains: candidate } })),
        },
        select: { companyId: true },
        take: 20,
      });

      const uniqueLeadCompanyIds = Array.from(new Set(leads.map((lead) => lead.companyId)));
      if (uniqueLeadCompanyIds.length === 1) {
        const company = matches.find((item) => item.id === uniqueLeadCompanyIds[0]);
        if (company) {
          logger.info('Meta company resolution: duplicate phoneNumberId resolved via existing lead', {
            phoneNumberId: normalizedPhoneNumberId,
            companyId: company.id,
          });
          return this.buildMetaCompanyConfig(company, normalizedPhoneNumberId, normalizeStringLike);
        }
      }
    }

    const globalAccessToken = normalizeStringLike(config.whatsapp.accessToken);
    if (globalAccessToken) {
      const tokenMatches = matches.filter((company) => {
        const meta = (((company.settings as any) || {}).whatsapp as any) || {};
        const nested = meta.meta || meta;
        return normalizeStringLike(nested.accessToken) === globalAccessToken;
      });
      if (tokenMatches.length === 1) {
        logger.info('Meta company resolution: duplicate phoneNumberId resolved via global access token', {
          phoneNumberId: normalizedPhoneNumberId,
          companyId: tokenMatches[0].id,
        });
        return this.buildMetaCompanyConfig(tokenMatches[0], normalizedPhoneNumberId, normalizeStringLike);
      }
    }

    const fallbackCompany = matches
      .slice()
      .sort((a, b) => {
        const aWa = ((a.settings as any) || {}).whatsapp || {};
        const bWa = ((b.settings as any) || {}).whatsapp || {};
        const aVerified = aWa.verifiedAt ? new Date(aWa.verifiedAt).getTime() : 0;
        const bVerified = bWa.verifiedAt ? new Date(bWa.verifiedAt).getTime() : 0;
        if (bVerified !== aVerified) return bVerified - aVerified;
        return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      })[0];

    logger.warn('Meta company resolution: duplicate phoneNumberId — selected most recently verified tenant', {
      phoneNumberId: normalizedPhoneNumberId,
      selectedCompanyId: fallbackCompany.id,
      matchingCompanyIds: matches.map((company) => company.id),
    });

    return this.buildMetaCompanyConfig(fallbackCompany, normalizedPhoneNumberId, normalizeStringLike);
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
    incrementOpsMetric('webhook_inbound');

    const inboundProvider: 'meta' = 'meta';

    logger.info('=== WHATSAPP SERVICE: handleIncomingMessage START ===', {
      provider: inboundProvider,
      phoneNumberId: msg.phoneNumberId,
      customerPhone: maskPhoneNumberForLogs(msg.customerPhone),
    });

    // 1. Find company by WhatsApp phone number ID
    const result = await this.getCompanyByPhoneNumberId(
      msg.phoneNumberId,
      inboundProvider,
      msg.companyIdHint,
      msg.webhookTokenHint,
      msg.customerPhone,
      msg.businessDisplayPhone,
    );

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
    const customerPhone = normalizeInboundWhatsAppPhone(msg.customerPhone);

    if (msg.messageId) {
      const inboundClaimed = await claimInboundMessageFull(
        companyId,
        msg.messageId,
        customerPhone,
      );
      if (!inboundClaimed) {
        logger.info('Skipping duplicate inbound WhatsApp message', {
          whatsappMessageId: msg.messageId,
          companyId,
        });
        return {
          status: 'skipped',
          reason: 'duplicate_message_id',
          companyId,
          propagation: notAttempted,
        };
      }
    }

    if (
      msg.interactiveId &&
      (msg.interactiveId.startsWith('visit-approve-') || msg.interactiveId.startsWith('visit-decline-'))
    ) {
      const { findCompanyUserByPhone } = await import('./inboundWhatsAppRouting.service');
      const { tryHandleVisitApprovalInteractive } = await import('./visitPendingApproval.service');
      const companyUser = await findCompanyUserByPhone(customerPhone, companyId);
      if (companyUser) {
        const handled = await tryHandleVisitApprovalInteractive(msg.interactiveId, {
          userId: companyUser.userId,
          companyId: companyUser.companyId,
          phone: companyUser.phone,
        });
        if (handled) {
          void logAgentAction({
            companyId,
            triggeredBy: 'inbound_message',
            action: 'visitApprovalInteractive',
            actorId: companyUser.userId,
            resourceType: 'visit',
            status: 'success',
            inputs: { interactiveId: msg.interactiveId },
          });
          return {
            status: 'processed',
            reason: 'visit_approval_handled',
            companyId,
            propagation: notAttempted,
          };
        }
      }
    }

    // Company staff (dashboard users) → agent copilot or staff notice — never the prospect AI flow.
    const staffRoute = await routeCompanyScopedInbound({
      senderPhone: customerPhone,
      messageText: msg.messageText,
      companyId,
      interactiveId: msg.interactiveId,
      inboundMessageId: msg.messageId,
    });
    if (staffRoute.handled) {
      logOutboundBranch('H2', 'whatsapp.service.ts:staffRoute', 'staff_route_handled', {
        routeKind: staffRoute.route.kind,
        companyId,
      });
      logger.info('Inbound handled as company user (not prospect AI)', {
        route: staffRoute.route.kind,
        companyId,
      });
      return {
        status: 'processed',
        reason:
          staffRoute.route.kind === 'agent_copilot'
            ? 'handled_by_agent_copilot'
            : 'handled_as_company_staff',
        companyId,
        propagation: notAttempted,
      };
    }

    const fingerprintClaimed = await claimCustomerInboundFingerprint(
      companyId,
      customerPhone,
      msg.messageText,
    );
    if (!fingerprintClaimed) {
      return {
        status: 'skipped',
        reason: 'duplicate_customer_fingerprint',
        companyId,
        propagation: notAttempted,
      };
    }

    const customerTurnClaimed = await claimCustomerProcessingTurn(companyId, customerPhone);
    if (!customerTurnClaimed) {
      logOutboundBranch('H2', 'whatsapp.service.ts:concurrent', 'concurrent_customer_blocked', {
        companyId,
      });
      return {
        status: 'skipped',
        reason: 'concurrent_customer_processing',
        companyId,
        propagation: notAttempted,
      };
    }

    beginOutboundTurn({
      channel: 'buyer',
      inboundMessageId: msg.messageId,
      companyId,
      route: 'buyer_inbound',
    });

    try {
    // 2. Find or create lead + conversation for prospects (phones not on any active user profile)
    let lead =
      (await prisma.lead.findFirst({
        where: { companyId, phone: customerPhone },
      })) ?? null;

    if (!lead) {
      // P0-2: Efficient DB-level phone matching instead of O(n) in-process scan.
      // Extracts last 10 digits for flexible phone format matching (e.g. +91XXXXXXXXXX vs XXXXXXXXXX).
      const last10Digits = customerPhone.replace(/\D/g, '').slice(-10);
      if (last10Digits) {
        const matched = await prisma.lead.findFirst({
          where: {
            companyId,
            phone: { endsWith: last10Digits },
          },
          orderBy: { updatedAt: 'desc' },
        });
        if (matched) {
          lead = matched;
          if (lead.phone !== customerPhone) {
            await prisma.lead.update({ where: { id: lead.id }, data: { phone: customerPhone } });
            lead = { ...lead, phone: customerPhone };
          }
        }
      }
    }

    if (!lead) {
      // Auto-create lead
      const sourceDetail = msg.interactiveId
        ? `wa_interactive:${msg.interactiveId}`
        : 'whatsapp_inbound';
      const agentId = await assignLeadWithRouting(companyId, {
        locationPreference: null,
        metadata: { source_detail: sourceDetail },
      });

      try {
        // P0-2: Use upsert with unique(companyId, phone) to handle concurrent webhook retries.
        // If two simultaneous webhooks from the same new phone both reach here, the second
        // upsert is a no-op (the unique constraint ensures only one lead is created).
        lead = await prisma.lead.upsert({
          where: {
            companyId_phone: { companyId, phone: customerPhone },
          },
          create: {
            companyId,
            customerName: msg.customerName || null,
            phone: customerPhone,
            source: 'whatsapp',
            status: 'new',
            assignedAgentId: agentId,
            language: 'en',
            metadata: { source_detail: sourceDetail },
          },
          update: {
            // On conflict: update last contact time only — don't overwrite agent assignment
            lastContactAt: new Date(),
          },
        });
      } catch (upsertErr: unknown) {
        // If upsert fails (shouldn't happen with unique constraint), fetch the existing lead
        logger.error('Lead upsert failed, fetching existing lead', {
          error: upsertErr instanceof Error ? upsertErr.message : String(upsertErr),
          customerPhone: maskPhoneNumberForLogs(customerPhone),
          companyId,
        });
        const existingLead = await prisma.lead.findFirst({
          where: { companyId, phone: customerPhone },
        });
        if (!existingLead) throw upsertErr;
        lead = existingLead;
      }

      // Notify company admin about new lead
      await prisma.notification.create({
        data: {
          companyId,
          type: 'lead_new',
          title: 'New WhatsApp Lead',
          message: `New lead from ${msg.customerName || msg.customerPhone}`,
        },
      });

      if (lead.assignedAgentId) {
        void notifyAgentOfNewLead(lead.assignedAgentId, lead.id, companyId);
      }

      logger.info('Auto-created lead from WhatsApp', { leadId: lead.id, companyId });

      void logAgentAction({
        companyId,
        triggeredBy: 'inbound_message',
        action: 'autoCreateLeadFromWhatsApp',
        resourceType: 'lead',
        resourceId: lead.id,
        status: 'success',
        inputs: { sourceDetail, customerPhone: maskPhoneNumberForLogs(customerPhone) },
      });

      socketService.emitToCompany(companyId, SOCKET_EVENTS.LEAD_CREATED, {
        lead: {
          id: lead.id,
          customer_name: lead.customerName,
          phone: lead.phone,
          status: lead.status,
          source: lead.source,
          assigned_agent_id: lead.assignedAgentId,
          created_at: lead.createdAt?.toISOString?.() || new Date().toISOString(),
        },
      });

      if (lead.assignedAgentId) {
        const { notificationEngine } = await import('./notification.engine');
        await notificationEngine.onLeadAssigned(lead, lead.assignedAgentId);
      }
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
          whatsappPhone: customerPhone,
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

    // Reconstruct conversation state from DB.
    // IMPORTANT: Prisma returns JSONB as `JsonValue`. Never use `as unknown as Type` here —
    // that performs zero runtime validation. Old DB rows may be missing fields added in later
    // migrations (e.g., visitSlotDiscussed). safeParseCommitments fills in safe defaults.
    const conversationState: ConversationState = {
      stage: (conversation.stage as ConversationStage) || 'rapport',
      previousStage: null,
      stageEnteredAt: conversation.stageEnteredAt || new Date(),
      messageCount: conversation.stageMessageCount || 0,
      commitments: safeParseCommitments(conversation.commitments),
      objectionCount: conversation.objectionCount || 0,
      lastObjectionType: (conversation.lastObjectionType as import('./conversationStateMachine').ObjectionType | null) || null,
      consecutiveObjections: conversation.consecutiveObjections || 0,
      urgencyScore: conversation.urgencyScore || 5,
      valueScore: conversation.valueScore || 5,
      escalationReason: conversation.escalationReason || null,
      recommendedProperties: (conversation.recommendedPropertyIds as unknown as string[]) || [],
      selectedPropertyId: conversation.selectedPropertyId || null,
      proposedVisitTime: conversation.proposedVisitTime || null,
    };

    // 3. Webhook deduplication: Meta's WhatsApp Cloud API guarantees at-least-once delivery
    // and retries webhooks that don't receive a fast 200. Without this guard, the same
    // messageId can be processed 2–3 times concurrently, each sending a separate AI reply.
    // P0-1: Rely on the @@unique([whatsappMessageId]) DB constraint instead of findFirst+create
    // (which has a TOCTOU race). We attempt the insert and catch the P2002 conflict error.
    if (msg.messageId) {
      const existingMessage = await prisma.message.findFirst({
        where: { whatsappMessageId: msg.messageId },
        select: { id: true },
      });
      if (existingMessage) {
        logger.info('Skipping duplicate webhook message', {
          whatsappMessageId: msg.messageId,
          existingMessageId: existingMessage.id,
        });
        return {
          status: 'skipped',
          companyId,
          leadId: lead.id,
          conversationId: conversation?.id,
          propagation: null,
        };
      }
    }

    // Store incoming message — P0-1: If the @@unique constraint fires (concurrent retry),
    // catch P2002 and skip processing rather than sending a duplicate AI response.
    try {
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: 'customer',
          content: msg.messageText,
          whatsappMessageId: msg.messageId,
          status: 'delivered',
        },
      });
    } catch (createErr: unknown) {
      const isPrismaUniqueViolation =
        createErr instanceof Error &&
        'code' in createErr &&
        (createErr as NodeJS.ErrnoException & { code?: string }).code === 'P2002';
      if (isPrismaUniqueViolation && msg.messageId) {
        logger.info('Duplicate whatsappMessageId blocked by unique constraint — skipping', {
          whatsappMessageId: msg.messageId,
          conversationId: conversation.id,
        });
        return {
          status: 'skipped',
          companyId,
          leadId: lead.id,
          conversationId: conversation.id,
          propagation: null,
        };
      }
      throw createErr;
    }

    // Update last contact
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastContactAt: new Date() },
    });

    void import('./clientMemory.service').then(({ syncLeadClientMemory }) =>
      syncLeadClientMemory(lead.id),
    );

    if (isWrongReportMessage(msg.messageText)) {
      await handleWrongReport({
        companyId,
        leadId: lead.id,
        conversationId: conversation.id,
        customerPhone,
        messageText: msg.messageText,
      });
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: 'ai',
          content: WRONG_ACK_MESSAGE,
          status: 'sent',
        },
      });
      if (await claimOutboundAiReply(companyId, msg.messageId)) {
        await this.sendMessage(customerPhone, WRONG_ACK_MESSAGE, whatsappConfig!);
      }
      void logAgentAction({
        companyId,
        triggeredBy: 'inbound_message',
        action: 'wrongReportHandled',
        resourceType: 'conversation',
        resourceId: conversation.id,
        status: 'success',
      });
      return {
        status: 'processed',
        companyId,
        leadId: lead.id,
        conversationId: conversation.id,
        propagation: await this.propagateConversationUpdate({
          companyId,
          conversationId: conversation.id,
          leadId: lead.id,
          trigger: 'wrong_report',
        }),
      };
    }

    let propagation = await this.propagateConversationUpdate({
      companyId,
      conversationId: conversation.id,
      leadId: lead.id,
      trigger: 'customer_message',
    });

    // 3.5. Handle interactive button/list responses
    if (msg.interactiveId && conversation.status === 'ai_active' && conversation.aiEnabled) {
      const actionResult = await this.handleInteractiveAction({
        interactiveId: msg.interactiveId,
        interactiveType: msg.interactiveType,
        lead,
        conversation,
        company,
        whatsappConfig: whatsappConfig!,
        customerPhone,
      });

      // If action was fully handled, don't proceed to AI response
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
              ...(actionResult.newState.recommendedPropertyIds && {
                recommendedPropertyIds: actionResult.newState.recommendedPropertyIds as any,
              }),
            },
          });
        }

        // Update lead status if action provided new status (state machine)
        if (actionResult.leadStatus === 'visit_scheduled') {
          await transitionLeadToVisitScheduled(lead.id);
        } else if (actionResult.leadStatus) {
          await transitionLeadStatus(lead.id, actionResult.leadStatus as any);
        }

        // Unified TurnResult dispatch (interactive orchestrator + sendTurnResult)
        if (actionResult.turnResult) {
          const outboundText = actionResult.turnResult.text?.trim();
          if (outboundText) {
            await prisma.message.create({
              data: {
                conversationId: conversation.id,
                senderType: 'ai',
                content: outboundText,
                status: 'sent',
              },
            });
          }
          if (await claimOutboundAiReply(companyId, msg.messageId)) {
            await this.sendTurnResult(customerPhone, actionResult.turnResult, whatsappConfig!);
            incrementOpsMetric('whatsapp_outbound');
          }
        }

        propagation = await this.propagateConversationUpdate({
          companyId,
          conversationId: conversation.id,
          leadId: lead.id,
          trigger: 'interactive_action',
        });

        void logAgentAction({
          companyId,
          triggeredBy: 'inbound_message',
          action: 'interactiveActionHandled',
          resourceType: 'conversation',
          resourceId: conversation.id,
          status: 'success',
          inputs: {
            interactiveId: msg.interactiveId,
            action: actionResult.action,
            leadStatus: actionResult.leadStatus,
          },
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

    // 4. Any non-staff WhatsApp sender is a prospect — resume AI only when not in human takeover
    const aiReady = await this.ensureProspectConversationAiActive(conversation);
    conversation = { ...conversation, status: aiReady.status as typeof conversation.status, aiEnabled: aiReady.aiEnabled };

    // CRITICAL: If the stage was 'human_escalated' and we just reset it to 'rapport' in the DB,
    // we must also reset the in-memory conversationState — it was built before the DB update.
    // Without this, the AI still sees stage='human_escalated' this turn and generates
    // "A human specialist will assist you" again, which is the bug we are fixing.
    if (
      conversation.status === 'ai_active'
      && conversation.aiEnabled
      && conversationState.stage === 'human_escalated'
    ) {
      const resetState = conversationStateManager.createInitialState();
      // Preserve any commitments already collected — don't wipe their budget/location data.
      Object.assign(conversationState, {
        stage: 'rapport' as ConversationStage,
        previousStage: 'human_escalated' as ConversationStage,
        stageEnteredAt: new Date(),
        messageCount: 0,
        consecutiveObjections: 0,
        escalationReason: null,
        commitments: resetState.commitments,
      });
      logger.info('In-memory conversationState reset from human_escalated to rapport', {
        conversationId: conversation.id,
      });
    }

    const history = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      take: 30,
    });
    const hasPriorOutbound = history.some(
      (m) => m.senderType === 'ai' || m.senderType === 'agent',
    );

    let preFetchedActiveVisitName: string | null = null;
    try {
      const { getLiveLeadContext: _qlc } = await import('./liveLeadContext.service');
      const quickCtx = await _qlc(lead.id, companyId);
      preFetchedActiveVisitName = quickCtx.activeVisit?.propertyName ?? null;
    } catch {
      // non-fatal
    }

    const { orchestrateWhatsAppBuyerTurn } = await import('./whatsapp/whatsappTurnOrchestrator.service');
    const turnResult = await orchestrateWhatsAppBuyerTurn(
      {
        input: {
          companyId,
          customerPhone,
          messageId: msg.messageId,
          messageText: msg.messageText,
          interactiveId: msg.interactiveId,
          interactiveType: msg.interactiveType,
          companyName: company.name,
          leadId: lead.id,
          leadStatus: lead.status,
          leadAssignedAgentId: lead.assignedAgentId,
          leadCustomerName: lead.customerName,
          leadLanguage: lead.language,
          conversationId: conversation.id,
          conversationSelectedPropertyId: conversation.selectedPropertyId,
          conversationProposedVisitTime: conversation.proposedVisitTime,
          conversationRecommendedPropertyIds: (conversation.recommendedPropertyIds ?? []) as string[],
          conversationStage: conversationState.stage,
          humanTakeover: conversation.status !== 'ai_active' || !conversation.aiEnabled,
          history,
          hasPriorOutbound,
        },
        companyId,
        customerPhone,
        messageId: msg.messageId,
        companyName: company.name,
        whatsappConfig: whatsappConfig!,
        history,
      },
      conversationState,
    ).catch(async (err: unknown) => {
      // #region agent log
      fetch('http://127.0.0.1:7737/ingest/e570e274-2b9f-4460-95d9-ffd83c68631e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'44596a'},body:JSON.stringify({sessionId:'44596a',location:'whatsapp.service.ts:orchestratorCatch',message:'orchestrator_threw',data:{error:err instanceof Error ? err.message : String(err),messagePreview:msg.messageText.slice(0,40),conversationId:conversation.id},timestamp:Date.now(),hypothesisId:'A',runId:'post-fix'})}).catch(()=>{});
      // #endregion
      logOutboundBranch('H9', 'whatsapp.service.ts:orchestratorCatch', 'buyer_ai_catch_fallback', {
        error: err instanceof Error ? err.message : String(err),
      });
      logger.error('Buyer turn orchestrator failed', {
        error: err instanceof Error ? err.message : String(err),
        conversationId: conversation.id,
        stage: conversationState.stage,
      });
      let fallbackText: string;
      if (isBuyerVisitStatusQuery(msg.messageText)) {
        const { buildBuyerVisitStatusReply: bvsr } = await import('./buyerVisitQuery.service');
        fallbackText = await bvsr({ leadId: lead.id, companyId, companyName: company.name });
      } else {
        fallbackText = buildAiFallbackMessage({
          customerName: lead.customerName,
          activeVisitPropertyName: preFetchedActiveVisitName,
          isVisitQuery:
            isVisitCancelOrRescheduleMessage(msg.messageText) ||
            isBuyerVisitStatusQuery(msg.messageText) ||
            /\b(visit|booking|booked|scheduled|appointment)\b/i.test(msg.messageText),
        });
      }
      try {
        await prisma.message.create({
          data: { conversationId: conversation.id, senderType: 'ai', content: fallbackText, status: 'sent' },
        });
        if (await claimOutboundAiReply(companyId, msg.messageId)) {
          await this.sendMessage(customerPhone, fallbackText, whatsappConfig!);
        }
      } catch (sendErr: unknown) {
        logger.error('Failed to send AI fallback WhatsApp message', {
          error: sendErr instanceof Error ? sendErr.message : String(sendErr),
        });
      }
      return { audience: 'buyer' as const, handled: true, terminal: true, text: fallbackText };
    });

    if (turnResult.text?.trim()) {
      if (await claimOutboundAiReply(companyId, msg.messageId)) {
        await simulateHumanReplyPacing({
          to: customerPhone,
          whatsappConfig: whatsappConfig!,
          outboundTextLength: turnResult.text.length,
          inboundMessageId: msg.messageId,
        });
        await this.sendTurnResult(customerPhone, turnResult, whatsappConfig!);
        incrementOpsMetric('whatsapp_outbound');
      }
    }

    return {
      status: 'processed',
      companyId,
      leadId: lead.id,
      conversationId: conversation.id,
      propagation,
    };
    } finally {
      endOutboundTurn('buyer_finally');
      await releaseCustomerProcessingTurn(companyId, customerPhone);
    }
  }

  /**
   * Prospects (any phone not registered as company staff) must get AI replies when AI is on.
   * Human takeover (agent_active / aiEnabled false) persists until an agent releases the conversation.
   */
  private async ensureProspectConversationAiActive(conversation: {
    id: string;
    status: string;
    aiEnabled: boolean;
    stage?: string | null;
  }): Promise<{ status: string; aiEnabled: boolean }> {
    if (conversation.status === 'agent_active' || !conversation.aiEnabled) {
      return { status: conversation.status, aiEnabled: conversation.aiEnabled };
    }

    const isAlreadyActive = conversation.status === 'ai_active' && conversation.aiEnabled;
    const isStuckEscalated = conversation.stage === 'human_escalated';

    if (isAlreadyActive && !isStuckEscalated) {
      return { status: conversation.status, aiEnabled: conversation.aiEnabled };
    }

    logger.info('Reactivating AI for inbound prospect WhatsApp message', {
      conversationId: conversation.id,
      previousStatus: conversation.status,
      previousAiEnabled: conversation.aiEnabled,
      previousStage: conversation.stage,
      stageReset: isStuckEscalated,
    });

    const updateData: Prisma.ConversationUpdateInput = {
      status: 'ai_active',
      aiEnabled: true,
    };

    // Reset stage when stuck in human_escalated so conversation resumes naturally.
    // The customer is re-engaging — do not force them through another escalation message.
    if (isStuckEscalated) {
      updateData.stage = 'rapport';
      updateData.stageEnteredAt = new Date();
      updateData.stageMessageCount = 0;
      updateData.escalationReason = null;
    }

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: updateData,
      select: { status: true, aiEnabled: true },
    });

    return { status: updated.status, aiEnabled: updated.aiEnabled };
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

  async resolveCompanyWhatsAppConfig(companyId: string): Promise<CompanyWhatsAppConfig | null> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });
    if (!company) return null;

    const normalizeStringLike = (value: unknown): string => {
      if (typeof value === 'string') return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      return '';
    };

    const settings = (company.settings as any) || {};
    const whatsapp = (settings.whatsapp as any) || {};
    const meta = (whatsapp.meta as any) || {};

    return {
      provider: 'meta',
      phoneNumberId:
        normalizeStringLike(meta.phoneNumberId) ||
        normalizeStringLike(whatsapp.phoneNumberId) ||
        config.whatsapp.phoneNumberId,
      accessToken:
        normalizeStringLike(meta.accessToken) ||
        normalizeStringLike(whatsapp.accessToken) ||
        config.whatsapp.accessToken,
      verifyToken:
        normalizeStringLike(meta.verifyToken) ||
        normalizeStringLike(whatsapp.verifyToken) ||
        config.whatsapp.verifyToken,
    };
  }

  async sendCompanyTextMessage(to: string, text: string, companyId: string): Promise<boolean> {
    const whatsappConfig = await this.resolveCompanyWhatsAppConfig(companyId);
    if (!whatsappConfig) return false;
    return this.sendMessage(to, text, whatsappConfig);
  }

  async sendCompanyInteractiveButtons(
    to: string,
    companyId: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
    headerText?: string,
    footerText?: string,
  ): Promise<boolean> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { settings: true },
    });

    const normalizeStringLike = (value: unknown): string => {
      if (typeof value === 'string') return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      return '';
    };

    const settings = (company?.settings as any) || {};
    const whatsapp = (settings.whatsapp as any) || {};
    const meta = (whatsapp.meta as any) || {};

    const whatsappConfig: CompanyWhatsAppConfig = {
      provider: 'meta',
      phoneNumberId:
        normalizeStringLike(meta.phoneNumberId) ||
        normalizeStringLike(whatsapp.phoneNumberId) ||
        config.whatsapp.phoneNumberId,
      accessToken:
        normalizeStringLike(meta.accessToken) ||
        normalizeStringLike(whatsapp.accessToken) ||
        config.whatsapp.accessToken,
      verifyToken:
        normalizeStringLike(meta.verifyToken) ||
        normalizeStringLike(whatsapp.verifyToken) ||
        config.whatsapp.verifyToken,
    };

    const result = await this.sendInteractiveButtons(
      to,
      bodyText,
      buttons,
      headerText ?? null,
      footerText ?? null,
      whatsappConfig,
    );
    return result.success;
  }

  /**
   * Send a message via WhatsApp Cloud API.
   * Uses company-specific config for multi-tenant support.
   */
  async sendMessage(to: string, text: string, whatsappConfig: CompanyWhatsAppConfig): Promise<boolean> {
    if (!text.trim()) {
      logger.error('Refusing to send empty WhatsApp message');
      return false;
    }

    logOutboundSend('H1', 'whatsapp.service.ts:sendMessage', 'sendMessage', text, {
      provider: this.resolveOutboundProviderName(whatsappConfig),
      hasButtons: /Reply with the number/i.test(text),
    });

    const providerName = this.resolveOutboundProviderName(whatsappConfig);
    const { phoneNumberId, accessToken } = whatsappConfig;

    if (!phoneNumberId || !accessToken) {
      logger.error('WhatsApp Meta config missing phoneNumberId or accessToken');
      return false;
    }

    try {
      const result = await this.getOutboundProvider(providerName).sendTextMessage(to, text, {
        ...whatsappConfig,
        provider: providerName,
      });

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
    return this.getOutboundProvider('meta').testConnection({
      ...whatsappConfig,
      provider: 'meta',
    });
  }

  /**
   * Round-robin agent assignment (least-loaded).
   */
  private async assignRoundRobin(companyId: string): Promise<string | null> {
    return assignLeadWithRouting(companyId, null);
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
        payload.image.caption = caption.substring(0, 1024);
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
      const payload = buildButtonMessage(bodyText, buttons, to, headerText, footerText);

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
      const payload = buildListMessage(bodyText, buttonText, sections, to, headerText, footerText);

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

  // ═══════════════════════════════════════════════════════════════════════════
  // NEW RICH MESSAGE TYPES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Send property catalog cards — image + details + CTA buttons per property.
   * Simulates WhatsApp Catalog behavior. Sends up to 3 property cards.
   * Sends Meta-native property cards.
   *
   * @param to - Recipient phone number
   * @param products - Property products to display (max 3)
   * @param whatsappConfig - Company WhatsApp credentials
   * @returns Count of successfully sent cards
   */
  async sendCatalogMessage(
    to: string,
    products: Array<{
      id: string;
      name: string;
      description: string;
      price: string;
      imageUrl?: string;
    }>,
    whatsappConfig: CompanyWhatsAppConfig,
  ): Promise<{ success: boolean; sent: number }> {
    let sent = 0;
    for (const product of products.slice(0, 3)) {
      if (product.imageUrl) {
        const caption = `🏠 *${product.name}*\n${product.description.slice(0, 200)}\n💰 ${product.price}`;
        const imgResult = await this.sendImage(to, product.imageUrl, caption, whatsappConfig);
        if (imgResult.success) {
          sent++;
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }
      }
      await this.sendInteractiveButtons(
        to,
        `🏠 *${product.name}*\n${product.description.slice(0, 200)}\n💰 ${product.price}`,
        [
          { id: `book-visit-${product.id}`, title: 'Book Visit' },
          { id: `more-info-${product.id}`, title: 'More Info' },
          { id: `location-${product.id}`, title: 'Location' },
        ],
        product.name,
        'Tap to explore',
        whatsappConfig,
      );
      sent++;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return { success: sent > 0, sent };
  }

  /**
   * Share an agent contact card via WhatsApp.
   * Uses the Meta Contacts API.
   *
   * @param to - Recipient phone number
   * @param contact - Agent contact details
   * @param whatsappConfig - Company WhatsApp credentials
   * @returns Send result with optional messageId
   */
  async sendContactCard(
    to: string,
    contact: { name: string; phone: string; company?: string; role?: string },
    whatsappConfig: CompanyWhatsAppConfig,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const { phoneNumberId, accessToken } = whatsappConfig;
    if (!phoneNumberId || !accessToken) {
      return { success: false, error: 'Missing WhatsApp configuration' };
    }
    try {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'contacts',
        contacts: [{
          name: {
            formatted_name: contact.name,
            first_name: contact.name.split(' ')[0] ?? contact.name,
            last_name: contact.name.split(' ').slice(1).join(' ') || '',
          },
          phones: [{ phone: contact.phone, type: 'CELL' }],
          ...(contact.company ? { org: { company: contact.company, title: contact.role || '' } } : {}),
        }],
      };
      const response = await fetch(`${config.whatsapp.apiUrl}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errText = await response.text();
        logger.error('WhatsApp sendContactCard error', { status: response.status, error: errText });
        return { success: false, error: `API Error: ${response.status}` };
      }
      const result = await response.json() as { messages?: Array<{ id: string }> };
      const messageId = result.messages?.[0]?.id;
      logger.info('WhatsApp contact card sent', { messageId, to });
      return { success: true, messageId };
    } catch (err: any) {
      logger.error('Failed to send WhatsApp contact card', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * React to a WhatsApp message with an emoji.
   * Supported on Meta Cloud API.
   *
   * @param to - Recipient phone number
   * @param reactionMessageId - WhatsApp message ID to react to (wamid.xxx)
   * @param emoji - Emoji character (e.g. "❤️", "👍")
   * @param whatsappConfig - Company WhatsApp credentials
   * @returns Success flag
   */
  async sendReaction(
    to: string,
    reactionMessageId: string,
    emoji: string,
    whatsappConfig: CompanyWhatsAppConfig,
  ): Promise<{ success: boolean; error?: string }> {
    const { phoneNumberId, accessToken } = whatsappConfig;
    if (!phoneNumberId || !accessToken) {
      return { success: false, error: 'Missing WhatsApp configuration' };
    }
    if (!reactionMessageId) return { success: false, error: 'Missing message ID to react to' };
    try {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'reaction',
        reaction: { message_id: reactionMessageId, emoji },
      };
      const response = await fetch(`${config.whatsapp.apiUrl}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errText = await response.text();
        logger.error('WhatsApp sendReaction error', { status: response.status, error: errText });
        return { success: false, error: `API Error: ${response.status}` };
      }
      logger.info('WhatsApp reaction sent', { to, emoji });
      return { success: true };
    } catch (err: any) {
      logger.error('Failed to send WhatsApp reaction', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Send at most one interactive component from a TurnResult-style component list.
   */
  async sendTurnComponents(
    to: string,
    components: WhatsAppComponent[],
    whatsappConfig: CompanyWhatsAppConfig,
    bodyFallback?: string,
  ): Promise<void> {
    const interactive = components.find((c) => c.kind === 'buttons' || c.kind === 'list');
    if (!interactive) return;

    if (interactive.kind === 'buttons') {
      await this.sendInteractiveButtons(
        to,
        bodyFallback ?? 'Tap an option below:',
        interactive.buttons,
        null,
        null,
        whatsappConfig,
      ).catch(() => undefined);
      return;
    }

    await this.sendInteractiveList(
      to,
      bodyFallback ?? 'Choose an option:',
      interactive.title,
      interactive.sections,
      null,
      null,
      whatsappConfig,
    ).catch(() => undefined);
  }

  /**
   * Send the primary user-visible payload for a turn.
   *
   * If a button/list component exists, the text becomes the interactive body so
   * WhatsApp shows one message with actions instead of a text bubble plus a
   * duplicate button bubble. If the interactive send fails, fall back to text.
   */
  private async sendPrimaryTurnPayload(
    to: string,
    text: string,
    components: WhatsAppComponent[] | undefined,
    whatsappConfig: CompanyWhatsAppConfig,
  ): Promise<boolean> {
    const body = text.trim();
    if (!body) return false;

    const interactive = components?.find((c) => c.kind === 'buttons' || c.kind === 'list');

    if (interactive?.kind === 'buttons' && interactive.buttons.length) {
      logOutboundBranch('H4', 'whatsapp.service.ts:primaryPayload', 'primary_interactive_buttons', {
        buttonCount: interactive.buttons.length,
      });
      const result = await this.sendInteractiveButtons(
        to,
        body,
        interactive.buttons,
        null,
        null,
        whatsappConfig,
      );
      if (result.success) return true;

      logger.warn('Primary interactive button send failed; falling back to text', {
        to: maskPhoneNumberForLogs(to),
        error: result.error,
      });
    }

    if (interactive?.kind === 'list' && interactive.sections.length) {
      logOutboundBranch('H4', 'whatsapp.service.ts:primaryPayload', 'primary_interactive_list', {
        sectionCount: interactive.sections.length,
      });
      const result = await this.sendInteractiveList(
        to,
        body,
        interactive.title,
        interactive.sections,
        null,
        null,
        whatsappConfig,
      );
      if (result.success) return true;

      logger.warn('Primary interactive list send failed; falling back to text', {
        to: maskPhoneNumberForLogs(to),
        error: result.error,
      });
    }

    logOutboundSend('H4', 'whatsapp.service.ts:primaryPayload', 'primary_text', body);
    return this.sendMessage(to, body, whatsappConfig);
  }

  /**
   * Send a complete buyer/staff turn: one primary payload, then optional media.
   */
  async sendTurnResult(
    to: string,
    result: TurnResult,
    whatsappConfig: CompanyWhatsAppConfig,
  ): Promise<void> {
    if (!result.handled) return;

    const hasText = Boolean(result.text?.trim());
    const media = result.components?.find((c) => c.kind === 'media');
    const nonMediaComponents = result.components?.filter((c) => c.kind !== 'media');

    if (!hasText && !media) return;

    if (hasText) {
      const primarySent = await this.sendPrimaryTurnPayload(
        to,
        result.text!,
        nonMediaComponents,
        whatsappConfig,
      );
      if (!primarySent && !media) return;
    }

    if (media?.kind === 'media' && media.url) {
      if (media.mime.startsWith('image/')) {
        await this.sendImage(to, media.url, media.caption ?? null, whatsappConfig).catch(() => undefined);
      } else {
        await this.sendDocument(to, media.url, 'document.pdf', media.caption ?? null, whatsappConfig).catch(() => undefined);
      }
    }
  }

  /**
   * Send contextual quick-reply suggestion buttons after an AI response.
   * Delegates button selection to buyerButtonPolicy.service.
   *
   * @param to - Recipient phone number
   * @param stage - Current conversation stage (from ConversationStateMachine)
   * @param context - Property/lead context and real-time visit state for button selection
   * @param whatsappConfig - Company WhatsApp credentials
   */
  async sendContextualQuickReplies(
    to: string,
    stage: string,
    context: {
      propertyId?: string | null;
      recommendedPropertyIds?: string[];
      properties?: Array<{ id: string; name: string }>;
      outboundText?: string;
      /** True when the lead has a scheduled or confirmed site visit. */
      hasActiveVisit?: boolean;
      /** Status string of the active visit (e.g. 'scheduled', 'confirmed'). */
      visitStatus?: string;
      /** Property name for the active visit — used in button body text. */
      visitProperty?: string;
      /** Formatted visit time string for the button body. */
      visitTime?: string;
      /** Set when an action just completed — suppresses follow-up buttons for this turn. */
      recentAction?: QuickReplyRecentAction;
    },
    whatsappConfig: CompanyWhatsAppConfig,
  ): Promise<void> {
    const components = resolveBuyerComponents({
      stage,
      outboundText: context.outboundText ?? '',
      recentAction: context.recentAction,
      propertyId: context.propertyId,
      recommendedPropertyIds: context.recommendedPropertyIds,
      properties: context.properties,
      hasActiveVisit: context.hasActiveVisit,
      visitStatus: context.visitStatus,
      visitProperty: context.visitProperty,
      visitTime: context.visitTime,
    });
    await this.sendTurnComponents(to, components, whatsappConfig, context.outboundText);
  }

  /**
   * Send a WhatsApp Flow message for multi-step forms (e.g. lead qualification, booking).
   * Requires a configured Flow ID from Meta Business Manager.
   * Falls back to a plain button when no flowId is provided.
   *
   * @param to - Recipient phone number
   * @param flowId - Meta Flow ID (from Business Manager → Flows)
   * @param bodyText - Message body text shown to user
   * @param ctaText - Call-to-action button label (max 20 chars)
   * @param whatsappConfig - Company WhatsApp credentials
   * @returns Send result
   */
  async sendFlowMessage(
    to: string,
    flowId: string,
    bodyText: string,
    ctaText: string,
    whatsappConfig: CompanyWhatsAppConfig,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const { phoneNumberId, accessToken } = whatsappConfig;
    if (!phoneNumberId || !accessToken || !flowId) {
      return this.sendInteractiveButtons(
        to,
        bodyText,
        [{ id: 'flow-fallback', title: ctaText.slice(0, 20) }],
        null,
        null,
        whatsappConfig,
      );
    }
    try {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to.replace('+', ''),
        type: 'interactive',
        interactive: {
          type: 'flow',
          body: { text: bodyText.slice(0, 1024) },
          action: {
            name: 'flow',
            parameters: { flow_id: flowId, flow_cta: ctaText.slice(0, 20), mode: 'published' },
          },
        },
      };
      const response = await fetch(`${config.whatsapp.apiUrl}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errText = await response.text();
        logger.error('WhatsApp sendFlowMessage error', { status: response.status, error: errText });
        return { success: false, error: `API Error: ${response.status}` };
      }
      const result = await response.json() as { messages?: Array<{ id: string }> };
      const messageId = result.messages?.[0]?.id;
      logger.info('WhatsApp flow message sent', { messageId, to, flowId });
      return { success: true, messageId };
    } catch (err: any) {
      logger.error('Failed to send WhatsApp flow message', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Send property image gallery to a lead.
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
   * When the customer names a type + area (e.g. "villa near Anekal"), send brochure for the best catalog match.
   */
  private async maybeSendCatalogBrochureForQuery(input: {
    companyId: string;
    customerPhone: string;
    messageText: string;
    whatsappConfig: CompanyWhatsAppConfig;
  }): Promise<void> {
    const text = input.messageText.trim();
    if (!text || text.length < 8) {
      return;
    }

    const wantsBrochure = /\b(brochure|pdf|details|send|share)\b/i.test(text);
    const hasTypeOrLocation = /\b(villa|apartment|flat|plot|commercial|near|in)\b/i.test(text);
    if (!wantsBrochure && !hasTypeOrLocation) {
      return;
    }

    try {
      const matches = await matchCatalogPropertiesForQuery({
        companyId: input.companyId,
        query: text,
        limit: 3,
      });
      const top = matches.find((m) => m.brochureUrl && m.score >= 3) ?? matches.find((m) => m.brochureUrl);
      if (!top?.brochureUrl) {
        return;
      }

      const locationLabel = [top.locationArea, top.locationCity].filter(Boolean).join(', ');
      const intro = locationLabel
        ? `Here is the project for *${top.name}* (${top.propertyType}) near ${locationLabel}:`
        : `Here is the project for *${top.name}* (${top.propertyType}):`;

      await this.sendMessage(input.customerPhone, intro, input.whatsappConfig);
      await this.sendPropertyBrochure(
        input.customerPhone,
        top.brochureUrl,
        top.name,
        input.whatsappConfig,
      );
      // Intro only — PDF is sent by sendPropertyBrochure (no link in chat)
    } catch (err: unknown) {
      logger.warn('Catalog brochure auto-send skipped', {
        companyId: input.companyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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

    const { resolveBrochureUrlForWhatsApp } = await import('./brochureDelivery.service');
    const downloadUrl = await resolveBrochureUrlForWhatsApp(brochureUrl);
    if (!downloadUrl) {
      return { success: false, error: 'Could not resolve brochure file for WhatsApp' };
    }

    const filename = `${propertyName.replace(/[^a-zA-Z0-9]/g, '_')}_Brochure.pdf`;
    const caption = `📋 Brochure - ${propertyName}`;

    return this.sendDocument(to, downloadUrl, filename, caption, whatsappConfig);
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
    turnResult?: import('../types/whatsapp-turn.types').TurnResult;
  }> {
    const { interactiveId, lead, conversation, company, whatsappConfig, customerPhone } = params;
    
    logger.info('Processing interactive action', {
      interactiveId,
      leadId: lead.id,
      conversationId: conversation.id,
    });

    const { tryOrchestratedInteractiveAction } = await import(
      './whatsapp/whatsappInteractiveOrchestrator.service'
    );
    const orchestrated = await tryOrchestratedInteractiveAction({
      interactiveId,
      lead,
      conversation,
      company,
    });
    if (orchestrated !== null) {
      return orchestrated;
    }

    // ---- Visit Time Selection (legacy direct send — slot booking mutation) ----
    if (interactiveId.startsWith('visit-time-')) {
      const parsed = parseVisitTimeInteractiveId(interactiveId);
      if (!parsed) {
        await this.sendMessage(
          customerPhone,
          'Sorry, I could not read that time slot. Please tap a visit time button again or tell me your preferred date.',
          whatsappConfig,
        );
        return { handled: true, action: 'visit-time-parse-failed' };
      }

      const { propertyId, slot } = parsed;
      const proposedTime = resolveVisitSlotToDate(slot);
      const property = await prisma.property.findFirst({
        where: { id: propertyId, companyId: company.id },
      });

      let agentId = lead.assignedAgentId;
      if (!agentId) {
        agentId = await this.assignRoundRobin(company.id);
        if (agentId) {
          await prisma.lead.update({ where: { id: lead.id }, data: { assignedAgentId: agentId } });
        }
      }

      if (!agentId) {
        await this.sendMessage(
          customerPhone,
          'Thanks for choosing a time! Our sales team will call you shortly to confirm your visit.',
          whatsappConfig,
        );
        return { handled: true, action: 'visit-no-agent', leadStatus: 'contacted' };
      }

      // P0-4: Read autoConfirmVisits from DB (aiSettings) instead of the previously undocumented
      // env var WHATSAPP_AUTO_CONFIRM_VISITS that defaulted to TRUE.
      // New DB field defaults to FALSE \u2014 agents must explicitly enable auto-confirm per company.
      const aiSettings = await prisma.aiSetting.findUnique({ where: { companyId: company.id } });
      const autoConfirm = aiSettings?.autoConfirmVisits === true;
      if (autoConfirm) {
        const { scheduleVisit } = await import('./visitBooking.service');
        const booking = await scheduleVisit({
          companyId: company.id,
          leadId: lead.id,
          propertyId,
          scheduledAt: proposedTime,
          agentId,
          notes: 'Booked via WhatsApp visit button',
        });

        if (booking.success && booking.visit) {
          const when = proposedTime.toLocaleString('en-IN', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Kolkata',
          });
          await this.sendMessage(
            customerPhone,
            `✅ *Visit confirmed!*\n\n📍 *${property?.name || 'Property'}*\n📅 ${when} IST\n\nOur team will call you about an hour before the visit.`,
            whatsappConfig,
          );

          // Notify assigned agent immediately via WhatsApp
          if (agentId) {
            try {
              const agentRecord = await prisma.user.findUnique({ where: { id: agentId }, select: { phone: true, name: true } });
              if (agentRecord?.phone) {
                const agentMsg = `📅 *New Visit Booked!*\n\n👤 ${lead.customerName || lead.phone}\n🏠 ${property?.name || 'Property'}\n🕐 ${when} IST\n\nCustomer booked via WhatsApp. Please confirm availability.`;
                void this.sendMessage(agentRecord.phone, agentMsg, whatsappConfig);
              }
            } catch (notifyErr: unknown) {
              logger.warn('Failed to notify agent of auto-confirmed visit', {
                agentId,
                visitId: booking.visit.id,
                error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
              });
            }
          }

          return {
            handled: true,
            action: 'visit-scheduled',
            newState: {
              stage: 'confirmation',
              selectedPropertyId: propertyId,
              proposedVisitTime: proposedTime,
            },
            leadStatus: 'visit_scheduled',
          };
        }
      }


      const { createVisitApprovalRequest } = await import('./visitPendingApproval.service');
      await createVisitApprovalRequest({
        companyId: company.id,
        leadId: lead.id,
        propertyId,
        scheduledAt: proposedTime,
        agentId,
        conversationId: conversation.id,
        customerPhone,
        customerName: lead.customerName,
        propertyName: property?.name,
      });

      return {
        handled: true,
        action: 'visit-pending-agent-approval',
        newState: {
          stage: 'visit_booking',
          selectedPropertyId: propertyId,
          proposedVisitTime: proposedTime,
        },
        leadStatus: 'contacted',
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

    // ---- Show Location (legacy direct send) ----
    if (interactiveId.startsWith('location-')) {
      const propertyId = interactiveId.replace('location-', '');
      // FIX P0-3: Use findFirst with companyId to enforce tenant isolation.
      const property = await prisma.property.findFirst({ where: { id: propertyId, companyId: company.id } });

      if (!property) {
        return { handled: false };
      }

      // Use latitude/longitude from schema
      const lat = property.latitude !== null && property.latitude !== undefined ? Number(property.latitude) : null;
      const lng = property.longitude !== null && property.longitude !== undefined ? Number(property.longitude) : null;

      // Format address from available fields
      const formatAddress = (p: any) => {
        const parts = [p.locationArea, p.locationCity, p.locationPincode].filter(Boolean);
        return parts.length > 0 ? parts.join(', ') : '';
      };

      if (lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng)) {
        const locationResult = await this.sendLocation(
          customerPhone,
          lat,
          lng,
          property.name,
          formatAddress(property),
          whatsappConfig
        );
        if (!locationResult.success) {
          const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
          await this.sendMessage(
            customerPhone,
            `Location: ${property.name}\n${formatAddress(property) || 'Address not available'}\n${mapsUrl}`,
            whatsappConfig,
          );
        }
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
      const propertyId = conversation.selectedPropertyId;
      // FIX P0-3: Use findFirst with companyId to enforce tenant isolation.
      const property = propertyId
        ? await prisma.property.findFirst({ where: { id: propertyId, companyId: company.id } })
        : null;

      const propertyPrice = property?.priceMin ? Number(property.priceMin) : null;

      if (property && propertyPrice) {
        const defaultDownPayment = propertyPrice * 0.2;
        const emi = calculateEmi({
          principal: propertyPrice,
          downPayment: defaultDownPayment,
          interestRate: 8.5,
          tenureMonths: 240,
        });

        await this.sendMessage(
          customerPhone,
          `📊 *EMI Estimate for ${property.name}*\n\n💰 Property Price: ₹${(emi.principal / 100000).toFixed(2)} Lakhs\n📉 Down Payment (20%): ₹${(emi.downPayment / 100000).toFixed(2)} Lakhs\n📈 Loan Amount: ₹${(emi.loanAmount / 100000).toFixed(2)} Lakhs\n💳 EMI (20 yrs @ 8.5%): ₹${Math.round(emi.monthlyEmi).toLocaleString('en-IN')}/month\n\nThis is an estimate. You can fine-tune values in the dashboard EMI calculator for exact planning.`,
          whatsappConfig
        );

        await this.sendInteractiveButtons(
          customerPhone,
          'Would you like to continue?',
          [
            { id: `book-visit-${property.id}`, title: 'Book Visit' },
            { id: 'call-me', title: 'Call Me' },
            { id: `more-info-${property.id}`, title: 'More Info' },
          ],
          null,
          null,
          whatsappConfig
        );
      } else {
        await this.sendMessage(
          customerPhone,
          'I can help you calculate EMI. Please select a property first, or share your budget and down payment.',
          whatsappConfig
        );
      }

      return { handled: true, action: 'emi-calculated' };
    }

    // ---- Unrecognized action - let AI handle it ----
    logger.info('Unrecognized interactive action, passing to AI', { interactiveId });
    return { handled: false };
  }

}

function formatOperatorHandoffLine(operatorContact: unknown): string | null {
  if (!operatorContact || typeof operatorContact !== 'object' || Array.isArray(operatorContact)) {
    return null;
  }
  const contact = operatorContact as Record<string, unknown>;
  const name = typeof contact.name === 'string' ? contact.name.trim() : '';
  const phone = typeof contact.phone === 'string' ? contact.phone.trim() : '';
  if (!name && !phone) {
    return null;
  }
  if (name && phone) {
    return `Our specialist *${name}* will assist you shortly. You can also reach them at ${phone}.`;
  }
  if (phone) {
    return `Our specialist will call you shortly at ${phone}.`;
  }
  return `*${name}* from our team will assist you shortly with pricing and booking.`;
}

function normalizeLeadPropertyType(value: unknown): 'villa' | 'apartment' | 'plot' | 'commercial' | 'other' | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.includes('apartment')) return 'apartment';
  if (normalized.includes('villa')) return 'villa';
  if (normalized.includes('plot')) return 'plot';
  if (normalized.includes('commercial')) return 'commercial';
  if (normalized.includes('other')) return 'other';

  return null;
}

/**
 * Builds a context-aware fallback message when the AI provider fails.
 *
 * Rules (in priority order):
 * 1. If customer has an active visit → acknowledge it; offer Confirm/Reschedule/Cancel.
 * 2. If the message was about visits/bookings → surface the specific failure reason.
 * 3. Default → brief apology with a prompt to try again.
 *
 * NEVER produces the generic "I'm having a little trouble connecting" alone —
 * that resets context and violates the Stateful + Transparent pillars.
 *
 * @param input.customerName - Lead name for personalisation.
 * @param input.activeVisitPropertyName - Property name if an active visit exists.
 * @param input.isVisitQuery - Whether the customer was asking about their visit.
 */
function buildAiFallbackMessage(input: {
  customerName: string | null | undefined;
  activeVisitPropertyName: string | null;
  isVisitQuery: boolean;
}): string {
  const salutation = formatCustomerSalutation(input.customerName);

  if (input.activeVisitPropertyName) {
    const prop = `*${input.activeVisitPropertyName}*`;
    return (
      `I had a brief connection issue, but here's what I know${salutation}: ` +
      `your visit to ${prop} is on record 🗓️\n\n` +
      `Reply *Confirm*, *Reschedule*, or *Cancel* and I'll handle it right away. ✅`
    );
  }

  if (input.isVisitQuery) {
    return (
      `I ran into a brief issue fetching your visit details${salutation}. ` +
      `Could you give me a moment and try again? I'll pull up your booking status right away. 🙏`
    );
  }

  return (
    `I had a brief technical issue${salutation}. ` +
    `Please resend your message and I'll respond immediately — no need to start over! 🙏`
  );
}

export const whatsappService = new WhatsAppService();