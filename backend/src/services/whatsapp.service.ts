import prisma from '../config/prisma';
import config from '../config';
import logger from '../config/logger';
import { maskPhoneNumberForLogs } from '../utils/maskPhoneNumberForLogs';
import { aiService } from './ai.service';
import { calculateEmi } from './emi.service';
import { buildNeverSayNoContext } from './neverSayNoEngine.service';
import { criteriaFromLead } from './alternativeInventory.service';
import { enforceNeverSayNoResponse } from './neverSayNoResponseGuard.service';
import { polishOutboundMessage } from './messagePolish.service';
import { buildGroundedFactsBlock } from './groundingGuard.service';
import { propertyToCompletenessInput } from './propertyCompleteness.service';
import { matchCatalogPropertiesForQuery } from './propertyKnowledge.service';
import { normalizeInboundWhatsAppPhone, phonesMatchLast10 } from '../utils/phoneMatch';
import {
  routeCompanyScopedInbound,
} from './inboundWhatsAppRouting.service';

import {
  parseVisitTimeInteractiveId,
  resolveVisitSlotToDate,
  scheduleVisitFromWhatsApp,
} from './visitBooking.service';
import { searchAlternativeTiers } from './alternativeInventory.service';
import { transitionLeadStatus, transitionLeadToVisitScheduled } from './leadTransition.service';
import { socketService, SOCKET_EVENTS } from './socket.service';
import { notifyAgentOfNewLead } from './leadAssignment.service';
import { assignLeadWithRouting } from './leadRouting.service';
import { syncLeadScoreFromConversation } from './leadScoring.service';
import { logAgentAction } from './agent-action-log.service';
import { tryCommitCustomerVisitBooking } from './customerVisitBooking.service';

import {
  handleWrongReport,
  isWrongReportMessage,
  WRONG_ACK_MESSAGE,
} from './wrongReport.service';
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
  /** Meta display phone on the business line (for tenant disambiguation). */
  businessDisplayPhone?: string;
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

export class WhatsAppService {
  private outboundProviders: Partial<Record<'meta' | 'greenapi', WhatsAppOutboundProvider>> = {};

  private resolveOutboundProviderName(whatsappConfig?: CompanyWhatsAppConfig | null): 'meta' | 'greenapi' {
    const explicitProvider = whatsappConfig?.provider;
    const requested = explicitProvider || (config as any)?.whatsapp?.provider;
    // Always respect the explicit company-level provider selection.
    // The production restriction has been removed — GreenAPI is fully supported.
    return requested === 'greenapi' ? 'greenapi' : 'meta';
  }

  private getOutboundProvider(providerName: 'meta' | 'greenapi'): WhatsAppOutboundProvider {
    const cached = this.outboundProviders[providerName];
    if (cached) {
      return cached;
    }

    const provider =
      providerName === 'greenapi'
        ? new GreenApiWhatsAppProvider({
            apiUrl: (config as any)?.greenapi?.apiUrl || 'https://api.green-api.com',
          })
        : new MetaWhatsAppProvider({ apiUrl: config.whatsapp.apiUrl });

    this.outboundProviders[providerName] = provider;
    return provider;
  }

  /**
   * Get company by WhatsApp phone number ID.
   * Deterministically resolves company routing from company.settings.whatsapp.phoneNumberId.
   */
  async getCompanyByPhoneNumberId(
    phoneNumberId: string,
    providerHint?: 'meta' | 'greenapi',
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

    const providerName = providerHint || this.resolveOutboundProviderName(null);

    const normalizeStringLike = (value: unknown): string => {
      if (typeof value === 'string') {
        return value.trim();
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
      return '';
    };

    const normalizeTokenLike = (value: unknown): string => {
      const normalized = normalizeStringLike(value);
      if (!normalized) {
        return '';
      }

      return normalized.replace(/^(?:Bearer|Basic)\s+/i, '').trim();
    };

    // GreenAPI inbound MUST be deterministically routed by instance identifier.
    // Fail closed if no company is explicitly mapped.
    if (providerName === 'greenapi') {
      const normalizedInstanceId = normalizeStringLike(phoneNumberId);
      const normalizedCompanyIdHint = normalizeStringLike(companyIdHint);
      const normalizedWebhookToken = normalizeTokenLike(webhookTokenHint);

      if (!normalizedInstanceId) {
        logger.error('GreenAPI company resolution failed: missing instance identifier (phoneNumberId)');
        return null;
      }

      const matches: any[] = [];
      for (const company of companies) {
        const settings = (company.settings as any) || {};
        const whatsapp = (settings.whatsapp as any) || {};
        const greenapi = (whatsapp.greenapi as any) || {};

        const configuredId = normalizeStringLike(greenapi.idInstance);
        const legacyConfiguredId = normalizeStringLike(whatsapp.phoneNumberId);

        const allowLegacyMapping =
          whatsapp.provider === 'greenapi' ||
          (config.env !== 'production' && (config as any)?.whatsapp?.provider === 'greenapi');

        const candidateId = configuredId || (allowLegacyMapping ? legacyConfiguredId : '');

        if (candidateId && candidateId === normalizedInstanceId) {
          matches.push(company);
        }
      }

      if (matches.length === 1) {
        const company = matches[0];
        const settings = (company.settings as any) || {};
        const whatsapp = (settings.whatsapp as any) || {};
        const greenapi = (whatsapp.greenapi as any) || {};

        const idInstance = normalizeStringLike(greenapi.idInstance) || normalizeStringLike(whatsapp.phoneNumberId);
        const apiTokenInstance =
          normalizeStringLike(greenapi.apiTokenInstance) ||
          normalizeStringLike(whatsapp.apiTokenInstance) ||
          (config as any)?.greenapi?.apiTokenInstance ||
          '';

        return {
          company,
          config: {
            provider: 'greenapi',
            phoneNumberId: '',
            accessToken: '',
            verifyToken: normalizeStringLike(whatsapp.verifyToken) || config.whatsapp.verifyToken,
            idInstance,
            apiTokenInstance,
          },
        };
      }

      if (matches.length > 1 && normalizedCompanyIdHint) {
        const companyMatches = matches.filter((company) => company.id === normalizedCompanyIdHint);

        if (companyMatches.length === 1) {
          const company = companyMatches[0];
          const settings = (company.settings as any) || {};
          const whatsapp = (settings.whatsapp as any) || {};
          const greenapi = (whatsapp.greenapi as any) || {};

          const idInstance = normalizeStringLike(greenapi.idInstance) || normalizeStringLike(whatsapp.phoneNumberId);
          const apiTokenInstance =
            normalizeStringLike(greenapi.apiTokenInstance) ||
            normalizeStringLike(whatsapp.apiTokenInstance) ||
            (config as any)?.greenapi?.apiTokenInstance ||
            '';

          return {
            company,
            config: {
              provider: 'greenapi',
              phoneNumberId: '',
              accessToken: '',
              verifyToken: normalizeStringLike(whatsapp.verifyToken) || config.whatsapp.verifyToken,
              idInstance,
              apiTokenInstance,
            },
          };
        }
      }

      if (matches.length > 1 && normalizeStringLike(customerPhoneHint)) {
        const digits = normalizeStringLike(customerPhoneHint).replace(/[^0-9]/g, '');
        const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
        const phoneCandidates = Array.from(
          new Set([
            normalizeStringLike(customerPhoneHint),
            digits,
            last10 ? `+${last10}` : '',
            last10 ? `91${last10}` : '',
            last10 ? `+91${last10}` : '',
          ].filter(Boolean)),
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
            const settings = (company.settings as any) || {};
            const whatsapp = (settings.whatsapp as any) || {};
            const greenapi = (whatsapp.greenapi as any) || {};

            const idInstance = normalizeStringLike(greenapi.idInstance) || normalizeStringLike(whatsapp.phoneNumberId);
            const apiTokenInstance =
              normalizeStringLike(greenapi.apiTokenInstance) ||
              normalizeStringLike(whatsapp.apiTokenInstance) ||
              (config as any)?.greenapi?.apiTokenInstance ||
              '';

            return {
              company,
              config: {
                provider: 'greenapi',
                phoneNumberId: '',
                accessToken: '',
                verifyToken: normalizeStringLike(whatsapp.verifyToken) || config.whatsapp.verifyToken,
                idInstance,
                apiTokenInstance,
              },
            };
          }
        }
      }

      if (matches.length > 1 && normalizedWebhookToken) {
        const tokenMatches = matches.filter((company) => {
          const settings = (company.settings as any) || {};
          const whatsapp = (settings.whatsapp as any) || {};
          const greenapi = (whatsapp.greenapi as any) || {};

          const configuredToken = normalizeTokenLike(greenapi.webhookUrlToken || whatsapp.webhookUrlToken || '');
          return configuredToken && configuredToken === normalizedWebhookToken;
        });

        if (tokenMatches.length === 1) {
          const company = tokenMatches[0];
          const settings = (company.settings as any) || {};
          const whatsapp = (settings.whatsapp as any) || {};
          const greenapi = (whatsapp.greenapi as any) || {};

          const idInstance = normalizeStringLike(greenapi.idInstance) || normalizeStringLike(whatsapp.phoneNumberId);
          const apiTokenInstance =
            normalizeStringLike(greenapi.apiTokenInstance) ||
            normalizeStringLike(whatsapp.apiTokenInstance) ||
            (config as any)?.greenapi?.apiTokenInstance ||
            '';

          return {
            company,
            config: {
              provider: 'greenapi',
              phoneNumberId: '',
              accessToken: '',
              verifyToken: normalizeStringLike(whatsapp.verifyToken) || config.whatsapp.verifyToken,
              idInstance,
              apiTokenInstance,
            },
          };
        }
      }

      if (matches.length > 1) {
        const fallbackCompany = matches
          .slice()
          .sort((a, b) => {
            const aTime = new Date(a.updatedAt || 0).getTime();
            const bTime = new Date(b.updatedAt || 0).getTime();
            return bTime - aTime;
          })[0];

        if (fallbackCompany) {
          const settings = (fallbackCompany.settings as any) || {};
          const whatsapp = (settings.whatsapp as any) || {};
          const greenapi = (whatsapp.greenapi as any) || {};

          const idInstance = normalizeStringLike(greenapi.idInstance) || normalizeStringLike(whatsapp.phoneNumberId);
          const apiTokenInstance =
            normalizeStringLike(greenapi.apiTokenInstance) ||
            normalizeStringLike(whatsapp.apiTokenInstance) ||
            (config as any)?.greenapi?.apiTokenInstance ||
            '';

          logger.warn('GreenAPI company resolution fallback selected most recently updated company', {
            instanceId: normalizedInstanceId,
            selectedCompanyId: fallbackCompany.id,
            matchingCompanyIds: matches.map((company) => company.id),
          });

          return {
            company: fallbackCompany,
            config: {
              provider: 'greenapi',
              phoneNumberId: '',
              accessToken: '',
              verifyToken: normalizeStringLike(whatsapp.verifyToken) || config.whatsapp.verifyToken,
              idInstance,
              apiTokenInstance,
            },
          };
        }

        logger.error('GreenAPI company resolution failed: duplicate instance mapping', {
          instanceId: normalizedInstanceId,
          matchingCompanyIds: matches.map((company) => company.id),
          totalCompanies: companies.length,
        });
        return null;
      }

      logger.error('No company found for GreenAPI instance', {
        instanceId: normalizedInstanceId,
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

    const inboundProvider: 'meta' | 'greenapi' = msg.provider === 'greenapi' ? 'greenapi' : 'meta';

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
    });
    if (staffRoute.handled) {
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

    // 2. Find or create lead + conversation for prospects (phones not on any active user profile)
    let lead =
      (await prisma.lead.findFirst({
        where: { companyId, phone: customerPhone },
      })) ?? null;

    if (!lead) {
      const leads = await prisma.lead.findMany({
        where: { companyId },
        select: { id: true, phone: true },
        take: 500,
        orderBy: { updatedAt: 'desc' },
      });
      const matched = leads.find((row) => phonesMatchLast10(row.phone, customerPhone));
      if (matched) {
        lead = await prisma.lead.findUnique({ where: { id: matched.id } });
        if (lead && lead.phone !== customerPhone) {
          await prisma.lead.update({ where: { id: lead.id }, data: { phone: customerPhone } });
          lead = { ...lead, phone: customerPhone };
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

      lead = await prisma.lead.create({
        data: {
          companyId,
          customerName: msg.customerName || null,
          phone: customerPhone,
          source: 'whatsapp',
          status: 'new',
          assignedAgentId: agentId,
          language: 'en',
          metadata: { source_detail: sourceDetail },
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
      await this.sendMessage(customerPhone, WRONG_ACK_MESSAGE, whatsappConfig!);
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

        // Send property media after shortlist (filter / list selection)
        if (actionResult.newState?.stage === 'shortlist') {
          const recommendedIds =
            actionResult.newState.recommendedPropertyIds ||
            (actionResult.newState as { recommendedProperties?: string[] }).recommendedProperties ||
            [];
          if (recommendedIds.length > 0) {
            const mediaState = {
              ...conversationState,
              stage: 'shortlist' as ConversationStage,
              recommendedProperties: recommendedIds,
            };
            const properties = await prisma.property.findMany({
              where: { companyId, id: { in: recommendedIds } },
            });
            await this.sendPropertyMediaForStage(
            customerPhone,
            whatsappConfig!,
            mediaState,
              properties,
              lead,
              conversation.id,
            );
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

    // 4. Any non-staff WhatsApp sender is a prospect — resume AI for this channel before replying
    const aiReady = await this.ensureProspectConversationAiActive(conversation);
    conversation = { ...conversation, status: aiReady.status as typeof conversation.status, aiEnabled: aiReady.aiEnabled };

    if (conversation.status === 'ai_active' && conversation.aiEnabled) {
      try {
        const history = await prisma.message.findMany({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: 'asc' },
          take: 30,
        });

        const recentCustomerMessages = history
          .filter((m) => m.senderType === 'customer')
          .map((m) => m.content)
          .slice(-7);

        const visitCommit = await tryCommitCustomerVisitBooking({
          companyId,
          lead: {
            id: lead.id,
            assignedAgentId: lead.assignedAgentId,
            customerName: lead.customerName,
            status: lead.status,
          },
          conversation: {
            id: conversation.id,
            selectedPropertyId: conversation.selectedPropertyId,
            proposedVisitTime: conversation.proposedVisitTime,
            recommendedPropertyIds: conversation.recommendedPropertyIds,
          },
          customerMessage: msg.messageText,
          customerPhone,
          recentCustomerMessages,
        });

        if (visitCommit.committed && visitCommit.customerReply) {
          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              senderType: 'ai',
              content: visitCommit.customerReply,
              status: 'sent',
            },
          });
          await this.sendMessage(customerPhone, visitCommit.customerReply, whatsappConfig!);

          if (visitCommit.scheduledAt) {
            await prisma.conversation.update({
              where: { id: conversation.id },
              data: {
                stage: visitCommit.mode === 'scheduled' ? 'confirmation' : 'visit_booking',
                proposedVisitTime: visitCommit.scheduledAt,
                commitments: {
                  ...(conversation.commitments as object),
                  visitSlotDiscussed: true,
                  visitSlotConfirmed: visitCommit.mode === 'scheduled',
                },
              },
            });
          }

          if (visitCommit.leadStatus === 'visit_scheduled') {
            await transitionLeadToVisitScheduled(lead.id);
          }

          void logAgentAction({
            companyId,
            triggeredBy: 'inbound_message',
            action: 'customerVisitBooked',
            resourceType: 'visit',
            resourceId: visitCommit.visitId ?? undefined,
            status: 'success',
            inputs: {
              mode: visitCommit.mode,
              scheduledAt: visitCommit.scheduledAt?.toISOString(),
            },
          });

          propagation = await this.propagateConversationUpdate({
            companyId,
            conversationId: conversation.id,
            leadId: lead.id,
            trigger: 'visit_booked',
          });

          return {
            status: 'processed',
            companyId,
            leadId: lead.id,
            conversationId: conversation.id,
            propagation,
          };
        }

        const aiSettings = await prisma.aiSetting.findUnique({
          where: { companyId },
        });

        const neverSayNoCtx = await buildNeverSayNoContext(companyId, criteriaFromLead(lead), {
          customerMessage: msg.messageText,
          customerName: lead.customerName,
          language: lead.language,
        });
        const propertyIdSet = [
          ...new Set([
            ...neverSayNoCtx.exactPropertyIds,
            ...neverSayNoCtx.alternativePropertyIds,
          ]),
        ];
        const properties =
          propertyIdSet.length > 0
            ? await prisma.property.findMany({
                where: { companyId, id: { in: propertyIdSet } },
              })
            : await prisma.property.findMany({
                where: { companyId, status: 'available' },
                take: 20,
              });

        const customerMessageCount =
          history.filter((m) => m.senderType === 'customer').length + 1;

        const aiResponse = await Promise.race([
          aiService.generateResponse({
            companyId,
            customerMessage: msg.messageText,
            conversationHistory: history,
            lead,
            properties,
            aiSettings: aiSettings || {},
            companyName: company.name,
            conversationState,
            conversionPromptBlock: neverSayNoCtx.promptBlock,
            neverSayNoFallbackCta: neverSayNoCtx.fallbackCta,
            neverSayNoHasAlternatives: neverSayNoCtx.hasInventoryAlternatives,
            customerMessageCount,
          }),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('AI response timed out after 28s')), 28_000);
          }),
        ]);

        const groundedProperties = properties.map(propertyToCompletenessInput);
        const groundedFactsBlock = buildGroundedFactsBlock(
          groundedProperties,
          neverSayNoCtx.promptBlock,
        );
        const guarded = enforceNeverSayNoResponse({
          text: aiResponse.text,
          hasInventoryAlternatives: neverSayNoCtx.hasInventoryAlternatives,
          fallbackCta: neverSayNoCtx.fallbackCta,
          groundedProperties,
          conversionPromptBlock: neverSayNoCtx.promptBlock,
        });
        const polished = await polishOutboundMessage({
          rawText: guarded.text,
          groundedFactsBlock,
          channel: 'whatsapp',
          language: aiResponse.detectedLanguage,
        });
        let outboundText = polished.text;
        if (!outboundText.trim()) {
          outboundText =
            `Thanks for messaging *${company.name}*! I'm your property assistant.\n\n` +
            `Please share your *area*, *budget*, and *property type* so I can help.`;
        }

        logger.info('AI response generated', {
          conversationId: conversation.id,
          stage: aiResponse.newState?.stage,
          action: aiResponse.nextAction?.action,
          polishMode: polished.mode,
          guardApplied: guarded.guardApplied,
        });

        // Store AI response
        await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderType: 'ai',
            content: outboundText,
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

          if (aiResponse.newState) {
            await syncLeadScoreFromConversation(
              lead.id,
              aiResponse.newState.urgencyScore,
              aiResponse.newState.valueScore,
            );
          }

          // Sync CRM pipeline when policy brain suggests (price → negotiation)
          const suggestedStatus = aiResponse.nextAction?.suggestedLeadStatus;
          if (suggestedStatus) {
            await transitionLeadStatus(lead.id, suggestedStatus, { force: true });
          }

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

          // Follow-up with operator contact when configured
          if (newState.stage === 'human_escalated' && aiSettings) {
            const operatorLine = formatOperatorHandoffLine(aiSettings.operatorContact);
            if (operatorLine) {
              await prisma.message.create({
                data: {
                  conversationId: conversation.id,
                  senderType: 'ai',
                  content: operatorLine,
                  language: aiResponse.detectedLanguage,
                  status: 'sent',
                },
              });
              await this.sendMessage(customerPhone, operatorLine, whatsappConfig!);
            }
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
          const normalizedPropertyType = normalizeLeadPropertyType(info.property_type);
          if (normalizedPropertyType) updates.propertyType = normalizedPropertyType;
          if (info.customer_name && !lead.customerName) updates.customerName = info.customer_name;

          if (Object.keys(updates).length > 0) {
            await prisma.lead.update({ where: { id: lead.id }, data: updates });
          }
        }

        // If lead is 'new', auto-transition to 'contacted'
        if (lead.status === 'new') {
          await prisma.lead.update({ where: { id: lead.id }, data: { status: 'contacted' } });
        }

        // Send via WhatsApp Cloud API using company-specific config
        const sent = await this.sendMessage(customerPhone, outboundText, whatsappConfig!);

        await this.maybeSendCatalogBrochureForQuery({
          companyId,
          customerPhone,
          messageText: msg.messageText,
          whatsappConfig: whatsappConfig!,
        });

        // CHUNK 5: AI Rich Media Presentation
        // If AI recommended properties and they have media, send it automatically
        if (aiResponse.newState && this.shouldSendPropertyMedia(aiResponse.newState, aiResponse.nextAction)) {
          await this.sendPropertyMediaForStage(
            customerPhone,
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
            customerPhone,
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
        const fallbackText =
          `Hi! Thanks for messaging *${company.name}*. I'm here to help you find the right property.\n\n` +
          `Could you share your preferred *area*, *budget*, and *BHK*? I'll suggest options from our listings.`;
        try {
          await this.sendMessage(customerPhone, fallbackText, whatsappConfig!);
        } catch (sendErr: any) {
          logger.error('Failed to send AI fallback WhatsApp message', { error: sendErr?.message });
        }
      }
    } else {
      // Human takeover in CRM — still reply on WhatsApp so unknown prospects are never left silent
      const aiSettings = await prisma.aiSetting.findUnique({ where: { companyId } });
      const handoffText =
        `Thanks for your message! Our team at *${company.name}* has your request.\n\n` +
        (formatOperatorHandoffLine(aiSettings?.operatorContact) ||
          `Please share your *area*, *budget*, and *property type* if you have not already — we will assist you shortly.`);

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: 'ai',
          content: handoffText,
          language: lead.language || 'en',
          status: 'sent',
        },
      });

      try {
        await this.sendMessage(customerPhone, handoffText, whatsappConfig!);
      } catch (sendErr: any) {
        logger.error('Failed to send handoff WhatsApp message to prospect', {
          error: sendErr?.message,
          conversationId: conversation.id,
        });
      }

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

      logger.info('Prospect message stored; handoff reply sent (conversation not ai_active)', {
        conversationId: conversation.id,
        status: conversation.status,
        aiEnabled: conversation.aiEnabled,
      });
    }

    return {
      status: 'processed',
      companyId,
      leadId: lead.id,
      conversationId: conversation.id,
      propagation,
    };
  }

  /**
   * Prospects (any phone not registered as company staff) must get AI replies.
   * Re-enable AI when a customer messages again after agent takeover or manual disable.
   */
  private async ensureProspectConversationAiActive(conversation: {
    id: string;
    status: string;
    aiEnabled: boolean;
  }): Promise<{ status: string; aiEnabled: boolean }> {
    if (conversation.status === 'ai_active' && conversation.aiEnabled) {
      return { status: conversation.status, aiEnabled: conversation.aiEnabled };
    }

    logger.info('Reactivating AI for inbound prospect WhatsApp message', {
      conversationId: conversation.id,
      previousStatus: conversation.status,
      previousAiEnabled: conversation.aiEnabled,
    });

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: 'ai_active',
        aiEnabled: true,
      },
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

  async sendCompanyTextMessage(to: string, text: string, companyId: string): Promise<boolean> {
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
    const greenapi = (whatsapp.greenapi as any) || {};
    const provider = normalizeStringLike(whatsapp.provider) as 'meta' | 'greenapi' | '';

    const whatsappConfig: CompanyWhatsAppConfig = {
      provider: provider || undefined,
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
      idInstance: normalizeStringLike(greenapi.idInstance),
      apiTokenInstance: normalizeStringLike(greenapi.apiTokenInstance),
    };

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
    const greenapi = (whatsapp.greenapi as any) || {};
    const provider = normalizeStringLike(whatsapp.provider) as 'meta' | 'greenapi' | '';

    const whatsappConfig: CompanyWhatsAppConfig = {
      provider: provider || undefined,
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
      idInstance: normalizeStringLike(greenapi.idInstance),
      apiTokenInstance: normalizeStringLike(greenapi.apiTokenInstance),
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

    const providerName = this.resolveOutboundProviderName(whatsappConfig);

    if (providerName === 'meta') {
      const { phoneNumberId, accessToken } = whatsappConfig;

      if (!phoneNumberId || !accessToken) {
        logger.error('WhatsApp Meta config missing phoneNumberId or accessToken');
        return false;
      }
    } else {
      const idInstance = whatsappConfig.idInstance || (config as any)?.greenapi?.idInstance || '';
      const apiTokenInstance = whatsappConfig.apiTokenInstance || (config as any)?.greenapi?.apiTokenInstance || '';

      if (!idInstance || !apiTokenInstance) {
        logger.error('WhatsApp GreenAPI config missing idInstance or apiTokenInstance');
        return false;
      }

      // Ensure provider config contains credentials for the provider implementation.
      whatsappConfig = {
        ...whatsappConfig,
        idInstance,
        apiTokenInstance,
      };
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
    const providerName = this.resolveOutboundProviderName(whatsappConfig);

    if (providerName === 'greenapi') {
      const idInstance = whatsappConfig.idInstance || (config as any)?.greenapi?.idInstance || '';
      const apiTokenInstance = whatsappConfig.apiTokenInstance || (config as any)?.greenapi?.apiTokenInstance || '';

      return this.getOutboundProvider('greenapi').testConnection({
        ...whatsappConfig,
        provider: 'greenapi',
        idInstance,
        apiTokenInstance,
      });
    }

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
    if (this.resolveOutboundProviderName(whatsappConfig) !== 'meta') {
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
    if (this.resolveOutboundProviderName(whatsappConfig) !== 'meta') {
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
    if (this.resolveOutboundProviderName(whatsappConfig) !== 'meta') {
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
    if (this.resolveOutboundProviderName(whatsappConfig) !== 'meta') {
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
    if (this.resolveOutboundProviderName(whatsappConfig) !== 'meta') {
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
        if (this.resolveOutboundProviderName(whatsappConfig) !== 'meta') {
          const fallbackSent = await this.sendMessage(
            to,
            `📸 ${propertyName} — photo ${i + 1}: ${imagesToSend[i]}`,
            whatsappConfig,
          );
          if (fallbackSent) {
            sent++;
            continue;
          }
        }
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

    const filename = `${propertyName.replace(/[^a-zA-Z0-9]/g, '_')}_Brochure.pdf`;
    const caption = `📋 Brochure - ${propertyName}`;

    const docResult = await this.sendDocument(to, brochureUrl, filename, caption, whatsappConfig);
    if (!docResult.success && this.resolveOutboundProviderName(whatsappConfig) !== 'meta') {
      const fallbackSent = await this.sendMessage(
        to,
        `${caption}\n\nView brochure: ${brochureUrl}`,
        whatsappConfig,
      );
      if (fallbackSent) {
        return { success: true, messageId: 'fallback-text-url' };
      }
    }
    return docResult;
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

      const autoConfirm = process.env.WHATSAPP_AUTO_CONFIRM_VISITS !== '0';
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
          });
          await this.sendMessage(
            customerPhone,
            `✅ *Visit confirmed!*\n\n📍 *${property?.name || 'Property'}*\n📅 ${when}\n\nOur team will call you about an hour before the visit.`,
            whatsappConfig,
          );
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

        if (properties.length === 0) {
          const tiers = await searchAlternativeTiers({
            companyId: company.id,
            bedrooms: filter.bedrooms,
            propertyType: filter.propertyType,
            locationPreference: updatedLead.locationPreference,
            budgetMin: updatedLead.budgetMin ? Number(updatedLead.budgetMin) : null,
            budgetMax: updatedLead.budgetMax ? Number(updatedLead.budgetMax) : null,
          });
          const topHint =
            tiers[0]?.messageHint ||
            `No ${filter.displayName} matches right now — I can add you to our waitlist or show nearby options.`;
          let body = topHint;
          const altProp = tiers[0]?.properties?.[0];
          if (altProp) {
            body += `\n\nClosest option: *${altProp.name}* (${altProp.locationArea || altProp.locationCity}).`;
          }
          body += '\n\nReply *WAITLIST* to get alerted when a match is listed, or tell me another area/BHK.';
          await this.sendMessage(customerPhone, body, whatsappConfig);

          await prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              commitments: {
                ...((conversation.commitments as object) || {}),
                waitlist: true,
                waitlistCriteria: filter.displayName,
              },
            },
          });

          await prisma.message.create({
            data: {
              conversationId: conversation.id,
              senderType: 'ai',
              content: `No ${filter.displayName} exact match; alternatives offered`,
              status: 'sent',
            },
          });

          return {
            handled: true,
            action: 'filter-no-results-alternatives',
            newState: { stage: 'qualify' },
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
      const property = propertyId 
        ? await prisma.property.findUnique({ where: { id: propertyId } })
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

  /**
   * CHUNK 5: Determine if we should send property media based on conversation state
   * Send media when:
   * - AI is in 'shortlist' stage (presenting properties)
   * - AI is in 'commitment' or 'visit_booking' stages (deepening engagement)
   * - Recommended properties exist and have media
   */
  private getRecommendedPropertyIds(state: ConversationState): string[] {
    if (state.recommendedProperties?.length) {
      return state.recommendedProperties;
    }
    const alt = (state as { recommendedPropertyIds?: string[] }).recommendedPropertyIds;
    return alt?.length ? alt : [];
  }

  private shouldSendPropertyMedia(state: ConversationState, action?: NextBestAction): boolean {
    const ids = this.getRecommendedPropertyIds(state);
    if (state.stage === 'shortlist' && ids.length > 0) {
      return true;
    }

    if (action?.action === 'advance_stage' && (action.targetStage === 'shortlist' || action.targetStage === 'commitment')) {
      return ids.length > 0;
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
      const recommendedIds = this.getRecommendedPropertyIds(state);
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
        const imageResult = await this.sendPropertyImages(
          customerPhone,
          imagesToSend,
          property.name,
          whatsappConfig
        );
        if (imageResult.sent > 0) {
          mediasSent.push('images');
        }
        if (!imageResult.success) {
          errors.push(`images: ${imageResult.errors.join('; ')}`);
        }
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
        const brochureResult = await this.sendPropertyBrochure(
          customerPhone,
          property.brochureUrl,
          property.name,
          whatsappConfig
        );
        if (brochureResult.success) {
          mediasSent.push('brochure');
        } else {
          errors.push(`brochure: ${brochureResult.error || 'send failed'}`);
        }
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
          let floorPlansSent = 0;
          for (const floorPlanUrl of property.floorPlanUrls.slice(0, 3)) {
            const result = await this.sendDocument(
              customerPhone,
              floorPlanUrl,
              `${property.name} - Floor Plan.pdf`,
              `Floor plan for ${property.name}`,
              whatsappConfig
            );
            if (result.success) {
              floorPlansSent++;
            } else if (this.resolveOutboundProviderName(whatsappConfig) !== 'meta') {
              const fallbackSent = await this.sendMessage(
                customerPhone,
                `Floor plan for ${property.name}: ${floorPlanUrl}`,
                whatsappConfig,
              );
              if (fallbackSent) {
                floorPlansSent++;
              }
            }
          }
          if (floorPlansSent > 0) {
            mediasSent.push('floor_plans');
          }
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
        const priceListResult = await this.sendDocument(
          customerPhone,
          property.priceListUrl,
          `${property.name} - Price List.pdf`,
          `Complete pricing details for ${property.name}`,
          whatsappConfig
        );
        if (priceListResult.success) {
          mediasSent.push('price_list');
        } else if (this.resolveOutboundProviderName(whatsappConfig) !== 'meta') {
          const fallbackSent = await this.sendMessage(
            customerPhone,
            `Complete pricing details for ${property.name}: ${property.priceListUrl}`,
            whatsappConfig,
          );
          if (fallbackSent) {
            mediasSent.push('price_list');
          } else {
            errors.push(`price_list: ${priceListResult.error || 'send failed'}`);
          }
        } else {
          errors.push(`price_list: ${priceListResult.error || 'send failed'}`);
        }
      } catch (error: any) {
        errors.push(`price_list: ${error.message}`);
        logger.error('Failed to send price list', {
          propertyId: property.id,
          error: error.message,
        });
      }
    }

    // 5. Send location pin if property has coordinates
    if (property.latitude !== null && property.latitude !== undefined && property.longitude !== null && property.longitude !== undefined) {
      try {
        const latitude = Number(property.latitude);
        const longitude = Number(property.longitude);
        const address = [
          property.locationArea,
          property.locationCity,
          property.locationPincode
        ].filter(Boolean).join(', ');

        const locationResult = await this.sendLocation(
          customerPhone,
          latitude,
          longitude,
          property.name,
          address || 'Property Location',
          whatsappConfig
        );
        if (locationResult.success) {
          mediasSent.push('location');
        } else if (this.resolveOutboundProviderName(whatsappConfig) !== 'meta') {
          const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
          const fallbackSent = await this.sendMessage(
            customerPhone,
            `Location: ${property.name}\n${address || 'Property Location'}\n${mapsUrl}`,
            whatsappConfig,
          );
          if (fallbackSent) {
            mediasSent.push('location');
          } else {
            errors.push(`location: ${locationResult.error || 'send failed'}`);
          }
        } else {
          errors.push(`location: ${locationResult.error || 'send failed'}`);
        }
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

export const whatsappService = new WhatsAppService();
