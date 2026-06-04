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
        { senderType: 'ai', content: 'Sunset Heights has 2BHK from 83 lakh.' },
      ],
    });
    expect(reply?.text).toContain('Sunset Heights');
    expect(reply?.text).not.toMatch(/Welcome to Palm/i);
  });

  it('builds identity reply in admin default language', () => {
    const reply = buildFastPathCustomerReply({
      customerMessage: 'who are you',
      companyName: 'Continuum Realty',
      aiSettings: { defaultLanguage: 'hi' },
    });
    expect(reply?.detectedLanguage).toBe('hi');
    expect(reply?.text).toContain('Continuum Realty');
    expect(reply?.text.length).toBeGreaterThan(20);
  });
});
