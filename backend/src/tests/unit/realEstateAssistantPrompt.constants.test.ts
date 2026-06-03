import {
  detectAuthorityLimitTopic,
  buildRealEstateAssistantPolicyPrompt,
} from '../../constants/realEstateAssistantPrompt.constants';

describe('realEstateAssistantPrompt.constants', () => {
  test('detects finalize/booking price requests', () => {
    expect(detectAuthorityLimitTopic('I want to book this flat at ₹1.2 Cr')).toBe('finalize_price');
  });

  test('detects availability checks', () => {
    expect(detectAuthorityLimitTopic('Is unit 304 still available?')).toBe('confirm_availability');
  });

  test('detects loan eligibility questions', () => {
    expect(detectAuthorityLimitTopic('Am I eligible for a home loan with 15L income?')).toBe('loan_eligibility');
  });

  test('detects investment advice requests', () => {
    expect(detectAuthorityLimitTopic('Is Lake Vista a good investment?')).toBe('investment_advice');
  });

  test('policy prompt includes capabilities and limits', () => {
    const block = buildRealEstateAssistantPolicyPrompt();
    expect(block).toContain('WHAT YOU CAN DO');
    expect(block).toContain('AI LIMITS');
    expect(block).toContain('Finalize or negotiate price');
  });
});
