import {
  buildFastPathCustomerReply,
  isConversationAcknowledgmentMessage,
  isIdentityQuestionMessage,
  isSimpleGreetingMessage,
  shouldSkipKnowledgeSearchForMessage,
} from '../../services/customerMessageFastPath.service';

describe('customerMessageFastPath.service', () => {
  it('detects greetings', () => {
    expect(isSimpleGreetingMessage('hi')).toBe(true);
    expect(isSimpleGreetingMessage('Hello!')).toBe(true);
    expect(isSimpleGreetingMessage('who are you')).toBe(false);
  });

  it('detects identity questions', () => {
    expect(isIdentityQuestionMessage('who are you')).toBe(true);
    expect(isIdentityQuestionMessage('aap kaun ho')).toBe(true);
    expect(isIdentityQuestionMessage('hi')).toBe(false);
  });

  it('skips knowledge search for simple messages', () => {
    expect(shouldSkipKnowledgeSearchForMessage('hi')).toBe(true);
    expect(shouldSkipKnowledgeSearchForMessage('who are you')).toBe(true);
    expect(shouldSkipKnowledgeSearchForMessage('2bhk villa near whitefield under 2cr')).toBe(false);
  });

  it('detects short acknowledgments without treating as greeting', () => {
    expect(isConversationAcknowledgmentMessage('Good')).toBe(true);
    expect(isSimpleGreetingMessage('Good')).toBe(false);
  });

  it('builds contextual ack after property discussion', () => {
    const reply = buildFastPathCustomerReply({
      customerMessage: 'Good',
      companyName: 'Palm',
      aiSettings: { defaultLanguage: 'en' },
      propertyNames: ['Sunset Heights'],
      conversationHistory: [
        { senderType: 'customer', content: 'Tell me about Sunset Heights' },
        { senderType: 'ai', content: 'Here are the key highlights for you.' },
      ],
    });
    expect(reply?.text).toBeTruthy();
    expect(reply?.text).not.toMatch(/Welcome to Palm/i);
  });

  it('skips first-contact greeting when any prior AI outbound exists', () => {
    const reply = buildFastPathCustomerReply({
      customerMessage: 'Hi',
      companyName: 'Palm',
      aiSettings: {
        defaultLanguage: 'en',
        greetingTemplate: 'Hello! Welcome to {business_name}. How can I help you find your dream property today?',
      },
      conversationHistory: [{ senderType: 'ai', content: 'Welcome back! Still exploring?' }],
    });
    expect(reply).toBeNull();
  });

  it('skips greeting fast path during visit_booking stage', () => {
    const reply = buildFastPathCustomerReply({
      customerMessage: 'Hi',
      companyName: 'Palm',
      conversationStage: 'visit_booking',
      aiSettings: {
        defaultLanguage: 'en',
        greetingTemplate: 'Hello! Welcome to {business_name}. How can I help you find your dream property today?',
      },
      conversationHistory: [{ senderType: 'ai', content: 'Pick a time' }],
    });
    expect(reply).toBeNull();
  });

  it('builds identity reply in English for English identity question', () => {
    const reply = buildFastPathCustomerReply({
      customerMessage: 'who are you',
      companyName: 'Continuum Realty',
      aiSettings: { defaultLanguage: 'hi' },
    });
    expect(reply?.detectedLanguage).toBe('en');
    expect(reply?.text).toContain('Continuum Realty');
    expect(reply?.text.length).toBeGreaterThan(20);
  });

  it('builds English greeting with Hindi follow-up when lead was Hindi and message is Hi', () => {
    const reply = buildFastPathCustomerReply({
      customerMessage: 'Hi',
      companyName: 'Palm Realty',
      leadLanguage: 'hi',
      aiSettings: { defaultLanguage: 'hi' },
      conversationHistory: [],
    });
    expect(reply?.detectedLanguage).toBe('en');
    expect(reply?.text).toMatch(/Welcome to \*Palm Realty\*/);
    expect(reply?.text).toMatch(/Namaste/);
    expect(reply?.text).toMatch(/swagat hai/i);
  });

  it('uses compact visit ack after recent booking message on repeat Hi', () => {
    const { formatBuyerVisitScheduled } = require('../../utils/visitFormat.util');
    const scheduledAt = new Date('2026-06-15T10:00:00+05:30');
    const propertyName = 'Sunset Heights';
    const reply = buildFastPathCustomerReply({
      customerMessage: 'Hi',
      companyName: 'Palm',
      upcomingVisit: {
        visitId: 'v1',
        propertyId: 'p1',
        propertyName,
        projectId: null,
        scheduledAt,
        status: 'scheduled',
        agentName: 'Riya',
        agentPhone: null,
        notes: null,
      },
      conversationHistory: [
        {
          senderType: 'ai',
          content: formatBuyerVisitScheduled(scheduledAt, propertyName),
          createdAt: new Date(),
        },
      ],
    });
    expect(reply?.text).toMatch(/still booked|still confirmed/i);
  });
});
