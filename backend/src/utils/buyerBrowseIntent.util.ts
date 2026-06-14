/**
 * Multilingual buyer browse / inventory intent detection for WhatsApp.
 * Complements English-only regexes in whatsappTurnOrchestrator and formatBuyerCatalog.
 */

/** Hindi / Devanagari property & project vocabulary. */
const HI_BROWSE =
  /(?:परियोजन|प्रोजेक्ट|प्रॉपर्ट|प्रॉपर्टी|फ्लैट|अपार्ट|विला|प्लॉट|मकान|घर|लिस्टिंग|इन्वेंट|उपलब्ध|देख|बताए|बताइ|जान|जानकारी)/u;

const HI_COUNT =
  /(?:कितन|संख्या|गिनती|कुल|कितनी)/u;

const HI_TYPE_BROWSE =
  /(?:क्या|क्या आप|क्या आपके|क्या आपकी|है|हैं|मिल|उपलब्ध)/u;

/** Kannada script keywords. */
const KN_BROWSE =
  /(?:ಯೋಜನ|ಪ್ರಾಜೆ|ಪ್ರಾಪರ|ಫ್ಲಾಟ|ಅಪಾರ್ಟ|ವಿಲ್ಲ|ಪ್ಲಾಟ|ಮನೆ|ಲಿಸ್ಟಿಂ|ಲಭ್ಯ|ನೋಡ|ತೋರ)/u;

const KN_COUNT = /(?:ಎಷ್ಟ|ಯಾವ|ಒಟ್ಟ)/u;

/** Tamil script keywords. */
const TA_BROWSE =
  /(?:திட்ட|திட்டங|சொத்த|அபார்ட|வில்ல|ப்ளாட|வீட|பட்டிய|கிடை|பார)/u;

const TA_COUNT = /(?:எத்தன|எண்ண|மொத்த)/u;

/** Telugu script keywords. */
const TE_BROWSE =
  /(?:ప్రాజె|ప్రాపర|ఫ్లాట|అపార్ట|విల్ల|ప్లాట|ఇల్ల|లిస్ట|అంద|చూప|తెల)/u;

const TE_COUNT = /(?:ఎన|ఎంత|మొత్త)/u;

/** Romanized / Hinglish browse phrases. */
const ROMAN_BROWSE =
  /\b(projects?|properties|property|flats?|apartments?|villas?|plots?|listings?|inventory|dikhao|dikha|batao|bataiye|dekhna|dekh|jan|janna|janana|available|options)\b/i;

const ROMAN_COUNT =
  /\b(kitne|kitna|kitni|how many|number of|total|count)\b/i;

/** Property-type words across scripts (for type-filter browse). */
const MULTILINGUAL_TYPE_WORDS =
  /(?:villas?|apartments?|flats?|plots?|commercial|विला|फ्लैट|अपार್ಟ|प्लॉट|ಯೋಜನ|ವಿಲ್ಲ|ಫ್ಲಾಟ|ತಿಟ್ಟ|திட்ட|வில்ல|அபார்ட|ఫ్లాట|విల్ల|ప్రాజె)/iu;

const MULTILINGUAL_BHK = /\b(\d)\s*bhk\b/i;

/** Guard: scheduling / visit / price — Latin + common Indic words. */
function isMultilingualNegative(text: string): boolean {
  return (
    /\b(book|schedule|cancel|reschedule|visit|appointment|brochure|pdf|discount|call\s+me|price|cost|how\s+much)\b/i.test(text)
    || /(?:विज़िट|मुलाकात|बुक|कीमत|मूल्य|ब्रोशर|छूट|कॉल)/u.test(text)
  );
}

function hasIndicBrowseSignal(text: string): boolean {
  return (
    HI_BROWSE.test(text)
    || KN_BROWSE.test(text)
    || TA_BROWSE.test(text)
    || TE_BROWSE.test(text)
    || ROMAN_BROWSE.test(text)
  );
}

function hasIndicCountSignal(text: string): boolean {
  return (
    HI_COUNT.test(text)
    || KN_COUNT.test(text)
    || TA_COUNT.test(text)
    || TE_COUNT.test(text)
    || ROMAN_COUNT.test(text)
  );
}

/** True when message is primarily about browsing/listing projects or properties (non-English). */
export function isMultilingualBrowseIntent(message: string): boolean {
  const t = message.trim();
  if (!t) return false;
  if (isMultilingualNegative(t)) return false;

  if (hasIndicBrowseSignal(t)) return true;

  // Question about projects/properties in Devanagari without explicit noun still counts
  // e.g. "आपके प्रोजेक्ट" fragments
  if (/[\u0900-\u097F]/.test(t) && /(?:प्रोज|परियोज|प्रॉप)/u.test(t)) return true;

  return false;
}

/** Multilingual inventory-count questions. */
export function isMultilingualInventoryCountQuery(message: string): boolean {
  const t = message.trim();
  if (!t) return false;

  if (hasIndicCountSignal(t) && hasIndicBrowseSignal(t)) return true;

  if (HI_COUNT.test(t) && /(?:परियोज|प्रोज|प्रॉप|फ्लैट|विला)/u.test(t)) return true;
  if (KN_COUNT.test(t) && KN_BROWSE.test(t)) return true;
  if (TA_COUNT.test(t) && TA_BROWSE.test(t)) return true;
  if (TE_COUNT.test(t) && TE_BROWSE.test(t)) return true;

  return false;
}

/** Multilingual type-filter browse ("do you have villa" equivalents). */
export function isMultilingualPropertyTypeBrowseQuery(message: string): boolean {
  const t = message.trim();
  if (!t) return false;
  if (isMultilingualNegative(t)) return false;

  if (MULTILINGUAL_BHK.test(t)) return true;

  if (MULTILINGUAL_TYPE_WORDS.test(t) && (HI_TYPE_BROWSE.test(t) || hasIndicBrowseSignal(t) || /\?/.test(t))) {
    return true;
  }

  return false;
}

/** Map multilingual property-type keywords to canonical filter values. */
export function parseMultilingualBrowseFilters(message: string): {
  propertyType?: string;
  bedrooms?: number;
} {
  const t = message.toLowerCase();
  const filters: { propertyType?: string; bedrooms?: number } = {};

  if (/villas?|विला|ವಿಲ್ಲ|வில்ல|విల్ల/iu.test(t)) filters.propertyType = 'villa';
  else if (/apartments?|flats?|फ्लैट|अपार्ट|ಫ್ಲಾಟ|அபார்ட|ఫ్లాట/iu.test(t)) filters.propertyType = 'apartment';
  else if (/plots?|प्लॉट|ಪ್ಲಾಟ|ப்ளாட|ప్లాట/iu.test(t)) filters.propertyType = 'plot';
  else if (/\bcommercial\b/i.test(t)) filters.propertyType = 'commercial';

  const bhk = t.match(/\b(\d)\s*bhk\b/i);
  if (bhk) filters.bedrooms = Number(bhk[1]);

  return filters;
}
