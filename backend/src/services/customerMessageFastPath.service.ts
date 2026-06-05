/**
 * Deterministic WhatsApp replies for greetings and identity questions.
 * Avoids slow/failing LLM calls on common FIRST-CONTACT messages.
 *
 * RETURNING CLIENT RULE: If `conversationHistory` has 2+ prior messages,
 * the fast path returns null for simple greetings so the LLM can continue
 * the conversation naturally (property Q&A, follow-up, etc.) instead of
 * resetting to the first-time-buyer onboarding question.
 */

import { isVisitSchedulingMessage } from './visitIntentFromMessage.service';
import type { ActiveVisitContext } from './liveLeadContext.service';
import { buildVisitAwareGreeting } from './liveLeadContext.service';

/**
 * Minimum number of prior conversation messages that qualifies a user as
 * a "returning client" who should not receive the first-time-buyer greeting.
 * Each exchange = 2 messages (customer + AI), so 2 = at least one prior turn.
 */
const RETURNING_CLIENT_HISTORY_THRESHOLD = 2;

/**
 * Matches messages that are simple greetings with no meaningful content.
 * The trailing group includes U+00A0 (non-breaking space) which WhatsApp
 * sometimes appends invisibly.
 */
const GREETING_PATTERN =
  /^(hi|hello|hey|hii|hola|namaste|good\s*(morning|afternoon|evening)|start)\b[!.,?\s\u00a0]*$/i;

const IDENTITY_PATTERN =
  /\b(who\s+are\s+you|what\s+are\s+you|who\s+is\s+this|what\s+is\s+this|which\s+company|about\s+you|tell\s+me\s+about\s+(you|yourself)|aap\s+kaun|tum\s+kaun|aap\s+kya\s+ho)\b/i;

/** Short positive replies after property Q&A — must not reset to welcome greeting. */
const ACK_PATTERN =
  /^(good|great|nice|thanks|thank\s*you|thx|ok|okay|cool|perfect|sounds\s+good|got\s+it|lovely|awesome|accha|theek|👍|✅|👌)[!.,?\s]*$/iu;

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

export function isConversationAcknowledgmentMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 40) {
    return false;
  }
  if (isSimpleGreetingMessage(trimmed) || isIdentityQuestionMessage(trimmed)) {
    return false;
  }
  return ACK_PATTERN.test(trimmed);
}

export function isIdentityQuestionMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 120) {
    return false;
  }
  return IDENTITY_PATTERN.test(trimmed);
}

/**
 * Returns true when knowledge base search should be skipped for a message.
 * Greetings from RETURNING clients (has prior history) are excluded so the
 * LLM can search for relevant properties and continue the conversation.
 *
 * @param message - User message text
 * @param conversationHistoryLength - Number of prior messages in the thread
 * @returns true if knowledge search should be bypassed
 */
export function shouldSkipKnowledgeSearchForMessage(
  message: string,
  conversationHistoryLength = 0,
): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  if (conversationHistoryLength >= RETURNING_CLIENT_HISTORY_THRESHOLD) {
    // Returning client: let LLM search knowledge base even for greetings
    return isConversationAcknowledgmentMessage(trimmed) || isVisitSchedulingMessage(trimmed);
  }
  return (
    isSimpleGreetingMessage(trimmed)
    || isIdentityQuestionMessage(trimmed)
    || isConversationAcknowledgmentMessage(trimmed)
    || isVisitSchedulingMessage(trimmed)
  );
}

function findLastDiscussedPropertyName(
  history: Array<{ senderType?: string; content?: string }>,
  propertyNames: string[],
): string | null {
  const names = propertyNames.map((n) => n.trim()).filter(Boolean);
  if (!names.length) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const content = String(history[i]?.content ?? '');
    if (!content) continue;
    for (const name of names) {
      if (content.toLowerCase().includes(name.toLowerCase())) {
        return name;
      }
    }
  }
  return null;
}

function buildAckByLanguage(lang: string, propertyName: string | null, company: string): string {
  const prop = propertyName ? `*${propertyName}*` : 'that';
  switch (lang) {
    case 'hi':
      return propertyName
        ? `बहुत अच्छा! ${prop} के बारे में और जानकारी चाहिए, या साइट विजिट बुक करें?`
        : `बहुत अच्छा! आगे कैसे मदद करूँ — और properties देखें या साइट विजिट बुक करें?`;
    default:
      return propertyName
        ? `Glad that helps! For ${prop}, would you like more details or to book a *free site visit*?`
        : `Glad that helps! Would you like to see more options from *${company}* or book a *free site visit*?`;
  }
}

export function buildFastPathCustomerReply(input: {
  customerMessage: string;
  companyName: string;
  customerName?: string | null;
  aiSettings?: { defaultLanguage?: string | null; greetingTemplate?: string | null } | null;
  conversationHistory?: Array<{ senderType?: string; content?: string }>;
  propertyNames?: string[];
  /** If provided and client sends a greeting, returns a visit-aware reply instead. */
  upcomingVisit?: ActiveVisitContext | null;
}): { text: string; detectedLanguage: string } | null {
  const trimmed = input.customerMessage.trim();
  if (!trimmed) {
    return null;
  }

  const lang = resolveAdminLanguageCode(input.aiSettings);
  const name = (input.customerName || '').trim();
  const company = input.companyName.trim() || 'our team';

  if (isSimpleGreetingMessage(trimmed)) {
    const historyLength = (input.conversationHistory ?? []).length;

    // Priority 1: Visit-aware greeting — only on FIRST contact or very fresh conversations.
    // If the conversation already has history (>= threshold), the LLM handles the greeting
    // with the full liveLeadContextBlock already in its system prompt. Without this guard,
    // customers typing 'hi' mid-conversation (e.g., after a reschedule) got the visit banner
    // again instead of a natural continuation — causing the 'greeting repeat' bug.
    if (input.upcomingVisit && historyLength < RETURNING_CLIENT_HISTORY_THRESHOLD) {
      return {
        text: buildVisitAwareGreeting(input.customerName ?? null, input.upcomingVisit, company),
        detectedLanguage: lang,
      };
    }

    // Priority 2: Returning client with prior conversation history.
    // Let the LLM handle it so it can continue the property discussion naturally
    // instead of resetting to "What area are you looking in? What is your budget?"
    if (historyLength >= RETURNING_CLIENT_HISTORY_THRESHOLD) {
      return null; // LLM takes over with full context
    }

    // Priority 3: First-contact or new client — use greeting template or default.
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

  if (isConversationAcknowledgmentMessage(trimmed)) {
    const history = input.conversationHistory ?? [];
    const discussed = findLastDiscussedPropertyName(history, input.propertyNames ?? []);
    return {
      text: buildAckByLanguage(lang, discussed, company),
      detectedLanguage: lang,
    };
  }

  return null;
}

function buildGreetingByLanguage(lang: string, name: string, company: string): string {
  const who = name ? `, *${name}*` : '';
  switch (lang) {
    case 'hi':
      return `*Namaste${who}!* 🙏\n\n*${company}* mein aapka swagat hai — aap bilkul sahi jagah aaye hain. 🏡\n\nAap kis area mein ghar dekhna chahte hain, aur budget roughly kitna hai?`;
    case 'kn':
      return `*Namaskara${who}!* 🙏\n\n*${company}* ge swagata — neevu sari jagake bandiddeeri. 🏡\n\nYavu area nalli mane noduttiddiri, budget roughly eshtu?`;
    case 'te':
      return `*Namaskaram${who}!* 🙏\n\n*${company}* ki svagatam — mee correct chotu vacharu. 🏡\n\nEe area lo property chustunnaru, budget daadupu enta?`;
    case 'ta':
      return `*Vanakkam${who}!* 🙏\n\n*${company}* ku varaverppu — correct idattilukkae vanteerkal. 🏡\n\nEtha area la property paarkureerkal, budget roughly enna?`;
    default:
      return (
        `*Hey${who}!* 👋  Welcome to *${company}*.\n\n` +
        `I'm your personal property assistant — here to help you find the right home, fast. 🏡\n\n` +
        `What *area* are you looking in, and what's your rough *budget*?`
      );
  }
}


function buildIdentityByLanguage(lang: string, name: string, company: string): string {
  const who = name ? `, *${name}*` : '';
  switch (lang) {
    case 'hi':
      return `Main *${company}* ka property assistant hoon${who}. 🏡\n\nApke liye sahi projects dhundhna aur *free site visit* arrange karna — yahi kaam hai mera.\n\nKis area aur type ka ghar dhundh rahe hain?`;
    case 'kn':
      return `Nanu *${company}* property assistant${who}. 🏡\n\nNimma budget mattu needs ge match aaguvante options suggest maadutteve, mattu *free site visit* arrange maadutteve.\n\nYavu area, yaava type?`;
    case 'te':
      return `Nenu *${company}* property assistant${who}. 🏡\n\nMee requirements ku match ayye properties suggest chestanu — *free site visit* arrange chestanu.\n\nEe area, emi type chustunnaru?`;
    case 'ta':
      return `Naan *${company}* property assistant${who}. 🏡\n\nUnga requirement ku match aana properties suggest pannuven — *free site visit* arrange pannuven.\n\nEtha area, enna type paarkureerkal?`;
    default:
      return (
        `I'm the *property assistant* for *${company}*${who}. 🏡\n\n` +
        `I match you with the right properties and help arrange a *free site visit* — ` +
        `I don't replace your agent for final pricing or booking.\n\n` +
        `What *area* and *property type* are you exploring?`
      );
  }
}
