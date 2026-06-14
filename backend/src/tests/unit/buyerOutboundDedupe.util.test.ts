import { formatBuyerVisitScheduled } from '../../utils/visitFormat.util';
import {
  contentMatchesRecentVisitOutbound,
  wasRecentBareGreetingWelcomeSent,
  wasRecentCallWelcomeSent,
  wasRecentVisitWelcomeSent,
} from '../../utils/buyerI18n.util';
import { buildFastPathCustomerReply } from '../../services/customerMessageFastPath.service';
import { buildReturningBuyerWelcomeReply } from '../../services/buyerQualification.service';

const property = 'Sunset Heights';
const scheduledAt = new Date('2026-06-15T10:00:00+05:30');

describe('buyer outbound dedupe utilities', () => {
  it('matches canonical Visit scheduled confirmation text', () => {
    const msg = formatBuyerVisitScheduled(scheduledAt, property, 'Riya');
    expect(contentMatchesRecentVisitOutbound(msg, property)).toBe(true);
  });

  it('wasRecentVisitWelcomeSent detects visit booking then repeat greeting', () => {
    const bookingMsg = formatBuyerVisitScheduled(scheduledAt, property);
    const history = [
      { senderType: 'ai', content: bookingMsg, createdAt: new Date() },
    ];
    expect(wasRecentVisitWelcomeSent(history, property)).toBe(true);
  });

  it('falls back to recent AI messages when createdAt is missing', () => {
    const history = [
      { senderType: 'ai', content: formatBuyerVisitScheduled(scheduledAt, property) },
    ];
    expect(wasRecentVisitWelcomeSent(history, property)).toBe(true);
  });

  it('wasRecentCallWelcomeSent detects callback confirmation', () => {
    const history = [
      {
        senderType: 'ai',
        content: 'Your callback is *confirmed* ✅\n📅 Tomorrow 3pm',
        createdAt: new Date(),
      },
    ];
    expect(wasRecentCallWelcomeSent(history)).toBe(true);
  });

  it('wasRecentBareGreetingWelcomeSent detects returning welcome', () => {
    const history = [
      {
        senderType: 'ai',
        content: 'Welcome back, *Riya*! How did your visit to *Sunset Heights* go?',
        createdAt: new Date(),
      },
    ];
    expect(wasRecentBareGreetingWelcomeSent(history)).toBe(true);
  });
});

describe('greeting fast path compact acks', () => {
  const visit = {
    visitId: 'v1',
    propertyId: 'p1',
    propertyName: property,
    projectId: null,
    scheduledAt,
    status: 'scheduled' as const,
    agentName: 'Riya',
    agentPhone: null,
    notes: null,
  };

  it('uses compact visit ack after recent booking confirmation on repeat Hi', () => {
    const history = [
      {
        senderType: 'ai',
        content: formatBuyerVisitScheduled(scheduledAt, property),
        createdAt: new Date(),
      },
    ];
    const reply = buildFastPathCustomerReply({
      customerMessage: 'Hi',
      companyName: 'Palm',
      upcomingVisit: visit,
      conversationHistory: history,
    });
    expect(reply?.text).toContain('still booked');
    expect(reply?.text).not.toContain('What *area*');
  });

  it('uses compact returning welcome on repeat Hi without active visit', () => {
    const history = [
      {
        senderType: 'ai',
        content: 'Hello! Welcome to *Palm*.\n\nStill exploring options, or something new?',
        createdAt: new Date(),
      },
    ];
    const reply = buildReturningBuyerWelcomeReply({
      companyName: 'Palm',
      liveCtx: {
        activeVisit: null,
        activeCall: null,
        recentCompletedVisit: null,
        recentCancelledVisit: null,
        leadStatus: 'contacted',
      },
      conversationHistory: history,
    });
    expect(reply).toContain('What would you like next');
    expect(reply).not.toContain('share your budget');
  });
});
