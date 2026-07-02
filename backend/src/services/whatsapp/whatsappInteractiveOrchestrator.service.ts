/**
 * Interactive button/list turn orchestrator.
 * Builds TurnResult payloads for tap flows — caller dispatches via sendTurnResult only.
 */
import type { PropertyType } from '@prisma/client';
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import type { InteractiveActionResult, TurnResult, WhatsAppComponent } from '../../types/whatsapp-turn.types';
import {
  enforceTurnComponentBudget,
  resolveHeroMediaComponentFromPropertyIds,
} from './whatsappTurnOrchestrator.service';
import { searchAlternativeTiers } from '../alternativeInventory.service';
import {
  clearConversationAwaitingCallTime,
  setConversationAwaitingCallTime,
} from '../../utils/conversationCallContext.util';
import {
  parseVisitTimeInteractiveId,
  resolveVisitSlotToDate,
} from '../visitBooking.service';
import { createVisitApprovalRequest, findPendingVisitApprovalForLead } from '../visitPendingApproval.service';
import { assignLeadRoundRobin } from '../leadAssignment.service';
import { formatBuyerVisitPendingApprovalReply } from '../../utils/visitFormat.util';
import { formatISTDateTime, formatISTDateTimeLong, formatISTShortDate, getISTDatePlusDays } from '../../utils/dateTime.util';
import { buildWhatsAppPropertyDetailFromAiInput, enrichAiPropertiesFromKnowledge, propertyToAiPromptInput } from '../propertyAiContext.service';
import { getPropertyKnowledgeForProperty } from '../propertyKnowledge.service';
import { getPropertyPromptLimits } from '../../utils/propertyPromptLimits.util';
import { confirmVisitById } from '../visitState.service';
import { maskPhone } from '../agent/tools/format-helpers';
import { logAgentAction } from '../agent-action-log.service';
import { getCompanyBrowseSnapshot, isFilterInCompanyInventory, buildDiscoveryButtonSet } from '../companyInventoryBrowse.service';
import {
  buildProjectPropertyListComponent,
  buildPropertyDetailButtons,
  companyUsesProjectBrowse,
  formatProjectCatalogIntro,
  formatProjectSelectedIntro,
  listProjectsForBuyerBrowse,
  loadProjectProperties,
  resolveProjectBrochureMediaComponent,
  resolveProjectHeroImageComponent,
  buildProjectSelectListComponent,
  buildActiveVisitActionButtons,
  hasEffectiveLocationData,
} from '../projectBrowse.service';
import { buyerButtonTitle, buyerFilterButtonTitle, resolveBuyerLanguage, tBuyer } from '../../utils/buyerI18n.util';
import config from '../../config';
import { evaluateSecondVisitPolicy } from '../buyer/buyerEnterpriseUx.service';
import { readBuyerConversationFocus } from '../buyer/buyerConversationFocus.service';
import { validateBuyerButtonSet } from '../buyer/buyerButtonScope.service';
import {
  buildInteractiveFocusNewState,
  type InteractiveConversationRow,
  type InteractiveFocusNewState,
} from './whatsappInteractivePersist.service';

export type InteractiveActionParams = {
  interactiveId: string;
  lead: {
    id: string;
    customerName?: string | null;
    phone: string;
    assignedAgentId?: string | null;
    propertyType?: string | null;
    budgetMin?: unknown;
    budgetMax?: unknown;
    locationPreference?: string | null;
    notes?: string | null;
    status?: string;
    language?: string | null;
  };
  conversation: InteractiveConversationRow & { id: string };
  company: { id: string; name?: string };
};

function leadLang(lead: InteractiveActionParams['lead']): string {
  return resolveBuyerLanguage({ leadLanguage: lead.language });
}

async function resolveVisitPropertyName(
  companyId: string,
  visit: { propertyId: string | null; property?: { name?: string | null } | null },
): Promise<string | null> {
  const fromRelation = visit.property?.name?.trim();
  if (fromRelation) return fromRelation;
  if (!visit.propertyId) return null;
  const row = await prisma.property.findFirst({
    where: { id: visit.propertyId, companyId },
    select: { name: true },
  });
  return row?.name?.trim() ?? null;
}

function localizedCallActionButtons(lang: string): WhatsAppComponent {
  return {
    kind: 'buttons',
    buttons: [
      { id: 'call-reschedule', title: buyerButtonTitle(lang, 'change_time') },
      { id: 'call-cancel', title: buyerButtonTitle(lang, 'cancel_call') },
      { id: 'call-me', title: buyerButtonTitle(lang, 'call_agent') },
    ],
  };
}

function buyerTurn(text: string, components?: WhatsAppComponent[]): TurnResult {
  return {
    audience: 'buyer',
    handled: true,
    text,
    components: components?.length ? components : undefined,
    replyPacing: 'none',
  };
}

function interactiveFocusEnabled(): boolean {
  return config.features.buyerFocusStack === true;
}

function focusNewState(
  conversation: InteractiveConversationRow,
  patch: Parameters<typeof buildInteractiveFocusNewState>[1],
): InteractiveFocusNewState {
  return buildInteractiveFocusNewState(conversation, patch);
}

function validateInteractivePropertyScope(input: {
  propertyId: string | null | undefined;
  conversation: InteractiveConversationRow;
  visitPropertyId?: string | null;
  explicitSuffix: boolean;
}): boolean {
  if (!interactiveFocusEnabled() || !input.propertyId) return true;
  if (input.explicitSuffix) return true;
  const focus = readBuyerConversationFocus({
    selectedPropertyId: input.conversation.selectedPropertyId ?? null,
    recommendedPropertyIds: input.conversation.recommendedPropertyIds,
    commitments: input.conversation.commitments,
  });
  if (!focus.allowedPropertyIds.length) return true;
  if (input.visitPropertyId && input.propertyId === input.visitPropertyId) return true;
  return focus.allowedPropertyIds.includes(input.propertyId);
}

function scopeValidateButtons(
  component: WhatsAppComponent,
  ctx: {
    conversation: InteractiveConversationRow;
    visitPropertyId?: string | null;
    hasActiveVisit?: boolean;
    language: string;
  },
): WhatsAppComponent {
  if (!interactiveFocusEnabled() || !config.features.buttonScopeValidate) return component;
  if (component.kind !== 'buttons') return component;
  const focus = readBuyerConversationFocus({
    selectedPropertyId: ctx.conversation.selectedPropertyId ?? null,
    recommendedPropertyIds: ctx.conversation.recommendedPropertyIds,
    commitments: ctx.conversation.commitments,
  });
  return {
    ...component,
    buttons: validateBuyerButtonSet(component.buttons, {
      allowedPropertyIds: focus.allowedPropertyIds,
      visitPropertyId: ctx.visitPropertyId,
      hasActiveVisit: ctx.hasActiveVisit,
      language: ctx.language,
    }),
  };
}

/** Persist buyer-visible interactive reply text for dashboard/E2E (idempotent within 15s). */
export async function persistInteractiveAiTranscript(
  conversationId: string,
  text: string | undefined,
  // INVESTO-FIX-2026-07-01: flag whether this turn also carried buttons/list components
  hasComponents?: boolean,
): Promise<void> {
  const content = text?.trim();
  if (!content) return;

  const recent = await prisma.message.findFirst({
    where: {
      conversationId,
      senderType: 'ai',
      content,
      createdAt: { gte: new Date(Date.now() - 15_000) },
    },
    select: { id: true },
  });
  if (recent) return;

  await prisma.message.create({
    data: {
      conversationId,
      senderType: 'ai',
      content,
      status: 'sent',
      // INVESTO-FIX-2026-07-01: mark as interactive so the frontend knows buttons/list accompanied this reply
      ...(hasComponents ? { messageType: 'interactive' } : {}),
    },
  });
}

async function finalizeInteractiveResult(
  conversationId: string,
  result: InteractiveActionResult | null,
): Promise<InteractiveActionResult | null> {
  if (result?.turnResult?.text?.trim()) {
    await persistInteractiveAiTranscript(
      conversationId,
      result.turnResult.text,
      Boolean(result.turnResult.components?.length),
    );
  }
  return result;
}

async function routeInteractiveAction(
  params: InteractiveActionParams,
): Promise<InteractiveActionResult | null> {
  const { interactiveId } = params;

  if (interactiveId === 'visit-confirm') return handleVisitConfirm(params);
  if (interactiveId === 'visit-reschedule') return handleVisitReschedule(params);
  if (interactiveId.startsWith('visit-time-')) return handleVisitTimeSlot(params);
  if (interactiveId === 'book-visit' || interactiveId.startsWith('book-visit-')) {
    return handleBookVisit(params);
  }
  if (interactiveId === 'visit-slot-morning' || interactiveId === 'visit-slot-afternoon') {
    return handleGenericVisitSlot(params);
  }
  if (interactiveId === 'call-me' || interactiveId === 'callback-request') return handleCallMe(params);
  if (interactiveId === 'share-visit-feedback') return handleShareVisitFeedback(params);
  if (interactiveId === 'call-cancel') return handleCallCancel(params);
  if (interactiveId === 'call-reschedule') return handleCallReschedule(params);
  if (interactiveId === 'more-info' || interactiveId.startsWith('more-info-')) {
    return handleMoreInfo(params);
  }
  if (interactiveId.startsWith('project-select-')) return handleProjectSelect(params);
  if (interactiveId.startsWith('project-properties-')) return handleProjectProperties(params);
  if (interactiveId === 'browse-projects') return handleBrowseProjects(params);
  if (interactiveId.startsWith('filter-')) return handlePropertyFilter(params);

  return null;
}

function buildVisitSlotButtons(propertyId: string): WhatsAppComponent {
  const tomorrow = getISTDatePlusDays(1);
  const dayAfter = getISTDatePlusDays(2);
  const pid = propertyId || 'x';
  return {
    kind: 'buttons',
    buttons: [
      { id: `visit-time-${pid}-tomorrow-10am`, title: `${formatISTShortDate(tomorrow)} 10AM` },
      { id: `visit-time-${pid}-tomorrow-3pm`, title: `${formatISTShortDate(tomorrow)} 3PM` },
      { id: `visit-time-${pid}-dayafter`, title: `${formatISTShortDate(dayAfter)}` },
    ],
  };
}

async function handleVisitConfirm(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { lead, company } = params;
  const lang = leadLang(lead);
  const existingVisit = await prisma.visit.findFirst({
    where: { leadId: lead.id, status: { in: ['scheduled', 'confirmed'] } },
    orderBy: { scheduledAt: 'asc' },
    include: { property: { select: { name: true } } },
  });

  if (!existingVisit) {
    return {
      handled: true,
      action: 'visit-confirm-no-visit',
      turnResult: buyerTurn(tBuyer(lang, 'interactive_visit_confirm_no_visit')),
    };
  }

  const confirmResult = await confirmVisitById({
    companyId: company.id,
    visitId: existingVisit.id,
    suppressCustomerNotification: true,
  });
  if (!confirmResult.success) {
    return {
      handled: true,
      action: 'visit-confirm-failed',
      turnResult: buyerTurn(tBuyer(lang, 'interactive_visit_confirm_failed')),
    };
  }

  const visitDate = formatISTDateTimeLong(new Date(existingVisit.scheduledAt));
  const propName = (existingVisit.property as { name?: string })?.name ?? 'the property';

  logger.info('Visit confirmed via interactive CTA', { visitId: existingVisit.id, leadId: lead.id });
  return {
    handled: true,
    action: 'visit-confirmed',
    leadStatus: 'visit_scheduled',
    turnResult: buyerTurn(
      tBuyer(lang, 'interactive_visit_confirmed', {
        property: propName,
        date: visitDate,
      }),
    ),
  };
}

async function handleVisitReschedule(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { lead, company } = params;
  const lang = leadLang(lead);
  const existingVisit = await prisma.visit.findFirst({
    where: { leadId: lead.id, status: { in: ['scheduled', 'confirmed'] } },
    orderBy: { scheduledAt: 'asc' },
    include: { property: { select: { name: true, id: true } } },
  });

  if (!existingVisit) {
    const pending = await findPendingVisitApprovalForLead({
      companyId: company.id,
      leadId: lead.id,
    });
    if (pending) {
      return {
        handled: true,
        action: 'visit-reschedule-pending-approval',
        newState: focusNewState(params.conversation, {
          stage: 'visit_booking',
          focusedPropertyId: pending.propertyId,
          selectedPropertyId: pending.propertyId,
        }),
        turnResult: buyerTurn(
          tBuyer(lang, 'interactive_visit_reschedule_prompt', {
            property: pending.propertyName || tBuyer(lang, 'property_not_selected_yet'),
          }),
          [buildVisitSlotButtons(pending.propertyId)],
        ),
      };
    }
    return {
      handled: true,
      action: 'visit-reschedule-no-visit',
      turnResult: buyerTurn(tBuyer(lang, 'interactive_visit_reschedule_no_visit')),
    };
  }

  const propertyId = (existingVisit.property as { id?: string })?.id ?? '';
  const propName = (existingVisit.property as { name?: string })?.name ?? 'the property';

  return {
    handled: true,
    action: 'visit-reschedule-initiated',
    turnResult: buyerTurn(
      tBuyer(lang, 'interactive_visit_reschedule_prompt', { property: propName }),
      [buildVisitSlotButtons(propertyId)],
    ),
  };
}

async function handleBookVisit(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { interactiveId, lead, conversation, company } = params;
  const lang = leadLang(lead);

  const pending = await findPendingVisitApprovalForLead({
    companyId: company.id,
    leadId: lead.id,
  });
  if (pending) {
    const agent = await prisma.user.findUnique({
      where: { id: pending.agentId },
      select: { name: true },
    });
    const pendingProperty = pending.propertyId
      ? await prisma.property.findFirst({
          where: { id: pending.propertyId, companyId: company.id },
          select: { projectId: true },
        })
      : null;
    const pendingButtons = buildActiveVisitActionButtons(
      pendingProperty?.projectId ?? null,
      lang,
    );
    return {
      handled: true,
      action: 'book-visit-already-pending',
      newState: focusNewState(conversation, {
        stage: 'visit_booking',
        focusedPropertyId: pending.propertyId,
        selectedPropertyId: pending.propertyId,
      }),
      turnResult: buyerTurn(
        formatBuyerVisitPendingApprovalReply(new Date(pending.scheduledAt), agent?.name),
        [pendingButtons],
      ),
    };
  }

  const explicitSuffix = interactiveId.replace('book-visit-', '') !== 'book-visit';
  const propertyId = explicitSuffix
    ? interactiveId.replace('book-visit-', '')
    : conversation.selectedPropertyId;

  if (!propertyId) {
    return {
      handled: true,
      action: 'book-visit-no-property',
      turnResult: buyerTurn(tBuyer(lang, 'interactive_book_visit_no_property')),
    };
  }

  if (
    interactiveFocusEnabled()
    && !validateInteractivePropertyScope({
      propertyId,
      conversation,
      explicitSuffix,
    })
  ) {
    return {
      handled: true,
      action: 'book-visit-out-of-scope',
      turnResult: buyerTurn(tBuyer(lang, 'property_not_selected_yet')),
    };
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, companyId: company.id, status: { in: ['available', 'upcoming'] } },
  });

  if (!property) {
    return {
      handled: true,
      action: 'book-visit-invalid-property',
      turnResult: buyerTurn(tBuyer(lang, 'interactive_book_visit_invalid_property')),
    };
  }

  if (interactiveFocusEnabled() && config.features.secondVisitPolicy) {
    const activeVisitForPolicy = await prisma.visit.findFirst({
      where: { leadId: lead.id, status: { in: ['scheduled', 'confirmed'] } },
      orderBy: { scheduledAt: 'asc' },
      include: { property: { select: { projectId: true, name: true } } },
    });
    if (activeVisitForPolicy) {
      const decision = evaluateSecondVisitPolicy({
        hasActiveVisit: true,
        activeVisitPropertyId: activeVisitForPolicy.propertyId,
        activeVisitProjectId: activeVisitForPolicy.property?.projectId ?? null,
        targetPropertyId: property.id,
        targetProjectId: property.projectId,
        explicitCrossProjectIntent: true,
      });
      if ('clarify' in decision && decision.clarify) {
        return {
          handled: true,
          action: 'book-visit-clarify',
          turnResult: buyerTurn(tBuyer(lang, decision.messageKey, {
            existingProperty: activeVisitForPolicy.property?.name ?? 'your booked property',
            targetProperty: property.name,
          })),
        };
      }
      if ('allow' in decision && !decision.allow && decision.reason === 'same_property_already_booked') {
        const visitDate = formatISTDateTimeLong(new Date(activeVisitForPolicy.scheduledAt));
        const visitButtons = buildActiveVisitActionButtons(
          activeVisitForPolicy.property?.projectId ?? property.projectId,
          lang,
        );
        return {
          handled: true,
          action: 'book-visit-same-property',
          turnResult: buyerTurn(
            tBuyer(lang, 'visit_booked_property_reminder', {
              property: activeVisitForPolicy.property?.name ?? property.name,
              date: visitDate,
            }),
            visitButtons.kind === 'buttons' ? [visitButtons] : [],
          ),
        };
      }
    }
  }

  if (lead.assignedAgentId) {
    await prisma.notification.create({
      data: {
        companyId: company.id,
        userId: lead.assignedAgentId,
        type: 'visit_scheduled',
        title: '📅 Visit Interest - Action Required',
        message: `${lead.customerName || lead.phone} wants to visit ${property.name}`,
        data: { leadId: lead.id, propertyId: property.id, propertyName: property.name },
      },
    });
  }

  // The buyer pivoted to visit scheduling: a stale awaiting-call-time marker from an
  // earlier callback flow must not steal their next bare time reply ("Tomorrow at 1pm").
  await clearConversationAwaitingCallTime(conversation.id).catch(() => undefined);

  return {
    handled: true,
    action: 'book-visit-initiated',
    newState: focusNewState(conversation, {
      stage: 'visit_booking',
      focusedPropertyId: propertyId,
      focusedProjectId: property.projectId,
      selectedPropertyId: propertyId,
    }),
    turnResult: buyerTurn(
      tBuyer(lang, 'interactive_book_visit_initiated', { property: property.name }),
      [buildVisitSlotButtons(propertyId)],
    ),
  };
}

async function handleShareVisitFeedback(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const lang = leadLang(params.lead);
  return {
    handled: true,
    action: 'share-visit-feedback',
    turnResult: buyerTurn(tBuyer(lang, 'interactive_share_feedback')),
  };
}

async function handleCallMe(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { lead, company } = params;
  const lang = leadLang(lead);
  const { scheduleCallRequest, formatBuyerCallReply } = await import('../callRequest.service');
  const { resolveCallScheduledAt } = await import('../../utils/callIntentFromMessage.util');

  const scheduledAt = resolveCallScheduledAt('call me');
  const booked = await scheduleCallRequest({
    companyId: company.id,
    leadId: lead.id,
    scheduledAt,
    notes: 'Call Me button',
    agentId: lead.assignedAgentId ?? undefined,
  });

  if (!booked.success || !booked.call) {
    await setConversationAwaitingCallTime(params.conversation.id).catch(() => undefined);
    return {
      handled: true,
      action: 'callback-requested',
      turnResult: buyerTurn(tBuyer(lang, 'interactive_call_time_prompt')),
    };
  }

  const agent = booked.call
    ? await prisma.user.findUnique({ where: { id: booked.call.agent_id }, select: { name: true } })
    : null;

  return {
    handled: true,
    action: 'callback-requested',
    leadStatus: 'contacted',
    turnResult: buyerTurn(formatBuyerCallReply('Callback request sent', scheduledAt, agent?.name), [
      localizedCallActionButtons(lang),
    ]),
  };
}

async function handleCallCancel(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { lead, company } = params;
  const lang = leadLang(lead);
  const { findActiveCallRequest, cancelCallRequest, notifyAgentCallChangeRequested } = await import('../callRequest.service');
  const active = await findActiveCallRequest({ companyId: company.id, leadId: lead.id });
  if (!active) {
    return {
      handled: true,
      action: 'callback-cancelled',
      turnResult: buyerTurn(tBuyer(lang, 'interactive_call_cancel_not_found')),
    };
  }
  if (active.status === 'confirmed') {
    await notifyAgentCallChangeRequested({
      companyId: company.id,
      callId: active.id,
      messageText: 'Customer tapped cancel on a confirmed callback',
    }).catch(() => undefined);
    return {
      handled: true,
      action: 'callback-change-requested',
      turnResult: buyerTurn(tBuyer(lang, 'interactive_call_cancel_confirmed')),
    };
  }
  await cancelCallRequest({ companyId: company.id, callId: active.id });
  return {
    handled: true,
    action: 'callback-cancelled',
    turnResult: buyerTurn(tBuyer(lang, 'interactive_call_cancelled')),
  };
}

async function handleCallReschedule(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { lead, company } = params;
  const lang = leadLang(lead);
  const { findActiveCallRequest } = await import('../callRequest.service');
  const active = await findActiveCallRequest({ companyId: company.id, leadId: lead.id });
  if (!active) {
    return {
      handled: true,
      action: 'callback-reschedule-no-active-callback',
      turnResult: buyerTurn(tBuyer(lang, 'interactive_call_reschedule_not_found')),
    };
  }
  await setConversationAwaitingCallTime(params.conversation.id).catch(() => undefined);
  return {
    handled: true,
    action: 'callback-reschedule-prompt',
    turnResult: buyerTurn(tBuyer(lang, 'interactive_call_reschedule_prompt')),
  };
}

async function handleMoreInfo(params: InteractiveActionParams): Promise<InteractiveActionResult | null> {
  const { interactiveId, lead, conversation, company } = params;
  const lang = resolveBuyerLanguage({ leadLanguage: lead.language });
  const explicitSuffix = interactiveId.replace('more-info-', '') !== 'more-info';
  const propertyId = explicitSuffix
    ? interactiveId.replace('more-info-', '')
    : conversation.selectedPropertyId;

  if (!propertyId) {
    return {
      handled: true as const,
      turnResult: buyerTurn(tBuyer(lang, 'property_not_selected_yet')),
    };
  }

  const activeVisitEarly = await prisma.visit.findFirst({
    where: { leadId: lead.id, status: { in: ['scheduled', 'confirmed'] } },
    orderBy: { scheduledAt: 'asc' },
    select: { propertyId: true },
  });

  if (
    interactiveFocusEnabled()
    && explicitSuffix
    && !validateInteractivePropertyScope({
      propertyId,
      conversation,
      visitPropertyId: activeVisitEarly?.propertyId,
      explicitSuffix,
    })
  ) {
    return {
      handled: true as const,
      turnResult: buyerTurn(tBuyer(lang, 'property_not_selected_yet')),
    };
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, companyId: company.id, status: { in: ['available', 'upcoming'] } },
    include: {
      project: {
        select: {
          locationArea: true,
          locationCity: true,
          locationPincode: true,
          latitude: true,
          longitude: true,
        },
      },
    },
  });
  if (!property) {
    return {
      handled: true as const,
      turnResult: buyerTurn(tBuyer(lang, 'property_no_longer_available')),
    };
  }

  const activeVisit = await prisma.visit.findFirst({
    where: { leadId: lead.id, status: { in: ['scheduled', 'confirmed'] } },
    orderBy: { scheduledAt: 'asc' },
    include: { property: { select: { id: true, name: true, projectId: true } } },
  });
  const pendingApproval = activeVisit
    ? null
    : await findPendingVisitApprovalForLead({ companyId: company.id, leadId: lead.id });

  const visitDate = activeVisit
    ? formatISTDateTimeLong(new Date(activeVisit.scheduledAt))
    : pendingApproval
      ? formatISTDateTimeLong(new Date(pendingApproval.scheduledAt))
      : null;

  const bookedPropertyId = activeVisit?.propertyId ?? null;
  const isBookedPropertyTap = Boolean(bookedPropertyId && bookedPropertyId === propertyId);
  const bookedPropertyName = activeVisit
    ? await resolveVisitPropertyName(company.id, activeVisit)
    : null;

  if (isBookedPropertyTap && visitDate) {
    const reminderPropertyName = bookedPropertyName ?? property.name;
    const outboundText = tBuyer(lang, 'visit_booked_property_reminder', {
      property: reminderPropertyName,
      date: visitDate,
    });
    const buttonComponent = scopeValidateButtons(
      buildActiveVisitActionButtons(property.projectId, lang),
      {
        conversation,
        visitPropertyId: bookedPropertyId,
        hasActiveVisit: true,
        language: lang,
      },
    );
    // Re-tapping the already-focused property must not resend the same images.
    const alreadyFocusedBooked = conversation.selectedPropertyId === propertyId;
    const hero = alreadyFocusedBooked
      ? undefined
      : await resolveHeroMediaComponentFromPropertyIds(company.id, [property.id]);
    const { resolvePropertyDetailMediaComponents } = await import('../brochureDelivery.service');
    const detailMedia = alreadyFocusedBooked
      ? []
      : await resolvePropertyDetailMediaComponents({
          companyId: company.id,
          property: {
            id: property.id,
            name: property.name,
            brochureUrl: property.brochureUrl,
            images: property.images,
          },
        });
    const components = enforceTurnComponentBudget([
      ...detailMedia,
      buttonComponent,
      ...(detailMedia.length === 0 && hero ? [hero] : []),
    ]);
    return {
      handled: true,
      action: 'more-info-booked-property',
      newState: focusNewState(conversation, {
        focusedPropertyId: propertyId,
        focusedProjectId: property.projectId,
        selectedPropertyId: propertyId,
      }),
      turnResult: buyerTurn(outboundText, components),
    };
  }

  const promptLimits = getPropertyPromptLimits();
  let promptInput = propertyToAiPromptInput(property);
  const [enriched] = await enrichAiPropertiesFromKnowledge(
    company.id,
    [promptInput],
    getPropertyKnowledgeForProperty,
  );
  promptInput = enriched;

  let details = buildWhatsAppPropertyDetailFromAiInput(promptInput, lang);

  const knowledgeChunks = await getPropertyKnowledgeForProperty(
    company.id,
    property.id,
    promptLimits.moreInfoKnowledgeFetch,
  );
  const extraFacts = knowledgeChunks
    .map((chunk) => chunk.content.trim())
    .filter((content) => content && !details.toLowerCase().includes(content.slice(0, 60).toLowerCase()))
    .slice(0, promptLimits.moreInfoKnowledgeAppend);
  if (extraFacts.length > 0) {
    details = `${details}\n\n${tBuyer(lang, 'more_from_records')}\n${extraFacts.join('\n\n')}`;
  }

  let outboundText = details;
  const buttonComponent = scopeValidateButtons(
    buildPropertyDetailButtons(propertyId, property.projectId, lang, {
      hasLocation: hasEffectiveLocationData(property, property.project ?? null),
    }),
    {
      conversation,
      visitPropertyId: activeVisit?.propertyId,
      hasActiveVisit: Boolean(activeVisit),
      language: lang,
    },
  );

  if (activeVisit && visitDate && !isBookedPropertyTap) {
    const visitProjectId =
      (activeVisit.property as { projectId?: string | null })?.projectId ?? null;
    const noteKey =
      activeVisit.status === 'confirmed'
        ? 'visit_browsing_other_confirmed_note'
        : 'visit_browsing_other_scheduled_note';
    const visitNote = bookedPropertyName
      ? tBuyer(lang, noteKey, {
          viewing: property.name,
          booked: bookedPropertyName,
          date: visitDate,
        })
      : tBuyer(lang, 'visit_browsing_other_date_only_note', {
          viewing: property.name,
          date: visitDate,
        });
    outboundText = `${details}\n\n${visitNote}`;
  } else if (pendingApproval && visitDate) {
    const visitPropName = pendingApproval.propertyName ?? 'the property';
    outboundText =
      `${tBuyer(lang, 'visit_pending_approval_prefix', { property: visitPropName, date: visitDate })}\n\n` + details;
  }

  // A repeat "View Listing"/"More Info" tap on the property already in focus keeps
  // the fresh details text but must not resend the same image/brochure payloads.
  const alreadyFocused = conversation.selectedPropertyId === propertyId;
  const { resolvePropertyDetailMediaComponents } = await import('../brochureDelivery.service');
  const detailMedia = alreadyFocused
    ? []
    : await resolvePropertyDetailMediaComponents({
        companyId: company.id,
        property: {
          id: property.id,
          name: property.name,
          brochureUrl: property.brochureUrl,
          images: property.images,
        },
      });

  const components = enforceTurnComponentBudget([
    ...detailMedia,
    buttonComponent,
  ]);

  return {
    handled: true,
    action: 'more-info-sent',
    newState: focusNewState(conversation, {
      focusedPropertyId: propertyId,
      focusedProjectId: property.projectId,
      selectedPropertyId: propertyId,
    }),
    turnResult: buyerTurn(outboundText, components),
  };
}

async function resolveInteractiveBrochure(input: {
  customerMessage: string;
  aiText: string;
  properties: Array<{ id: string; name: string; brochureUrl: string | null }>;
}): Promise<{
  cleanedText: string;
  mediaComponent: { kind: 'media'; url: string; mime: string; caption?: string } | null;
}> {
  const brochureModule = await import('../brochureDelivery.service');
  if (typeof brochureModule.resolveBrochureForAiTurn !== 'function') {
    return { cleanedText: input.aiText, mediaComponent: null };
  }
  return brochureModule.resolveBrochureForAiTurn(input);
}

async function handleProjectSelect(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { interactiveId, lead, conversation, company } = params;
  const projectId = interactiveId.replace('project-select-', '');
  const lang = resolveBuyerLanguage({ leadLanguage: lead.language });

  const loaded = await loadProjectProperties(company.id, projectId);
  if (!loaded) {
    return {
      handled: true,
      action: 'project-not-found',
      turnResult: buyerTurn(
        tBuyer(lang, 'project_browse_none'),
      ),
    };
  }

  let outboundText = formatProjectSelectedIntro(
    loaded.project.name,
    loaded.properties.length,
    lang,
    loaded.hiddenListingCount,
  );
  if (loaded.properties.length > 10) {
    outboundText += `\n\n${tBuyer(lang, 'showing_listings_truncated', { total: loaded.properties.length })}`;
  }

  const mediaComponents: WhatsAppComponent[] = [];
  const brochure = await resolveProjectBrochureMediaComponent(
    company.id,
    projectId,
    loaded.project.name,
  );
  if (brochure) {
    mediaComponents.push(brochure);
  }
  const hero = await resolveProjectHeroImageComponent(company.id, projectId, loaded.project.name);
  if (hero) mediaComponents.push(hero);

  const listComponent = buildProjectPropertyListComponent(
    projectId,
    loaded.project.name,
    loaded.properties,
    lang,
  );

  const recommendedIds = loaded.properties.slice(0, 10).map((p) => p.id);
  const components = enforceTurnComponentBudget([...mediaComponents, listComponent]);

  return {
    handled: true,
    action: 'project-selected',
    newState: focusNewState(conversation, {
      stage: 'shortlist',
      focusedProjectId: projectId,
      focusedPropertyId: null,
      recommendedPropertyIds: recommendedIds,
    }),
    turnResult: buyerTurn(outboundText, components),
  };
}

async function handleBrowseProjects(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { lead, company, conversation } = params;
  const lang = resolveBuyerLanguage({ leadLanguage: lead.language });

  const usesProjects = await companyUsesProjectBrowse(company.id);
  if (!usesProjects) {
    return {
      handled: true,
      action: 'browse-projects-unavailable',
      turnResult: buyerTurn(tBuyer(lang, 'project_browse_none')),
    };
  }

  const projects = await listProjectsForBuyerBrowse(company.id);
  if (!projects.length) {
    return {
      handled: true,
      action: 'browse-projects-empty',
      turnResult: buyerTurn(tBuyer(lang, 'project_browse_none')),
    };
  }

  const reply = formatProjectCatalogIntro(projects, lang);
  const listComponent = buildProjectSelectListComponent(projects, lang);
  const components = enforceTurnComponentBudget([listComponent]);

  return {
    handled: true,
    action: 'browse-projects',
    newState: interactiveFocusEnabled()
      ? focusNewState(conversation, {
        focusedProjectId: null,
        focusedPropertyId: null,
        recommendedPropertyIds: [],
      })
      : undefined,
    turnResult: buyerTurn(reply, components),
  };
}

async function handleProjectProperties(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { interactiveId, lead, conversation, company } = params;
  const projectId = interactiveId.replace('project-properties-', '');
  const lang = resolveBuyerLanguage({ leadLanguage: lead.language });

  const loaded = await loadProjectProperties(company.id, projectId);
  if (!loaded) {
    return {
      handled: true,
      action: 'project-properties-not-found',
      turnResult: buyerTurn(tBuyer(lang, 'project_browse_none')),
    };
  }

  let outboundText = `*${loaded.project.name}* — ${tBuyer(lang, 'choose_property').toLowerCase()}:`;
  if (loaded.properties.length > 10) {
    outboundText += `\n\n${tBuyer(lang, 'showing_listings_truncated', { total: loaded.properties.length })}`;
  }

  const listComponent = buildProjectPropertyListComponent(
    projectId,
    loaded.project.name,
    loaded.properties,
    lang,
  );

  const recommendedIds = loaded.properties.slice(0, 10).map((p) => p.id);

  return {
    handled: true,
    action: 'project-properties-list',
    newState: focusNewState(conversation, {
      focusedProjectId: projectId,
      focusedPropertyId: null,
      recommendedPropertyIds: recommendedIds,
    }),
    turnResult: buyerTurn(outboundText, [listComponent]),
  };
}

async function handlePropertyFilter(params: InteractiveActionParams): Promise<InteractiveActionResult | null> {
  const { interactiveId, lead, conversation, company } = params;
  const lang = leadLang(lead);
  const filterValue = interactiveId.replace('filter-', '');

  const filterMap: Record<
    string,
    { propertyType?: string; bedrooms?: number }
  > = {
    '1bhk': { bedrooms: 1 },
    '2bhk': { bedrooms: 2 },
    '3bhk': { bedrooms: 3 },
    '4bhk': { bedrooms: 4 },
    '5bhk': { bedrooms: 5 },
    villa: { propertyType: 'villa' },
    apartment: { propertyType: 'apartment' },
    plot: { propertyType: 'plot' },
    commercial: { propertyType: 'commercial' },
  };

  const filter = filterMap[filterValue.toLowerCase()];
  if (!filter) return null;

  const filterDisplayName = buyerFilterButtonTitle(lang, filterValue.toLowerCase());

  const browseSnapshot = await getCompanyBrowseSnapshot(company.id);
  if (!isFilterInCompanyInventory(browseSnapshot, filterValue)) {
    const hint = browseSnapshot.totalListings
      ? tBuyer(lang, 'filter_inventory_hint', { typeSummary: browseSnapshot.typeSummary })
      : tBuyer(lang, 'filter_inventory_empty');
    return {
      handled: true,
      action: 'filter-not-in-inventory',
      turnResult: buyerTurn(
        tBuyer(lang, 'filter_not_in_catalog', { filter: filterDisplayName, hint }),
        [{ kind: 'buttons', buttons: buildDiscoveryButtonSet(browseSnapshot, lang) }],
      ),
    };
  }

  const recentFilterAction = await prisma.message.findFirst({
    where: {
      conversationId: conversation.id,
      content: { contains: `Filter applied: ${filterDisplayName}` },
      createdAt: { gte: new Date(Date.now() - 30_000) },
    },
  });
  if (recentFilterAction) {
    const lastFilterReply = await prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        senderType: 'ai',
        createdAt: { gte: new Date(Date.now() - 120_000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    return {
      handled: true,
      action: 'filter-duplicate-prevented',
      turnResult: buyerTurn(
        lastFilterReply?.content?.trim()
          || tBuyer(lang, 'filter_already_viewing', { filter: filterDisplayName }),
      ),
    };
  }

  try {
    const leadUpdateData: { propertyType?: PropertyType; notes?: string } = {};
    if (filter.propertyType) {
      leadUpdateData.propertyType = filter.propertyType as PropertyType;
    }
    if (filter.bedrooms) {
      leadUpdateData.notes = lead.notes
        ? `${lead.notes}; Prefers ${filter.bedrooms} BHK`
        : `Prefers ${filter.bedrooms} BHK`;
    }
    const updatedLead = Object.keys(leadUpdateData).length
      ? await prisma.lead.update({ where: { id: lead.id }, data: leadUpdateData })
      : lead;

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { stage: 'shortlist' as any, stageEnteredAt: new Date(), stageMessageCount: 0 },
    });

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType: 'customer',
        content: `Filter applied: ${filterDisplayName}`,
        status: 'sent',
      },
    });

    const browseFilters = {
      propertyType: filter.propertyType,
      bedrooms: filter.bedrooms,
    };

    if (await companyUsesProjectBrowse(company.id)) {
      const projects = await listProjectsForBuyerBrowse(company.id, browseFilters);
      if (!projects.length) {
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
          tBuyer(lang, 'catalog_empty_type', { type: filterDisplayName });
        return {
          handled: true,
          action: 'filter-no-project-results',
          newState: { stage: 'qualify' },
          turnResult: buyerTurn(topHint),
        };
      }

      const reply = formatProjectCatalogIntro(projects, lang);
      const listComponent = buildProjectSelectListComponent(projects, lang);
      const snapshot = await getCompanyBrowseSnapshot(company.id);
      const filterButtons = buildDiscoveryButtonSet(snapshot, lang);
      const components = enforceTurnComponentBudget([
        listComponent,
        ...(filterButtons.length
          ? [{ kind: 'buttons' as const, buttons: filterButtons }]
          : []),
      ]);

      logger.info('Project filter applied', {
        filter: filterDisplayName,
        projectCount: projects.length,
        conversationId: conversation.id,
      });

      return {
        handled: true,
        action: 'filter-applied-projects',
        newState: { stage: 'shortlist' },
        turnResult: buyerTurn(
          tBuyer(lang, 'filter_applied_projects', { filter: filterDisplayName, reply }),
          components,
        ),
      };
    }

    const propertyWhere: Record<string, unknown> = {
      companyId: company.id,
      status: { in: ['available', 'upcoming'] },
    };
    if (filter.propertyType) propertyWhere.propertyType = filter.propertyType;
    if (filter.bedrooms) propertyWhere.bedrooms = filter.bedrooms;
    if (updatedLead.budgetMin || updatedLead.budgetMax) {
      propertyWhere.AND = [];
      if (updatedLead.budgetMin) {
        (propertyWhere.AND as unknown[]).push({ priceMin: { gte: updatedLead.budgetMin } });
      }
      if (updatedLead.budgetMax) {
        (propertyWhere.AND as unknown[]).push({ priceMax: { lte: updatedLead.budgetMax } });
      }
    }

    const properties = await prisma.property.findMany({
      where: propertyWhere as any,
      take: 10,
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
        tBuyer(lang, 'catalog_empty_type', { type: filterDisplayName });
      let body = topHint;
      const altProp = tiers[0]?.properties?.[0];
      if (altProp) {
        body += `\n\n${tBuyer(lang, 'filter_closest_option', {
          name: altProp.name,
          location: altProp.locationArea || altProp.locationCity || 'TBD',
        })}`;
      }
      body += `\n\n${tBuyer(lang, 'filter_waitlist_cta')}`;

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          commitments: {
            ...((conversation.commitments as object) || {}),
            waitlist: true,
            waitlistCriteria: filterDisplayName,
          },
        },
      });

      return {
        handled: true,
        action: 'filter-no-results-alternatives',
        newState: { stage: 'qualify' },
        turnResult: buyerTurn(body),
      };
    }

    const formatListPrice = (p: (typeof properties)[0]) => {
      const min = p.priceMin ? Number(p.priceMin) : null;
      if (min) return `₹${(min / 100000).toFixed(0)}L`;
      return 'Call';
    };

    const propertyIds = properties.map((p) => p.id);
    const listText = tBuyer(lang, 'filter_applied_list', {
      count: properties.length,
      filter: filterDisplayName,
      unitLabel: properties.length === 1 ? 'property' : 'properties',
    });

    const listComponent: WhatsAppComponent = {
      kind: 'list',
      title: tBuyer(lang, 'browse_list_title').slice(0, 24),
      sections: [
        {
          title: `${filterDisplayName} (${properties.length})`.slice(0, 24),
          rows: properties.slice(0, 10).map((p) => ({
            id: `prop-${p.id}`,
            title: p.name.substring(0, 24),
            description: `${formatListPrice(p)} - ${p.locationArea || p.locationCity || 'TBD'}`.substring(
              0,
              72,
            ),
          })),
        },
      ],
    };

    const hero = await resolveHeroMediaComponentFromPropertyIds(company.id, propertyIds);
    const components = enforceTurnComponentBudget([listComponent, ...(hero ? [hero] : [])]);

    logger.info('Filter applied successfully', {
      filter: filterDisplayName,
      matchCount: properties.length,
      conversationId: conversation.id,
      leadId: lead.id,
    });

    return {
      handled: true,
      action: 'filter-applied',
      newState: focusNewState(conversation, {
        stage: 'shortlist',
        recommendedPropertyIds: propertyIds,
        focusedPropertyId: null,
      }),
      turnResult: buyerTurn(listText, components),
    };
  } catch (error: unknown) {
    logger.error('Filter application failed', {
      error: error instanceof Error ? error.message : String(error),
      filter: filterValue,
      conversationId: conversation.id,
    });
    return {
      handled: true,
      action: 'filter-error',
      turnResult: buyerTurn(
        tBuyer(lang, 'filter_error', { filter: filterDisplayName }),
      ),
    };
  }
}

/**
 * Book a visit from a visit-time-{propertyId}-{slot} button.
 * Returns a single TurnResult — caller dispatches via sendTurnResult only.
 */
async function handleVisitTimeSlot(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { interactiveId, lead, conversation, company } = params;
  const lang = leadLang(lead);
  const parsed = parseVisitTimeInteractiveId(interactiveId);
  if (!parsed) {
    return {
      handled: true,
      action: 'visit-time-parse-failed',
      turnResult: buyerTurn(tBuyer(lang, 'interactive_visit_time_parse_failed')),
    };
  }

  const { propertyId, slot } = parsed;

  if (
    interactiveFocusEnabled()
    && !validateInteractivePropertyScope({
      propertyId,
      conversation,
      explicitSuffix: true,
    })
  ) {
    return {
      handled: true,
      action: 'visit-property-out-of-scope',
      turnResult: buyerTurn(tBuyer(lang, 'property_not_selected_yet')),
    };
  }

  const proposedTime = resolveVisitSlotToDate(slot);
  const property = await prisma.property.findFirst({
    where: { id: propertyId, companyId: company.id, status: { in: ['available', 'upcoming'] } },
  });

  if (!property) {
    return {
      handled: true,
      action: 'visit-property-unavailable',
      leadStatus: 'contacted',
      turnResult: buyerTurn(tBuyer(lang, 'interactive_visit_property_unavailable')),
    };
  }

  let agentId = lead.assignedAgentId ?? null;
  if (!agentId) {
    agentId = await assignLeadRoundRobin(company.id, lead.id);
    if (agentId) {
      await prisma.lead.update({ where: { id: lead.id }, data: { assignedAgentId: agentId } });
    }
  }

  if (!agentId) {
    // No agent available via round-robin — escalate to admins so the visit intent is not lost.
    // Previously this was a silent black-hole: buyer got "our team will call you" but nothing happened.
    logger.warn('handleVisitTimeSlot: no agent available for round-robin — notifying admins', {
      companyId: company.id,
      leadId: lead.id,
      propertyId: parsed.propertyId,
      proposedTime: proposedTime.toISOString(),
    });
    void (async () => {
      try {
        const admins = await prisma.user.findMany({
          where: { companyId: company.id, role: 'company_admin', status: 'active', phone: { not: null } },
          select: { phone: true },
        });
        const { whatsappService } = await import('../whatsapp.service');
        const customerName = lead.customerName || 'A buyer';
        const propertyNameStr = parsed.propertyId;
        const timeStr = formatISTDateTime(proposedTime, { hour12: true });
        const adminMsg = `🚨 *Unassigned Visit Request*\n${customerName} (${maskPhone(lead.phone ?? '')}) selected a visit slot for ${propertyNameStr} at ${timeStr}.\n\nNo agent was available. Please assign an agent and confirm this visit from the dashboard.`;
        for (const admin of admins) {
          if (admin.phone) {
            await whatsappService.sendCompanyTextMessage(admin.phone, adminMsg, company.id);
          }
        }
        void logAgentAction({
          companyId: company.id,
          triggeredBy: 'automation',
          action: 'visit_slot_no_agent_escalated',
          resourceType: 'lead',
          resourceId: lead.id,
          status: 'skipped',
          result: `Buyer selected visit at ${proposedTime.toISOString()} but no agent available`,
        });
      } catch (err: unknown) {
        logger.error('Failed to notify admins of unassigned visit slot', {
          companyId: company.id,
          leadId: lead.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return {
      handled: true,
      action: 'visit-no-agent',
      leadStatus: 'contacted',
      turnResult: buyerTurn(tBuyer(lang, 'interactive_visit_no_agent')),
    };
  }


  const propertyName = property?.name ?? 'Property';

  const existingVisit = await prisma.visit.findFirst({
    where: { leadId: lead.id, status: { in: ['scheduled', 'confirmed'] } },
    orderBy: { scheduledAt: 'asc' },
  });

  if (existingVisit?.status === 'confirmed') {
    const { notifyAgentVisitChangeRequested } = await import('../visitPendingApproval.service');
    await notifyAgentVisitChangeRequested({
      companyId: company.id,
      leadId: lead.id,
      visitId: existingVisit.id,
      messageText: `Customer selected a new visit slot for ${propertyName}: ${proposedTime.toISOString()}`,
    });
    return {
      handled: true,
      action: 'visit-confirmed-change-requested',
      leadStatus: 'visit_scheduled',
      turnResult: buyerTurn(tBuyer(lang, 'interactive_visit_confirmed_change')),
    };
  }

  const agent = await prisma.user.findUnique({
    where: { id: agentId },
    select: { name: true },
  });
  await createVisitApprovalRequest({
    companyId: company.id,
    leadId: lead.id,
    propertyId,
    scheduledAt: proposedTime,
    agentId,
    conversationId: conversation.id,
    customerPhone: lead.phone,
    customerName: lead.customerName,
    propertyName: property?.name,
    suppressCustomerMessage: true,
  });

  return {
    handled: true,
    action: 'visit-pending-agent-approval',
    leadStatus: 'contacted',
    newState: focusNewState(conversation, {
      stage: 'visit_booking',
      focusedPropertyId: propertyId,
      focusedProjectId: property.projectId,
      selectedPropertyId: propertyId,
      proposedVisitTime: proposedTime,
    }),
    turnResult: buyerTurn(formatBuyerVisitPendingApprovalReply(proposedTime, agent?.name)),
  };
}

/**
 * Route generic visit-slot-morning / visit-slot-afternoon buttons to the proper
 * visit-time slot using the conversation's selectedPropertyId.
 * These buttons come from buyerButtonPolicy visit_booking stage.
 */
async function handleGenericVisitSlot(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { interactiveId, conversation } = params;
  const lang = leadLang(params.lead);
  const propertyId = conversation.selectedPropertyId;

  if (!propertyId) {
    return {
      handled: true,
      action: 'generic-slot-no-property',
      turnResult: buyerTurn(tBuyer(lang, 'interactive_generic_slot_no_property')),
    };
  }

  // Reroute as canonical book-visit for this property — presents the IST date/time buttons
  return handleBookVisit({ ...params, interactiveId: `book-visit-${propertyId}` });
}

/**
 * Try orchestrated interactive handlers that return a unified TurnResult.
 * Returns null when the interactiveId should fall through to legacy handlers in whatsapp.service.ts.
 */
export async function tryOrchestratedInteractiveAction(
  params: InteractiveActionParams,
): Promise<InteractiveActionResult | null> {
  const result = await routeInteractiveAction(params);
  return finalizeInteractiveResult(params.conversation.id, result);
}
