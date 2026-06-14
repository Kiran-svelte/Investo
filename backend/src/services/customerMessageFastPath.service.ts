/**
 * Deterministic WhatsApp replies for greetings and identity questions.
 * Avoids slow/failing LLM calls on common FIRST-CONTACT messages.
 *
 * RETURNING CLIENT RULE: If `conversationHistory` has 2+ prior messages,
 * the fast path returns null for simple greetings so the LLM can continue
 * the conversation naturally (property Q&A, follow-up, etc.) instead of
 * resetting to the first-time-buyer onboarding question.
 */

import config from '../config';
import { isVisitSchedulingMessage } from './visitIntentFromMessage.service';
import type { ActiveVisitContext, ActiveCallContext } from './liveLeadContext.service';
import {
  buildVisitAwareGreeting,
  buildCallAwareGreeting,
  buildCompactActiveVisitAck,
  buildCompactConfirmedCallAck,
} from './liveLeadContext.service';
import {
  resolveBuyerLanguage,
  normalizeBuyerLang,
  wasRecentVisitWelcomeSent,
  wasRecentCallWelcomeSent,
} from '../utils/buyerI18n.util';

/**
 * Minimum number of prior conversation messages that qualifies a user as
 * a "returning client" who should not receive the first-time-buyer greeting.
 * Each exchange = 2 messages (customer + AI), so 2 = at least one prior turn.
 */
const RETURNING_CLIENT_HISTORY_THRESHOLD = 2;

function hasPriorAiOutbound(
  history: Array<{ senderType?: string; content?: string }>,
): boolean {
  return history.some((m) => m.senderType === 'ai' || m.senderType === 'agent');
}

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

/**
 * Safe salutation for fallback/error messages — first name only, comma-prefixed.
 * Avoids awkward WhatsApp profile names like "Kannada media" appearing mid-sentence.
 */
export function formatCustomerSalutation(customerName: string | null | undefined): string {
  const raw = (customerName ?? '').trim();
  if (!raw) return '';
  const first = raw.split(/\s+/)[0];
  if (!first || first.length > 20) return '';
  if (/\b(media|channel|page|official|news|group|broadcast)\b/i.test(raw)) return '';
  return `, ${first}`;
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
/** Property-specific questions must always hit the knowledge index. */
export function isPropertyInquiryMessage(message: string): boolean {
  return /\b(property|project|amenit|brochure|price|cost|bhk|bedroom|rera|builder|location|villa|apartment|plot|commercial|details?|tell me about|more info|describe|specs?|configuration|possession|floor plan|highlights?|features?|sq\.?\s*ft|square feet|units?|carpet|built[- ]?up|maintenance|facing|vastu|payment plan|emi|khata|plot area|super built)\b/i.test(
    message,
  );
}

export function isPropertyDetailQuestion(message: string): boolean {
  return isPropertyInquiryMessage(message)
    && /\b(how much|what is|what's|when|where|which|tell me|explain|describe|details?|more about|carpet|possession|facing|maintenance|amenit|sq\.?\s*ft|price|cost|bhk|bedroom)\b/i.test(message);
}

/** Property detail/price/amenity questions should use H9 LLM + RAG, not thin H7 workflows. */
export function shouldBypassBuyerWorkflowForRichPropertyLlm(message: string): boolean {
  if (!config.features.detailQuestionLlm) return false;
  if (isVisitSchedulingMessage(message)) return false;
  return isPropertyInquiryMessage(message);
}

export function shouldSkipKnowledgeSearchForMessage(
  message: string,
  conversationHistoryLength = 0,
): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  if (isPropertyInquiryMessage(trimmed)) return false;
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
  conversationHistory?: Array<{ senderType?: string; content?: string; createdAt?: Date | string }>;
  propertyNames?: string[];
  conversationStage?: string | null;
  leadLanguage?: string | null;
  /** If provided and client sends a greeting, returns a visit-aware reply instead. */
  upcomingVisit?: ActiveVisitContext | null;
  /** Scheduled callback — second priority after visit-aware greeting. */
  upcomingCall?: ActiveCallContext | null;
}): { text: string; detectedLanguage: string } | null {
  const trimmed = input.customerMessage.trim();
  if (!trimmed) {
    return null;
  }

  const lang = resolveBuyerLanguage({
    message: trimmed,
    leadLanguage: input.leadLanguage,
    defaultLanguage: input.aiSettings?.defaultLanguage,
  });
  const name = (input.customerName || '').trim();
  const company = input.companyName.trim() || 'our team';

  if (isSimpleGreetingMessage(trimmed)) {
    const historyLength = (input.conversationHistory ?? []).length;
    const bookingStage = input.conversationStage === 'visit_booking'
      || input.conversationStage === 'confirmation'
      || input.conversationStage === 'commitment';

    if (bookingStage) {
      return null;
    }

    // Priority 1: Visit-aware greeting whenever the client has an active visit.
    if (input.upcomingVisit) {
      const visit = input.upcomingVisit;
      const propertyName = visit.propertyName ?? '';
      const history = input.conversationHistory ?? [];
      const useCompact = wasRecentVisitWelcomeSent(history, propertyName);

      return {
        text: useCompact
          ? buildCompactActiveVisitAck(input.customerName ?? null, visit, lang)
          : buildVisitAwareGreeting(input.customerName ?? null, visit, company, lang),
        detectedLanguage: lang,
      };
    }

    if (input.upcomingCall) {
      const call = input.upcomingCall;
      const history = input.conversationHistory ?? [];
      const useCompact =
        call.status === 'confirmed'
        && wasRecentCallWelcomeSent(history);

      return {
        text: useCompact
          ? buildCompactConfirmedCallAck(input.customerName ?? null, call, lang)
          : buildCallAwareGreeting(input.customerName ?? null, call, company, lang),
        detectedLanguage: lang,
      };
    }

    // Returning client without live visit/call — rapport handler builds enriched welcome.
    if (hasPriorAiOutbound(input.conversationHistory ?? []) || historyLength >= RETURNING_CLIENT_HISTORY_THRESHOLD) {
      return null;
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
      text: buildGreetingByLanguage(lang, name, company, input.leadLanguage),
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
    if (config.features.detailQuestionLlm && discussed) {
      const recentAi = history.slice(-6).filter((m) => m.senderType === 'ai');
      const hadPropertyReply = recentAi.some((m) =>
        String(m.content ?? '').toLowerCase().includes(discussed.toLowerCase()),
      );
      if (hadPropertyReply) return null;
    }
    return {
      text: buildAckByLanguage(lang, discussed, company),
      detectedLanguage: lang,
    };
  }

  return null;
}

function buildGreetingByLanguage(
  lang: string,
  name: string,
  company: string,
  leadLanguage?: string | null,
): string {
  const who = name ? `, *${name}*` : '';
  const english =
    `*Hey${who}!* 👋  Welcome to *${company}*.\n\n` +
    `I'm your personal property assistant — here to help you find the right home, fast. 🏡\n\n` +
    `What *area* are you looking in, and what's your rough *budget*?`;

  if (lang === 'en' && normalizeBuyerLang(leadLanguage) === 'hi') {
    const hindi =
      `\n\n*Namaste${who}!* 🙏\n\n` +
      `*${company}* mein aapka swagat hai — aap bilkul sahi jagah aaye hain. 🏡\n\n` +
      `Aap kis area mein ghar dekhna chahte hain, aur budget roughly kitna hai?`;
    return english + hindi;
  }

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
      return english;
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
