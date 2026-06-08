/**
 * Interactive button/list turn orchestrator.
 * Builds TurnResult payloads for tap flows — caller dispatches via sendTurnResult only.
 */
import prisma from '../../config/prisma';
import logger from '../../config/logger';
import type { InteractiveActionResult, TurnResult, WhatsAppComponent } from '../../types/whatsapp-turn.types';
import {
  enforceTurnComponentBudget,
  resolveHeroMediaComponentFromPropertyIds,
} from './whatsappTurnOrchestrator.service';
import { searchAlternativeTiers } from '../alternativeInventory.service';
import { setConversationAwaitingCallTime } from '../../utils/conversationCallContext.util';
import {
  parseVisitTimeInteractiveId,
  resolveVisitSlotToDate,
  scheduleVisit,
} from '../visitBooking.service';
import { createVisitApprovalRequest } from '../visitPendingApproval.service';
import { assignLeadRoundRobin } from '../leadAssignment.service';
import {
  formatBuyerVisitPendingApproval,
  formatBuyerVisitScheduled,
} from '../../utils/visitFormat.util';
import { buildWhatsAppPropertyDetailText } from '../propertyAiContext.service';
import { getPropertyKnowledgeForProperty } from '../propertyKnowledge.service';
import { confirmVisitById, rescheduleVisitById } from '../visitState.service';

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
  };
  conversation: {
    id: string;
    selectedPropertyId?: string | null;
    commitments?: unknown;
  };
  company: { id: string; name?: string };
};

function buyerTurn(text: string, components?: WhatsAppComponent[]): TurnResult {
  return {
    audience: 'buyer',
    handled: true,
    text,
    components: components?.length ? components : undefined,
    replyPacing: 'none',
  };
}

function getIstDatePlusDays(days: number): Date {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS + days * DAY_MS - IST_OFFSET_MS);
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
}

function buildVisitSlotButtons(propertyId: string): WhatsAppComponent {
  const tomorrow = getIstDatePlusDays(1);
  const dayAfter = getIstDatePlusDays(2);
  const pid = propertyId || 'x';
  return {
    kind: 'buttons',
    buttons: [
      { id: `visit-time-${pid}-tomorrow-10am`, title: `${formatShortDate(tomorrow)} 10AM` },
      { id: `visit-time-${pid}-tomorrow-3pm`, title: `${formatShortDate(tomorrow)} 3PM` },
      { id: `visit-time-${pid}-dayafter`, title: `${formatShortDate(dayAfter)}` },
    ],
  };
}

async function handleVisitConfirm(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { lead, company } = params;
  const existingVisit = await prisma.visit.findFirst({
    where: { leadId: lead.id, status: { in: ['scheduled', 'confirmed'] } },
    orderBy: { scheduledAt: 'asc' },
    include: { property: { select: { name: true } } },
  });

  if (!existingVisit) {
    return {
      handled: true,
      action: 'visit-confirm-no-visit',
      turnResult: buyerTurn(
        `I couldn't find an upcoming visit to confirm. Would you like to book a new site visit?`,
      ),
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
      turnResult: buyerTurn(
        `I couldn't confirm that visit right now. Please try again or ask our team to help.`,
      ),
    };
  }

  const visitDate = new Date(existingVisit.scheduledAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const propName = (existingVisit.property as { name?: string })?.name ?? 'the property';

  logger.info('Visit confirmed via interactive CTA', { visitId: existingVisit.id, leadId: lead.id });
  return {
    handled: true,
    action: 'visit-confirmed',
    leadStatus: 'visit_scheduled',
    turnResult: buyerTurn(
      `✅ *Visit Confirmed!*\n\n🏠 *${propName}*\n📅 ${visitDate}\n\nWe look forward to seeing you! 😊\n\nNeed anything else? Feel free to ask.`,
    ),
  };
}

async function handleVisitReschedule(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { lead } = params;
  const existingVisit = await prisma.visit.findFirst({
    where: { leadId: lead.id, status: { in: ['scheduled', 'confirmed'] } },
    orderBy: { scheduledAt: 'asc' },
    include: { property: { select: { name: true, id: true } } },
  });

  if (!existingVisit) {
    return {
      handled: true,
      action: 'visit-reschedule-no-visit',
      turnResult: buyerTurn(
        `I couldn't find an upcoming visit to reschedule. Would you like to book a new site visit?`,
      ),
    };
  }

  const propertyId = (existingVisit.property as { id?: string })?.id ?? '';
  const propName = (existingVisit.property as { name?: string })?.name ?? 'the property';

  return {
    handled: true,
    action: 'visit-reschedule-initiated',
    turnResult: buyerTurn(
      `📅 Let's find a new time for your visit to *${propName}*. When works best for you?`,
      [buildVisitSlotButtons(propertyId)],
    ),
  };
}

async function handleBookVisit(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { interactiveId, lead, conversation, company } = params;
  const propertyId =
    interactiveId.replace('book-visit-', '') !== 'book-visit'
      ? interactiveId.replace('book-visit-', '')
      : conversation.selectedPropertyId;

  if (!propertyId) {
    return {
      handled: true,
      action: 'book-visit-no-property',
      turnResult: buyerTurn(
        "I'd love to schedule a visit! Could you tell me which property you're interested in?",
      ),
    };
  }

  const property = await prisma.property.findFirst({
    where: { id: propertyId, companyId: company.id, status: { in: ['available', 'upcoming'] } },
  });

  if (!property) {
    return {
      handled: true,
      action: 'book-visit-invalid-property',
      turnResult: buyerTurn("I couldn't find that property. Let me show you our available options."),
    };
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

  return {
    handled: true,
    action: 'book-visit-initiated',
    newState: { stage: 'visit_booking', selectedPropertyId: propertyId },
    turnResult: buyerTurn(
      `Great choice! 🏠 Let's schedule your visit to *${property.name}*.\n\nWhen would you prefer to visit?`,
      [buildVisitSlotButtons(propertyId)],
    ),
  };
}

async function handleCallMe(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { lead, company } = params;
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
      turnResult: buyerTurn(
        `📞 I'll ask our team to call you — please share a good time if you have one (e.g. *tomorrow 3pm*).`,
      ),
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
      { kind: 'buttons', buttons: [
        { id: 'call-reschedule', title: '📅 Change Time' },
        { id: 'call-cancel', title: '❌ Cancel Call' },
        { id: 'call-me', title: '📞 Call Agent' },
      ]},
    ]),
  };
}

async function handleCallCancel(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { lead, company } = params;
  const { findActiveCallRequest, cancelCallRequest, notifyAgentCallChangeRequested } = await import('../callRequest.service');
  const active = await findActiveCallRequest({ companyId: company.id, leadId: lead.id });
  if (!active) {
    return {
      handled: true,
      action: 'callback-cancelled',
      turnResult: buyerTurn("I couldn't find a scheduled callback to cancel."),
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
      turnResult: buyerTurn(
        `Your callback is already confirmed, so I can't cancel it automatically. I have notified the team to help you.`,
      ),
    };
  }
  await cancelCallRequest({ companyId: company.id, callId: active.id });
  return {
    handled: true,
    action: 'callback-cancelled',
    turnResult: buyerTurn(
      `*Callback cancelled*\n\nReply anytime if you'd like to schedule a new call with our team.`,
    ),
  };
}

async function handleCallReschedule(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  await setConversationAwaitingCallTime(params.conversation.id).catch(() => undefined);
  return {
    handled: true,
    action: 'callback-reschedule-prompt',
    turnResult: buyerTurn(
      `Sure — share your preferred call time (e.g. *tomorrow 6pm*, *Friday 4pm*, or *next Saturday 11am*).`,
    ),
  };
}

async function handleMoreInfo(params: InteractiveActionParams): Promise<InteractiveActionResult | null> {
  const { interactiveId, lead, conversation, company } = params;
  const propertyId =
    interactiveId.replace('more-info-', '') !== 'more-info'
      ? interactiveId.replace('more-info-', '')
      : conversation.selectedPropertyId;

  if (!propertyId) return null;

  const property = await prisma.property.findFirst({
    where: { id: propertyId, companyId: company.id, status: { in: ['available', 'upcoming'] } },
  });
  if (!property) {
    return {
      handled: true,
      action: 'more-info-not-found',
      turnResult: buyerTurn(
        "I couldn't find details for that property right now. Tell me the project name or area and I'll shortlist options.",
      ),
    };
  }

  let details = buildWhatsAppPropertyDetailText(property);

  const knowledgeChunks = await getPropertyKnowledgeForProperty(company.id, property.id, 3);
  const extraFacts = knowledgeChunks
    .map((chunk) => chunk.content.trim())
    .filter((content) => content && !details.includes(content.slice(0, 80)))
    .slice(0, 2);
  if (extraFacts.length > 0) {
    details = `${details}\n\n📌 *More from our records:*\n${extraFacts.join('\n\n')}`;
  }

  const activeVisit = await prisma.visit.findFirst({
    where: { leadId: lead.id, status: { in: ['scheduled', 'confirmed'] } },
    orderBy: { scheduledAt: 'asc' },
    include: { property: { select: { name: true } } },
  });

  let outboundText = details;
  let buttonComponent: WhatsAppComponent;

  if (activeVisit) {
    const visitDate = new Date(activeVisit.scheduledAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const visitPropName = (activeVisit.property as { name?: string })?.name ?? 'the property';
    const visitAlreadyConfirmed = activeVisit.status === 'confirmed';
    outboundText =
      (visitAlreadyConfirmed
        ? `Your visit for *${visitPropName}* on ${visitDate} is confirmed ✅\n\n`
        : `You already have a visit for *${visitPropName}* on ${visitDate} 🗓️\n\n`) + details;
    buttonComponent = {
      kind: 'buttons',
      buttons: visitAlreadyConfirmed
        ? [
            { id: 'visit-reschedule', title: '📅 Change Time' },
            { id: `more-info-${propertyId}`, title: '🏗️ Property Details' },
            { id: 'call-me', title: '📞 Call Agent' },
          ]
        : [
            { id: 'visit-confirm', title: '✅ Confirm Visit' },
            { id: 'visit-reschedule', title: '📅 Reschedule' },
            { id: 'call-me', title: '📞 Call Agent' },
          ],
    };
  } else {
    buttonComponent = {
      kind: 'buttons',
      buttons: [
        { id: `book-visit-${propertyId}`, title: 'Book Visit' },
        { id: 'call-me', title: 'Call Me' },
        { id: `location-${propertyId}`, title: 'Show Location' },
      ],
    };
  }

  const brochure = await resolveInteractiveBrochure({
    customerMessage: 'brochure',
    aiText: outboundText,
    properties: [{ id: property.id, name: property.name, brochureUrl: property.brochureUrl }],
  });
  outboundText = brochure.cleanedText || outboundText;

  const hero =
    brochure.mediaComponent ??
    (await resolveHeroMediaComponentFromPropertyIds(company.id, [property.id]));

  const components = enforceTurnComponentBudget([
    buttonComponent,
    ...(brochure.mediaComponent ?? hero ? [brochure.mediaComponent ?? hero!] : []),
  ]);

  return {
    handled: true,
    action: 'more-info-sent',
    newState: { selectedPropertyId: propertyId },
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

async function handlePropertyFilter(params: InteractiveActionParams): Promise<InteractiveActionResult | null> {
  const { interactiveId, lead, conversation, company } = params;
  const filterValue = interactiveId.replace('filter-', '');

  const filterMap: Record<
    string,
    { propertyType?: string; bedrooms?: number; displayName: string }
  > = {
    '1bhk': { bedrooms: 1, displayName: '1 BHK' },
    '2bhk': { bedrooms: 2, displayName: '2 BHK' },
    '3bhk': { bedrooms: 3, displayName: '3 BHK' },
    '4bhk': { bedrooms: 4, displayName: '4 BHK' },
    '5bhk': { bedrooms: 5, displayName: '5 BHK' },
    villa: { propertyType: 'villa', displayName: 'Villa' },
    apartment: { propertyType: 'apartment', displayName: 'Apartment' },
    plot: { propertyType: 'plot', displayName: 'Plot' },
    commercial: { propertyType: 'commercial', displayName: 'Commercial' },
  };

  const filter = filterMap[filterValue.toLowerCase()];
  if (!filter) return null;

  const recentFilterAction = await prisma.message.findFirst({
    where: {
      conversationId: conversation.id,
      content: { contains: `Filter applied: ${filter.displayName}` },
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
        lastFilterReply?.content?.trim() ||
          `You're already viewing *${filter.displayName}* options — tap a property from the list above or tell me another preference.`,
      ),
    };
  }

  try {
    const updatedLead = await prisma.lead.update({
      where: { id: lead.id },
      data: {
        propertyType: (filter.propertyType as any) || lead.propertyType,
        ...(filter.bedrooms && {
          notes: lead.notes
            ? `${lead.notes}; Prefers ${filter.bedrooms} BHK`
            : `Prefers ${filter.bedrooms} BHK`,
        }),
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { stage: 'shortlist' as any, stageEnteredAt: new Date(), stageMessageCount: 0 },
    });

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType: 'customer',
        content: `Filter applied: ${filter.displayName}`,
        status: 'sent',
      },
    });

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
        `No ${filter.displayName} matches right now — I can add you to our waitlist or show nearby options.`;
      let body = topHint;
      const altProp = tiers[0]?.properties?.[0];
      if (altProp) {
        body += `\n\nClosest option: *${altProp.name}* (${altProp.locationArea || altProp.locationCity}).`;
      }
      body += '\n\nReply *WAITLIST* to get alerted when a match is listed, or tell me another area/BHK.';

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
    const listText = `Great choice! Found ${properties.length} ${filter.displayName} ${properties.length === 1 ? 'property' : 'properties'} for you! 🏠✨`;

    const listComponent: WhatsAppComponent = {
      kind: 'list',
      title: 'View Properties',
      sections: [
        {
          title: `${filter.displayName} Options (${properties.length})`,
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
      filter: filter.displayName,
      matchCount: properties.length,
      conversationId: conversation.id,
      leadId: lead.id,
    });

    return {
      handled: true,
      action: 'filter-applied',
      newState: { stage: 'shortlist', recommendedPropertyIds: propertyIds },
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
        `I'm having trouble filtering properties right now. Let me help you manually - what specific ${filter.displayName} properties would you like to know about?`,
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
  const parsed = parseVisitTimeInteractiveId(interactiveId);
  if (!parsed) {
    return {
      handled: true,
      action: 'visit-time-parse-failed',
      turnResult: buyerTurn(
        'Sorry, I could not read that time slot. Please tap a visit time button again or tell me your preferred date.',
      ),
    };
  }

  const { propertyId, slot } = parsed;
  const proposedTime = resolveVisitSlotToDate(slot);
  const property = await prisma.property.findFirst({
    where: { id: propertyId, companyId: company.id, status: { in: ['available', 'upcoming'] } },
  });

  if (!property) {
    return {
      handled: true,
      action: 'visit-property-unavailable',
      leadStatus: 'contacted',
      turnResult: buyerTurn(
        'That project is not available for visit booking right now. I can show you our available and upcoming projects instead.',
      ),
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
    return {
      handled: true,
      action: 'visit-no-agent',
      leadStatus: 'contacted',
      turnResult: buyerTurn(
        'Thanks for choosing a time! Our sales team will call you shortly to confirm your visit.',
      ),
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
      turnResult: buyerTurn(
        `Your visit is already confirmed, so I won't change it automatically.\n\nI've notified the team with your preferred new time.`,
      ),
    };
  }

  const agentRecord: { name?: string | null } | null = null;
  if (false) {
    if (existingVisit) {
      const reschedule = await rescheduleVisitById({
        companyId: company.id,
        visitId: existingVisit.id,
        scheduledAt: proposedTime,
        notes: 'Rescheduled via WhatsApp visit button',
        suppressCustomerNotification: true,
      });

      if (reschedule.success && reschedule.visit) {
        if (propertyId !== existingVisit.propertyId) {
          await prisma.visit.update({
            where: { id: existingVisit.id },
            data: { propertyId },
          });
        }

        return {
          handled: true,
          action: 'visit-rescheduled',
          leadStatus: 'visit_scheduled',
          newState: {
            stage: 'confirmation',
            selectedPropertyId: propertyId,
            proposedVisitTime: proposedTime,
          },
          turnResult: buyerTurn(
            `✅ *Visit rescheduled!*\n\n🏠 *${propertyName}*\n📅 ${proposedTime.toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            })}\n\nSee you then! Reply if you need to change again.`,
          ),
        };
      }
    }

    const booking = await scheduleVisit({
      companyId: company.id,
      leadId: lead.id,
      propertyId,
      scheduledAt: proposedTime,
      agentId,
      notes: 'Booked via WhatsApp visit button',
    });

    if (booking.success && booking.visit) {
      return {
        handled: true,
        action: 'visit-scheduled',
        leadStatus: 'visit_scheduled',
        newState: {
          stage: 'confirmation',
          selectedPropertyId: propertyId,
          proposedVisitTime: proposedTime,
        },
        turnResult: buyerTurn(
          formatBuyerVisitScheduled(proposedTime, propertyName, agentRecord?.name ?? null),
        ),
      };
    }
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
    newState: {
      stage: 'visit_booking',
      selectedPropertyId: propertyId,
      proposedVisitTime: proposedTime,
    },
    turnResult: buyerTurn(formatBuyerVisitPendingApproval(agent?.name)),
  };
}

/**
 * Route generic visit-slot-morning / visit-slot-afternoon buttons to the proper
 * visit-time slot using the conversation's selectedPropertyId.
 * These buttons come from buyerButtonPolicy visit_booking stage.
 */
async function handleGenericVisitSlot(params: InteractiveActionParams): Promise<InteractiveActionResult> {
  const { interactiveId, conversation } = params;
  const propertyId = conversation.selectedPropertyId;

  if (!propertyId) {
    return {
      handled: true,
      action: 'generic-slot-no-property',
      turnResult: buyerTurn(
        "Which property would you like to visit? Share the project name and I'll get you some time slots.",
      ),
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
  const { interactiveId } = params;

  if (interactiveId === 'visit-confirm') return handleVisitConfirm(params);
  if (interactiveId === 'visit-reschedule') return handleVisitReschedule(params);
  if (interactiveId.startsWith('visit-time-')) return handleVisitTimeSlot(params);
  if (interactiveId === 'book-visit' || interactiveId.startsWith('book-visit-')) {
    return handleBookVisit(params);
  }
  // Generic slot buttons (visit_booking stage policy) — route via book-visit
  if (interactiveId === 'visit-slot-morning' || interactiveId === 'visit-slot-afternoon') {
    return handleGenericVisitSlot(params);
  }
  if (interactiveId === 'call-me' || interactiveId === 'callback-request') return handleCallMe(params);
  if (interactiveId === 'call-cancel') return handleCallCancel(params);
  if (interactiveId === 'call-reschedule') return handleCallReschedule(params);
  if (interactiveId === 'more-info' || interactiveId.startsWith('more-info-')) {
    return handleMoreInfo(params);
  }
  if (interactiveId.startsWith('filter-')) return handlePropertyFilter(params);

  return null;
}
