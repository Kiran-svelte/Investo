import {
  isAdvancedLeadStatus,
  isPostVisitBuyer,
  isPostVisitLeadStatus,
  resolveStageFromLeadStatus,
  resolveStageAfterHumanEscalationReset,
} from '../../utils/buyerLeadProgress.util';

describe('buyerLeadProgress.util', () => {
  test('detects advanced CRM statuses', () => {
    expect(isAdvancedLeadStatus('visited')).toBe(true);
    expect(isAdvancedLeadStatus('negotiation')).toBe(true);
    expect(isAdvancedLeadStatus('new')).toBe(false);
  });

  test('maps visited leads to shortlist stage', () => {
    expect(resolveStageFromLeadStatus('visited')).toBe('shortlist');
    expect(resolveStageFromLeadStatus('negotiation')).toBe('commitment');
  });

  test('preserves CRM stage when clearing human_escalated', () => {
    expect(resolveStageAfterHumanEscalationReset('visited')).toBe('shortlist');
    expect(resolveStageAfterHumanEscalationReset('negotiation')).toBe('commitment');
    expect(resolveStageAfterHumanEscalationReset('new')).toBe('rapport');
    expect(resolveStageAfterHumanEscalationReset(null)).toBe('rapport');
  });

  test('post-visit when CRM visited even without completed visit row', () => {
    expect(
      isPostVisitBuyer({
        leadStatus: 'visited',
        activeVisit: null,
        recentCompletedVisit: null,
      }),
    ).toBe(true);
  });

  test('not post-visit when active booking exists', () => {
    expect(
      isPostVisitBuyer({
        leadStatus: 'visited',
        activeVisit: {
          visitId: 'v1',
          propertyId: 'p1',
          projectId: null,
          propertyName: 'Lake Vista',
          status: 'confirmed',
          scheduledAt: new Date(),
          agentName: null,
          agentPhone: null,
          notes: null,
        },
        recentCompletedVisit: null,
      }),
    ).toBe(false);
  });

  test('post-visit lead statuses', () => {
    expect(isPostVisitLeadStatus('visited')).toBe(true);
    expect(isPostVisitLeadStatus('visit_scheduled')).toBe(false);
  });
});
