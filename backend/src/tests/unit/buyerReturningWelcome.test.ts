import { buildReturningBuyerWelcomeReply } from '../../services/buyerQualification.service';import type { LiveLeadContext } from '../../services/liveLeadContext.service';

function emptyLiveCtx(overrides: Partial<LiveLeadContext> = {}): LiveLeadContext {
  return {
    leadStatus: 'new',
    leadName: null,
    activeVisit: null,
    recentCompletedVisit: null,
    recentCancelledVisit: null,
    activeCall: null,
    assignedAgentName: null,
    assignedAgentPhone: null,
    promptBlock: '',
    ...overrides,
  };
}

describe('buildReturningBuyerWelcomeReply', () => {
  test('generic returning buyer gets first-time welcome shell plus saved area', () => {
    const reply = buildReturningBuyerWelcomeReply({
      companyName: 'Palm Realty',
      customerName: 'Raj',
      locationPreference: 'Whitefield',
      liveCtx: emptyLiveCtx(),
    });
    expect(reply).toContain('Welcome to *Palm Realty*');
    expect(reply).toContain('assistant for *Palm Realty*');
    expect(reply).toContain('Saved preference: *Whitefield*');
    expect(reply).not.toMatch(/^Welcome back!/);
  });

  test('active visit uses visit-aware greeting', () => {
    const reply = buildReturningBuyerWelcomeReply({
      companyName: 'Palm Realty',
      liveCtx: emptyLiveCtx({
        activeVisit: {
          visitId: 'v1',
          propertyId: 'p1',
          projectId: null,
          propertyName: 'Lake Vista',
          status: 'confirmed',
          scheduledAt: new Date('2026-06-20T10:00:00Z'),
          agentName: 'Asha',
          agentPhone: null,
          notes: null,
        },
      }),
    });
    expect(reply).toContain('site visit is *confirmed*');
    expect(reply).toContain('Lake Vista');
  });

  test('cancelled visit surfaces in activity lines', () => {
    const reply = buildReturningBuyerWelcomeReply({
      companyName: 'Palm Realty',
      liveCtx: emptyLiveCtx({
        recentCancelledVisit: {
          visitId: 'v2',
          propertyId: 'p2',
          projectId: null,
          propertyName: 'Sunset Heights',
          status: 'cancelled',
          scheduledAt: new Date('2026-06-10T10:00:00Z'),
          agentName: null,
          agentPhone: null,
          notes: null,
        },
      }),
    });
    expect(reply).toContain('cancelled');
    expect(reply).toContain('Sunset Heights');
  });

  test('custom greeting template appends Hindi block for Hindi lead', () => {
    const reply = buildReturningBuyerWelcomeReply({
      companyName: 'Palm Realty',
      customerName: 'Riya',
      greetingTemplate: 'Hello! Welcome to {business_name}.',
      leadLanguage: 'hi',
      liveCtx: emptyLiveCtx(),
    });
    expect(reply).toMatch(/Welcome to Palm Realty/);
    expect(reply).toMatch(/Namaste/);
    expect(reply).toMatch(/swagat hai/i);
  });
});
