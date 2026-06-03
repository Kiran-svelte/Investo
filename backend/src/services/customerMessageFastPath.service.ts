/**
 * Deterministic WhatsApp replies for greetings and identity questions.
 * Avoids slow/failing LLM calls on common first messages.
 */

import { isVisitSchedulingMessage } from './visitIntentFromMessage.service';

const GREETING_PATTERN =
  /^(hi|hello|hey|hii|hola|namaste|good\s*(morning|afternoon|evening)|start)\b[!.,?\s]*$/i;

const IDENTITY_PATTERN =
  /\b(who\s+are\s+you|what\s+are\s+you|who\s+is\s+this|what\s+is\s+this|which\s+company|about\s+you|tell\s+me\s+about\s+(you|yourself)|aap\s+kaun|tum\s+kaun|aap\s+kya\s+ho)\b/i;

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  kn: 'Kannada',
  te: 'Telugu',
  ta: 'Tamil',
  ml: 'Malayalam',
  mr: 'Marathi',
  bn: 'Bengali',
  gu: 'Gujarati',
  pa: 'Punjabi',
  or: 'Odia',
};

export function resolveAdminLanguageCode(aiSettings: { defaultLanguage?: string | null } | null | undefined): string {
  const code = typeof aiSettings?.defaultLanguage === 'string' ? aiSettings.defaultLanguage.trim().toLowerCase() : 'en';
  return LANGUAGE_LABELS[code] ? code : 'en';
}

export function isSimpleGreetingMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 40) {
    return false;
  }
  return GREETING_PATTERN.test(trimmed);
}

export function isIdentityQuestionMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 120) {
    return false;
  }
  return IDENTITY_PATTERN.test(trimmed);
}

export function shouldSkipKnowledgeSearchForMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return true;
  }
  return (
    isSimpleGreetingMessage(trimmed)
    || isIdentityQuestionMessage(trimmed)
    || isVisitSchedulingMessage(trimmed)
  );
}

export function buildFastPathCustomerReply(input: {
  customerMessage: string;
  companyName: string;
  customerName?: string | null;
  aiSettings?: { defaultLanguage?: string | null; greetingTemplate?: string | null } | null;
}): { text: string; detectedLanguage: string } | null {
  const trimmed = input.customerMessage.trim();
  if (!trimmed) {
    return null;
  }

  const lang = resolveAdminLanguageCode(input.aiSettings);
  const name = (input.customerName || '').trim();
  const company = input.companyName.trim() || 'our team';

  if (isSimpleGreetingMessage(trimmed)) {
    const template = typeof input.aiSettings?.greetingTemplate === 'string'
      ? input.aiSettings.greetingTemplate.trim()
      : '';
    const greeting = template
      ? template.replace(/\{business_name\}/gi, company)
      : null;

    if (greeting) {
      return { text: greeting, detectedLanguage: lang };
    }

    return {
      text: buildGreetingByLanguage(lang, name, company),
      detectedLanguage: lang,
    };
  }

  if (isIdentityQuestionMessage(trimmed)) {
    return {
      text: buildIdentityByLanguage(lang, name, company),
      detectedLanguage: lang,
    };
  }

  return null;
}

function buildGreetingByLanguage(lang: string, name: string, company: string): string {
  const who = name ? ` ${name}` : '';
  switch (lang) {
    case 'hi':
      return `*Namaste${who}!* 🙏\n\n${company} ke AI property assistant se baat ho rahi hai.\n\nBudget, area aur property type (apartment/villa/plot) batayiye — main sahi options suggest karunga.`;
    case 'kn':
      return `*Namaskara${who}!* 🙏\n\n${company} na AI property assistant.\n\nBudget, area mattu property type helisi — nimage options suggest maadutteve.`;
    case 'te':
      return `*Namaskaram${who}!* 🙏\n\n${company} AI property assistant.\n\nBudget, area mariyu property type cheppandi — best options suggest chestanu.`;
    case 'ta':
      return `*Vanakkam${who}!* 🙏\n\n${company} AI property assistant.\n\nBudget, area, property type sollunga — best options suggest pannuven.`;
    default:
      return `*Hello${who}!* 👋\n\nI'm the AI property assistant for *${company}*.\n\nShare your *budget*, *area*, and *property type* (apartment, villa, plot, or commercial) and I'll suggest the best matches.`;
  }
}

function buildIdentityByLanguage(lang: string, name: string, company: string): string {
  const who = name ? ` ${name}` : '';
  switch (lang) {
    case 'hi':
      return `Main *${company}* ka AI property assistant hoon${who ? `, ${name}` : ''}. 🏡\n\nMera kaam aapki requirement samajh kar sahi projects suggest karna aur *free site visit* arrange karna.\n\nBudget, area aur property type batayiye?`;
    case 'kn':
      return `Nanu *${company}* na AI property assistant${who ? `, ${name}` : ''}. 🏡\n\nNimma budget, area mattu property type helisi — options suggest maadutteve mattu site visit arrange maadutteve.`;
    case 'te':
      return `Nenu *${company}* AI property assistant${who ? `, ${name}` : ''}. 🏡\n\nMee budget, area, property type cheppandi — best options suggest chestanu mariyu site visit arrange chestanu.`;
    case 'ta':
      return `Naan *${company}* AI property assistant${who ? `, ${name}` : ''}. 🏡\n\nUnga budget, area, property type sollunga — best options suggest pannuven.`;
    default:
      return `I'm the *AI property assistant* for *${company}*${who ? `, ${name}` : ''}. 🏡\n\nI help you find matching projects and arrange a *free site visit* — I don't replace your sales team for final pricing.\n\nWhat *area*, *budget*, and *property type* are you looking for?`;
  }
}
