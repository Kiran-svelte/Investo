import config from '../../config';
import {
  buildBuyerCrmButtonFlags,
  shouldUseVisitAwareButtonsOnly,
  canOfferPropertyBookingActions,
  appendHindiLeadGreetingSuffix,
  evaluateSecondVisitPolicy,
} from '../../services/buyer/buyerEnterpriseUx.service';
import type { LiveLeadContext } from '../../services/liveLeadContext.service';
import { resolveSituationBuyerButtons } from '../../utils/buyerSituationButtons.util';

function liveCtx(overrides: Partial<LiveLeadContext> = {}): LiveLeadContext {
  return {
    leadStatus: 'visit_scheduled',
    leadName: 'Ravi',
    activeVisit: {
      visitId: 'v1',
      propertyId: 'p1',
      propertyName: 'Sunset 1102',
      projectId: 'proj-1',
      status: 'confirmed',
      scheduledAt: new Date('2026-06-17T04:30:00.000Z'),
      agentName: null,
      agentPhone: null,
      notes: null,
    },
    recentCompletedVisit: null,
    recentCancelledVisit: null,
    activeCall: null,
    assignedAgentName: null,
    assignedAgentPhone: null,
    promptBlock: '',
    upcomingVisits: [],
    ...overrides,
  };
}

describe('buyerEnterpriseUx.service', () => {
  test('buildBuyerCrmButtonFlags uses completed visit project when no active visit', () => {
    const flags = buildBuyerCrmButtonFlags(
      liveCtx({
        activeVisit: null,
        recentCompletedVisit: {
          visitId: 'v0',
          propertyId: 'p0',
          propertyName: 'Lake Vista',
          projectId: 'proj-lake',
          status: 'completed',
          scheduledAt: new Date(),
          agentName: null,
          agentPhone: null,
          notes: null,
        },
        leadStatus: 'visited',
      }),
      'lead-1',
    );
    expect(flags.hasCompletedVisit).toBe(true);
    expect(flags.visitPropertyProjectId).toBe('proj-lake');
  });

  test('shouldUseVisitAwareButtonsOnly blocks generic follow-up but not property detail', () => {
    expect(shouldUseVisitAwareButtonsOnly(true, 'general_followup')).toBe(true);
    expect(shouldUseVisitAwareButtonsOnly(true, 'single_property_focus')).toBe(false);
    expect(shouldUseVisitAwareButtonsOnly(true, 'price_discussed')).toBe(false);
    expect(shouldUseVisitAwareButtonsOnly(true, 'visit_confirmed')).toBe(false);
    expect(shouldUseVisitAwareButtonsOnly(false, 'price_discussed')).toBe(false);
  });

  test('canOfferPropertyBookingActions is false when visit or call active', () => {
    expect(canOfferPropertyBookingActions({ hasActiveVisit: true, hasActiveCall: false })).toBe(false);
    expect(canOfferPropertyBookingActions({ hasActiveVisit: false, hasActiveCall: true })).toBe(false);
    expect(canOfferPropertyBookingActions({ hasActiveVisit: false, hasActiveCall: false })).toBe(true);
  });

  test('appendHindiLeadGreetingSuffix adds Hindi for hi lead on English reply', () => {
    const out = appendHindiLeadGreetingSuffix('Hello!', 'en', 'hi', 'Palm Realty', 'Ravi');
    expect(out).toContain('Hello!');
    expect(out).toMatch(/Namaste|swagat/i);
  });

  test('second visit policy allows different project when explicit', () => {
    (config.features as { secondVisitPolicy: boolean }).secondVisitPolicy = true;
    const decision = evaluateSecondVisitPolicy({
      hasActiveVisit: true,
      activeVisitPropertyId: 'p-a',
      activeVisitProjectId: 'proj-a',
      targetPropertyId: 'p-b',
      targetProjectId: 'proj-b',
      explicitCrossProjectIntent: true,
    });
    expect(decision).toEqual({ allow: true, reason: 'different_project' });
    (config.features as { secondVisitPolicy: boolean }).secondVisitPolicy = false;
  });
});

describe('buyerEnterpriseUx button matrix', () => {
  const visitCases: Array<{ situation: string; outbound: string; expectBook: boolean }> = [
    { situation: 'price', outbound: 'Pricing is ₹95L – ₹1.1Cr for Sunset Heights.', expectBook: false },
    { situation: 'brochure', outbound: 'Here is the brochure PDF for Sunset Heights.', expectBook: false },
    { situation: 'multi', outbound: 'Here are matching projects for you.', expectBook: false },
    { situation: 'single', outbound: 'Sunset Heights 1102 starts from ₹95L.', expectBook: false },
  ];

  for (const { situation, outbound, expectBook } of visitCases) {
    test(`active visit suppresses book/details for ${situation} reply`, () => {
      const buttons = resolveSituationBuyerButtons({
        stage: 'shortlist',
        outboundText: outbound,
        propertyId: 'p1',
        hasActiveVisit: true,
        visitStatus: 'confirmed',
        visitPropertyProjectId: 'proj-1',
        language: 'en',
      });
      const ids = buttons?.map((b) => b.id) ?? [];
      expect(ids).toContain('visit-reschedule');
      expect(ids).toContain('project-properties-proj-1');
      if (!expectBook) {
        expect(ids.some((id) => id.startsWith('book-visit'))).toBe(false);
        expect(ids.some((id) => id.startsWith('more-info'))).toBe(false);
      }
    });
  }
});
