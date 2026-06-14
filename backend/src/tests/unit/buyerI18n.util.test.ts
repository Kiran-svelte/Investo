import {
  detectLanguageFromMessage,
  resolveBuyerLanguage,
  tBuyer,
  wasRecentVisitWelcomeSent,
  nurtureMessageForReason,
} from '../../utils/buyerI18n.util';
import { buildVisitAwareGreeting, type ActiveVisitContext } from '../../services/liveLeadContext.service';

function sampleVisit(overrides: Partial<ActiveVisitContext> = {}): ActiveVisitContext {
  return {
    visitId: 'v1',
    propertyId: 'p1',
    propertyName: 'Palmvilla',
    scheduledAt: new Date('2026-06-17T04:30:00.000Z'),
    status: 'confirmed',
    agentName: 'Kiran Sales',
    agentPhone: null,
    notes: null,
    ...overrides,
  };
}

describe('buyerI18n.util', () => {
  it('detects Hindi from Devanagari script', () => {
    expect(detectLanguageFromMessage('मुझे प्रॉपर्टी चाहिए')).toBe('hi');
  });

  it('detects Hindi from Hinglish romanized words', () => {
    expect(detectLanguageFromMessage('kya aap mujhe property dikha sakte ho')).toBe('hi');
    expect(detectLanguageFromMessage('accha theek hai')).toBe('hi');
  });

  it('detects Kannada from script', () => {
    expect(detectLanguageFromMessage('ನಮಸ್ಕಾರ')).toBe('kn');
  });

  it('prefers message language over lead and admin default', () => {
    expect(resolveBuyerLanguage({
      message: 'kya hai yeh',
      leadLanguage: 'en',
      defaultLanguage: 'en',
    })).toBe('hi');
  });

  it('uses English for neutral English input even when lead prefers another language', () => {
    expect(resolveBuyerLanguage({
      message: 'book a visit',
      leadLanguage: 'kn',
      defaultLanguage: 'te',
    })).toBe('en');
  });

  it('defaults to English when message is neutral and no lead language', () => {
    expect(resolveBuyerLanguage({
      message: 'hello',
      defaultLanguage: 'te',
    })).toBe('en');
  });

  it('basic social messages always resolve to English', () => {
    expect(resolveBuyerLanguage({ message: 'namaste', leadLanguage: 'hi' })).toBe('en');
    expect(resolveBuyerLanguage({ message: 'thanks', leadLanguage: 'hi' })).toBe('en');
    expect(resolveBuyerLanguage({ message: 'नमस्ते', leadLanguage: 'hi' })).toBe('en');
  });

  it('uses lead language for interactive taps without message text', () => {
    expect(resolveBuyerLanguage({ leadLanguage: 'hi' })).toBe('hi');
    expect(resolveBuyerLanguage({ leadLanguage: 'kn' })).toBe('kn');
    expect(resolveBuyerLanguage({})).toBe('en');
  });

  it('switches language when user changes script in next message', () => {
    expect(resolveBuyerLanguage({ message: 'ಮನೆ ಬೇಕು', leadLanguage: 'hi' })).toBe('kn');
    expect(resolveBuyerLanguage({ message: 'show me properties', leadLanguage: 'hi' })).toBe('en');
  });

  it('confirmed visit greeting does not offer confirm-the-visit menu', () => {
    const text = buildVisitAwareGreeting('Ravi', sampleVisit({ status: 'confirmed' }), 'Investo', 'en');
    expect(text).toContain('confirmed');
    expect(text).not.toMatch(/Confirm the visit/i);
    expect(text).toMatch(/Reschedule|Need anything else/i);
  });

  it('scheduled visit greeting still offers confirm option', () => {
    const text = buildVisitAwareGreeting(null, sampleVisit({ status: 'scheduled', agentName: null }), 'Investo', 'en');
    expect(text).toMatch(/Confirm the visit/i);
  });

  it('Hindi visit greeting uses Hindi copy', () => {
    const text = buildVisitAwareGreeting('Ravi', sampleVisit({ status: 'confirmed', agentName: 'Kiran' }), 'Investo', 'hi');
    expect(text).toContain('swagat');
    expect(text).toContain('confirm');
    expect(text).not.toMatch(/Confirm the visit/i);
  });

  it('wasRecentVisitWelcomeSent detects duplicate welcome within window', () => {
    const now = new Date();
    const history = [
      {
        senderType: 'ai',
        content: 'Hello! Your site visit is *confirmed* ✅\n🏠 *Palmvilla Brochure*',
        createdAt: new Date(now.getTime() - 60 * 60 * 1000),
      },
    ];
    expect(wasRecentVisitWelcomeSent(history, 'Palmvilla Brochure')).toBe(true);
    expect(wasRecentVisitWelcomeSent(history, 'Other Project')).toBe(false);
    expect(wasRecentVisitWelcomeSent([], 'Palmvilla')).toBe(false);
  });

  it('nurtureMessageForReason localizes follow-up templates', () => {
    const hi = nurtureMessageForReason('hi', '48h_no_activity', { name: 'Ravi', area: 'Whitefield' });
    const en = nurtureMessageForReason('en', '48h_no_activity', { name: 'Ravi', area: 'Whitefield' });
    expect(hi).toContain('Ravi');
    expect(hi).not.toBe(en);
    expect(tBuyer('hi', 'more_from_records')).toContain('records');
  });
});
