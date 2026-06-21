/**
 * Buyer-facing WhatsApp copy — multi-language templates.
 *
 * Reply language policy:
 * - Default is always English.
 * - Match the customer's CURRENT message language when they clearly write in it.
 * - Basic social messages (hi, thanks, namaste alone) always get English replies.
 * - Button taps (no message text) use the lead's last message language.
 */

export const SUPPORTED_BUYER_LANGS = [
  'en', 'hi', 'kn', 'te', 'ta', 'ml', 'mr', 'bn', 'gu', 'pa', 'or',
] as const;

export type BuyerLang = (typeof SUPPORTED_BUYER_LANGS)[number];

const LANG_SET = new Set<string>(SUPPORTED_BUYER_LANGS);

/** Unicode script → primary language for that script. */
const SCRIPT_DETECTORS: Array<{ re: RegExp; lang: BuyerLang }> = [
  { re: /[\u0C80-\u0CFF]/, lang: 'kn' },
  { re: /[\u0C00-\u0C7F]/, lang: 'te' },
  { re: /[\u0B80-\u0BFF]/, lang: 'ta' },
  { re: /[\u0D00-\u0D7F]/, lang: 'ml' },
  { re: /[\u0980-\u09FF]/, lang: 'bn' },
  { re: /[\u0A80-\u0AFF]/, lang: 'gu' },
  { re: /[\u0A00-\u0A7F]/, lang: 'pa' },
  { re: /[\u0B00-\u0B7F]/, lang: 'or' },
  { re: /[\u0900-\u097F]/, lang: 'hi' },
];

const HINGLISH_WORDS =
  /\b(kya|hai|hain|nahi|na|kaise|mujhe|chahiye|bhai|ji|accha|theek|aap|tum|main|mera|ghar|dekhna|kitna|kahan|kab|batao|bataiye|namaste|dhanyavad|shukriya)\b/i;

const KANNADA_LATIN =
  /\b(namaskara|swagata|mane|noduttiddiri|eshtu|yavu|alli|beda|sari)\b/i;

const TELUGU_LATIN =
  /\b(namaskaram|svagatam|chustunnaru|enta|ekkada|cheppandi|sare)\b/i;

const TAMIL_LATIN =
  /\b(vanakkam|varaverppu|paarkureerkal|enna|engae|sollunga)\b/i;

/** Greetings, thanks, and one-word social replies — always answered in English. */
const BASIC_SOCIAL_EN =
  /^(hi|hello|hey|hii|hola|thanks|thank you|thankyou|thank\s*u|ok|okay|yes|no|sure|bye|goodbye|good\s*(morning|afternoon|evening)|namaste|dhanyavad|dhanyawad|shukriya|start)\b[!.,?\s\u00a0🙏]*$/i;

const BASIC_SOCIAL_DEVANAGARI =
  /^(?:नमस्ते|नमस्कार|धन्यवाद|शुक्रिया|हैलो|हां|हाँ|ठीक)[!.,?\s🙏]*$/u;

export function isBasicSocialMessage(message: string): boolean {
  const t = message.trim();
  if (!t || t.length > 48) return false;
  return BASIC_SOCIAL_EN.test(t) || BASIC_SOCIAL_DEVANAGARI.test(t);
}

export function normalizeBuyerLang(code: string | null | undefined): BuyerLang {
  const c = typeof code === 'string' ? code.trim().toLowerCase() : '';
  return LANG_SET.has(c) ? (c as BuyerLang) : 'en';
}

/** Detect language from the customer's message text (script + common romanized words). */
export function detectLanguageFromMessage(message: string): BuyerLang | null {
  const t = message.trim();
  if (!t) return null;

  for (const { re, lang } of SCRIPT_DETECTORS) {
    if (re.test(t)) return lang;
  }

  if (HINGLISH_WORDS.test(t)) return 'hi';
  if (KANNADA_LATIN.test(t)) return 'kn';
  if (TELUGU_LATIN.test(t)) return 'te';
  if (TAMIL_LATIN.test(t)) return 'ta';

  return null;
}

export function resolveBuyerLanguage(input: {
  message?: string | null;
  leadLanguage?: string | null;
  /** @deprecated Ignored — default is always English unless the message signals another language. */
  defaultLanguage?: string | null;
}): BuyerLang {
  const message = typeof input.message === 'string' ? input.message.trim() : '';

  if (message) {
    if (isBasicSocialMessage(message)) return 'en';
    const fromMessage = detectLanguageFromMessage(message);
    if (fromMessage) return fromMessage;
    return 'en';
  }

  return normalizeBuyerLang(input.leadLanguage);
}

type BuyerCopyKey =
  | 'visit_status_confirmed'
  | 'visit_status_pending'
  | 'visit_status_scheduled'
  | 'visit_status_generic'
  | 'visit_welcome_back'
  | 'visit_menu_pending'
  | 'visit_menu_confirmed'
  | 'visit_menu_scheduled'
  | 'visit_compact_confirmed'
  | 'visit_compact_scheduled'
  | 'call_compact_confirmed'
  | 'returning_compact_greeting'
  | 'post_visit_compact_greeting'
  | 'call_status_confirmed'
  | 'call_status_pending'
  | 'call_status_scheduled'
  | 'call_welcome_back'
  | 'call_menu'
  | 'more_from_records'
  | 'btn_change_time'
  | 'btn_property_details'
  | 'btn_call_agent'
  | 'btn_confirm_visit'
  | 'btn_reschedule'
  | 'btn_cancel'
  | 'btn_cancel_call'
  | 'btn_book_visit'
  | 'btn_call_me'
  | 'btn_share_feedback'
  | 'btn_talk_agent'
  | 'btn_see_options'
  | 'btn_view_project_listings'
  | 'btn_narrow_search'
  | 'btn_emi'
  | 'btn_more_details'
  | 'visit_status_header'
  | 'visit_status_none'
  | 'visit_status_recent'
  | 'visit_status_single_footer'
  | 'visit_status_multi_header'
  | 'visit_status_multi_footer'
  | 'visit_disambiguate_prompt'
  | 'visit_disambiguate_option'
  | 'nurture_48h'
  | 'nurture_3d'
  | 'nurture_7d'
  | 'nurture_30d'
  | 'nurture_visit_feedback'
  | 'post_visit_feedback_prompt'
  | 'post_visit_feedback_rating_ack'
  | 'post_visit_feedback_loved_ack'
  | 'post_visit_feedback_more_options_ack'
  | 'post_visit_feedback_negotiate_ack'
  | 'post_visit_feedback_defer_ack'
  | 'post_visit_feedback_negative_ack'
  | 'returning_pivot'
  | 'returning_welcome_back'
  | 'returning_area_hint'
  | 'returning_explore_hint'
  | 'prop_label_price'
  | 'prop_label_type'
  | 'prop_label_bedrooms'
  | 'prop_label_location'
  | 'prop_label_builder'
  | 'prop_label_rera'
  | 'prop_label_brochure'
  | 'prop_label_floor_plans'
  | 'prop_label_price_list'
  | 'prop_label_amenities'
  | 'prop_label_details'
  | 'prop_on_file'
  | 'project_browse_none'
  | 'project_browse_header'
  | 'project_browse_line'
  | 'project_browse_footer'
  | 'project_selected_intro'
  | 'project_listings_hidden_note'
  | 'visit_pending_approval_prefix'
  | 'visit_booked_property_reminder'
  | 'btn_browse_projects'
  | 'choose_project'
  | 'choose_property'
  | 'our_projects'
  | 'project_listing_count_label'
  | 'showing_listings_truncated'
  | 'visit_detail_confirmed_prefix'
  | 'visit_detail_scheduled_prefix'
  | 'visit_browsing_other_confirmed_note'
  | 'visit_browsing_other_scheduled_note'
  | 'visit_browsing_other_date_only_note'
  | 'property_not_selected_yet'
  | 'property_no_longer_available'
  | 'browse_list_title'
  | 'browse_list_section'
  | 'catalog_empty_default'
  | 'catalog_empty_bhk'
  | 'catalog_empty_type'
  | 'inventory_count_header_projects'
  | 'inventory_count_header_properties'
  | 'inventory_count_none'
  | 'inventory_count_type_part'
  | 'inventory_count_upcoming'
  | 'inventory_count_cta'
  | 'catalog_match_single_intro'
  | 'catalog_match_single_type'
  | 'catalog_match_single_price'
  | 'catalog_match_single_location'
  | 'catalog_match_single_bedrooms'
  | 'catalog_match_single_brochure'
  | 'catalog_match_single_footer'
  | 'catalog_match_multi_header'
  | 'catalog_match_multi_footer'
  | 'catalog_match_location_on_request'
  | 'no_matching_properties'
  | 'btn_filter_apartment'
  | 'btn_filter_villa'
  | 'btn_filter_plot'
  | 'btn_filter_commercial'
  | 'btn_filter_other'
  | 'btn_filter_1bhk'
  | 'btn_filter_2bhk'
  | 'btn_filter_3bhk'
  | 'btn_filter_4bhk'
  | 'btn_filter_5bhk'
  | 'property_sold_explanation'
  | 'filter_not_in_catalog'
  | 'filter_already_viewing'
  | 'filter_applied_projects'
  | 'filter_applied_list'
  | 'filter_error'
  | 'filter_inventory_hint'
  | 'filter_inventory_empty'
  | 'filter_closest_option'
  | 'filter_waitlist_cta'
  | 'interactive_visit_confirm_no_visit'
  | 'interactive_visit_confirm_failed'
  | 'interactive_visit_confirmed'
  | 'interactive_visit_reschedule_prompt'
  | 'interactive_visit_reschedule_no_visit'
  | 'interactive_book_visit_no_property'
  | 'interactive_book_visit_invalid_property'
  | 'interactive_book_visit_initiated'
  | 'interactive_share_feedback'
  | 'interactive_call_time_prompt'
  | 'interactive_call_cancel_not_found'
  | 'interactive_call_cancel_confirmed'
  | 'interactive_call_cancelled'
  | 'interactive_call_reschedule_prompt'
  | 'interactive_visit_time_parse_failed'
  | 'interactive_visit_property_unavailable'
  | 'interactive_visit_no_agent'
  | 'interactive_visit_confirmed_change'
  | 'interactive_generic_slot_no_property'
  | 'greeting_hindi_followup'
  | 'out_of_scope_property_clarify'
  | 'scoped_browse_offer'
  | 'second_visit_cross_project_confirm'
  | 'second_visit_allowed_note'
  | 'visit_same_property_already';

type CopyVars = Record<string, string | number | null | undefined>;

function langPack(en: string, hi: string): Record<BuyerLang, string> {
  const row = { en, hi } as Record<BuyerLang, string>;
  for (const code of SUPPORTED_BUYER_LANGS) {
    if (!row[code]) row[code] = en;
  }
  return row;
}

const COPY: Record<BuyerCopyKey, Record<BuyerLang, string>> = {
  visit_welcome_back: {
    en: 'Hello{name}! Welcome back to *{company}* 👋',
    hi: 'Namaste{name}! *{company}* mein phir se swagat hai 👋',
    kn: 'Namaskara{name}! *{company}* ge punaha swagata 👋',
    te: 'Namaskaram{name}! *{company}* ki malli svagatam 👋',
    ta: 'Vanakkam{name}! *{company}* ku matrum varaverppu 👋',
    ml: 'Namaskaram{name}! *{company}* leku punar swagatam 👋',
    mr: 'Namaskar{name}! *{company}* madhye punha swagat 👋',
    bn: 'Nomoshkar{name}! *{company}* e abar swagatam 👋',
    gu: 'Namaste{name}! *{company}* ma punah swagat 👋',
    pa: 'Sat sri akal{name}! *{company}* vich phir swagat 👋',
    or: 'Namaskar{name}! *{company}* re puni swagat 👋',
  },
  visit_status_confirmed: {
    en: 'Your site visit is *confirmed* ✅',
    hi: 'Aapki site visit *confirm* ho chuki hai ✅',
    kn: 'Nimma site visit *confirm* aagide ✅',
    te: 'Mee site visit *confirm* ayyindi ✅',
    ta: 'Ungal site visit *confirm* aagirukku ✅',
    ml: 'Ninte site visit *confirm* cheythu ✅',
    mr: 'Tumchi site visit *confirm* zali aahe ✅',
    bn: 'Apnar site visit *confirm* hoyeche ✅',
    gu: 'Tamari site visit *confirm* thai gayi che ✅',
    pa: 'Tuhadi site visit *confirm* ho chuki hai ✅',
    or: 'Apananka site visit *confirm* heichi ✅',
  },
  visit_status_pending: {
    en: 'Your site visit request is *awaiting team approval* ⏳',
    hi: 'Aapki site visit request *team approval* ka wait kar rahi hai ⏳',
    kn: 'Nimma site visit request *team approval* ge wait maaduttide ⏳',
    te: 'Mee site visit request *team approval* kosam wait chestondi ⏳',
    ta: 'Ungal site visit request *team approval* ku wait pannuthu ⏳',
    ml: 'Ninte site visit request *team approval* nokkikondirikkunnu ⏳',
    mr: 'Tumchi site visit request *team approval* sathi wait kart aahe ⏳',
    bn: 'Apnar site visit request *team approval* er jonno wait korche ⏳',
    gu: 'Tamari site visit request *team approval* mate wait kare che ⏳',
    pa: 'Tuhadi site visit request *team approval* da wait kar rahi hai ⏳',
    or: 'Apananka site visit request *team approval* pain wait karuchi ⏳',
  },
  visit_status_scheduled: {
    en: 'You have an upcoming site visit 🗓️',
    hi: 'Aapki ek upcoming site visit hai 🗓️',
    kn: 'Nimge ondu upcoming site visit ide 🗓️',
    te: 'Mee upcoming site visit undi 🗓️',
    ta: 'Ungal upcoming site visit irukku 🗓️',
    ml: 'Ninak oru upcoming site visit undu 🗓️',
    mr: 'Tumchya upcoming site visit aahe 🗓️',
    bn: 'Apnar ekti upcoming site visit ache 🗓️',
    gu: 'Tamari ek upcoming site visit che 🗓️',
    pa: 'Tuhadi ik upcoming site visit hai 🗓️',
    or: 'Apananka eka upcoming site visit achhi 🗓️',
  },
  visit_status_generic: {
    en: 'Your visit status: *{status}*',
    hi: 'Aapki visit ki status: *{status}*',
    kn: 'Nimma visit status: *{status}*',
    te: 'Mee visit status: *{status}*',
    ta: 'Ungal visit status: *{status}*',
    ml: 'Ninte visit status: *{status}*',
    mr: 'Tumchi visit status: *{status}*',
    bn: 'Apnar visit status: *{status}*',
    gu: 'Tamari visit status: *{status}*',
    pa: 'Tuhadi visit status: *{status}*',
    or: 'Apananka visit status: *{status}*',
  },
  visit_menu_pending: {
    en: 'Would you like to:\n📅 Change time\n❌ Cancel\n📞 Call agent',
    hi: 'Kya aap chahte hain:\n📅 Time badle\n❌ Cancel karein\n📞 Agent se baat karein',
    kn: 'Nimge beku:\n📅 Time badlaayisi\n❌ Cancel\n📞 Agent jote maataadu',
    te: 'Meeku kavala:\n📅 Time marchandi\n❌ Cancel\n📞 Agent tho matladandi',
    ta: 'Ungalukku venuma:\n📅 Time maathunga\n❌ Cancel\n📞 Agent oda pesunga',
    ml: 'Ninak vendo:\n📅 Time maattam\n❌ Cancel\n📞 Agent nodu samsarikkam',
    mr: 'Tumhala pahije:\n📅 Time badla\n❌ Cancel\n📞 Agent shi bolaa',
    bn: 'Apni ki chaan:\n📅 Time bodlan\n❌ Cancel\n📞 Agent er sathe kotha bolun',
    gu: 'Tamne joiye:\n📅 Time badlo\n❌ Cancel\n📞 Agent sathe vat karo',
    pa: 'Tusi ki chaunde ho:\n📅 Time badlo\n❌ Cancel\n📞 Agent naal gal karo',
    or: 'Apana chahanti:\n📅 Time badleiba\n❌ Cancel\n📞 Agent sahita katha heba',
  },
  visit_menu_confirmed: {
    en: 'Need anything else?\n📅 Reschedule\n❌ Cancel\n📞 Call agent',
    hi: 'Aur kuch chahiye?\n📅 Reschedule\n❌ Cancel\n📞 Agent se baat',
    kn: 'Bere yenu beku?\n📅 Reschedule\n❌ Cancel\n📞 Agent jote maataadu',
    te: 'Inkemi kavala?\n📅 Reschedule\n❌ Cancel\n📞 Agent tho matladandi',
    ta: 'Vera edhavadhu venuma?\n📅 Reschedule\n❌ Cancel\n📞 Agent oda pesunga',
    ml: 'Vere enthenkilum vendo?\n📅 Reschedule\n❌ Cancel\n📞 Agent nodu samsarikkam',
    mr: 'Anya kahi pahije?\n📅 Reschedule\n❌ Cancel\n📞 Agent shi bolaa',
    bn: 'Ar kichu lagbe?\n📅 Reschedule\n❌ Cancel\n📞 Agent er sathe kotha bolun',
    gu: 'Biju kai joiye?\n📅 Reschedule\n❌ Cancel\n📞 Agent sathe vat karo',
    pa: 'Hor kuj chahida?\n📅 Reschedule\n❌ Cancel\n📞 Agent naal gal karo',
    or: 'Aau kichhi darkar?\n📅 Reschedule\n❌ Cancel\n📞 Agent sahita katha heba',
  },
  visit_menu_scheduled: {
    en: 'Would you like to:\n✅ Confirm the visit\n📅 Reschedule\n❌ Cancel\n📞 Call agent',
    hi: 'Kya aap chahte hain:\n✅ Visit confirm karein\n📅 Reschedule\n❌ Cancel\n📞 Agent se baat',
    kn: 'Nimge beku:\n✅ Visit confirm\n📅 Reschedule\n❌ Cancel\n📞 Agent jote maataadu',
    te: 'Meeku kavala:\n✅ Visit confirm\n📅 Reschedule\n❌ Cancel\n📞 Agent tho matladandi',
    ta: 'Ungalukku venuma:\n✅ Visit confirm\n📅 Reschedule\n❌ Cancel\n📞 Agent oda pesunga',
    ml: 'Ninak vendo:\n✅ Visit confirm\n📅 Reschedule\n❌ Cancel\n📞 Agent nodu samsarikkam',
    mr: 'Tumhala pahije:\n✅ Visit confirm\n📅 Reschedule\n❌ Cancel\n📞 Agent shi bolaa',
    bn: 'Apni ki chaan:\n✅ Visit confirm\n📅 Reschedule\n❌ Cancel\n📞 Agent er sathe kotha bolun',
    gu: 'Tamne joiye:\n✅ Visit confirm\n📅 Reschedule\n❌ Cancel\n📞 Agent sathe vat karo',
    pa: 'Tusi ki chaunde ho:\n✅ Visit confirm\n📅 Reschedule\n❌ Cancel\n📞 Agent naal gal karo',
    or: 'Apana chahanti:\n✅ Visit confirm\n📅 Reschedule\n❌ Cancel\n📞 Agent sahita katha heba',
  },
  call_compact_confirmed: {
    en: 'Welcome back{name}! Your callback on {when} is still confirmed ✅\n\nTap a button to reschedule or speak to your agent.',
    hi: 'Phir se swagat{name}! {when} par callback ab bhi confirmed hai ✅\n\nReschedule ya agent se baat ke liye button dabayein.',
    kn: 'Punaha swagata{name}! {when} callback innu confirmed ide ✅\n\nReschedule athava agent jote maataadalu button press maadi.',
    te: 'Malli svagatam{name}! {when} callback inka confirm ayyindi ✅\n\nReschedule or agent tho matladadaniki button press cheyandi.',
    ta: 'Matrum varaverppu{name}! {when} callback innum confirm ✅\n\nReschedule or agent oda pesanum na button press pannunga.',
    ml: 'Punar swagatam{name}! {when} callback innum confirm aanu ✅\n\nReschedule or agent nodu samsarikkan button press cheyyuka.',
    mr: 'Punha swagat{name}! {when} callback ajunhi confirm aahe ✅\n\nReschedule kiva agent shi bolnyasathi button dabaa.',
    bn: 'Abar swagatam{name}! {when} callback ekhono confirm ✅\n\nReschedule ba agent er sathe kotha bolar jonno button chapun.',
    gu: 'Punah swagat{name}! {when} callback haju confirm che ✅\n\nReschedule ke agent sathe vat karva button dabavo.',
    pa: 'Phir swagat{name}! {when} callback abhi vi confirm hai ✅\n\nReschedule ya agent naal gal kar layi button dabao.',
    or: 'Puni swagat{name}! {when} callback ebe confirm achhi ✅\n\nReschedule ba agent sahita katha heba pain button dabantu.',
  },
  returning_compact_greeting: {
    en: 'Welcome back{name}! 👋 What would you like next — more properties, a visit, or details?',
    hi: 'Phir se swagat{name}! 👋 Aage kya chahiye — aur properties, visit, ya details?',
    kn: 'Punaha swagata{name}! 👋 Next enu beku — hosa properties, visit, athava details?',
    te: 'Malli svagatam{name}! 👋 Tarvata emi kavali — inka properties, visit, leda details?',
    ta: 'Matrum varaverppu{name}! 👋 Appuram enna venum — intha options, visit, illa details?',
    ml: 'Punar swagatam{name}! 👋 Ippol enthanu venam — koodi properties, visit, atho details?',
    mr: 'Punha swagat{name}! 👋 Pudhe kay pahije — ajun options, visit, ki details?',
    bn: 'Abar swagatam{name}! 👋 Er por ki chai — aro properties, visit, ba details?',
    gu: 'Punah swagat{name}! 👋 Aagad shu joiye — vadhu properties, visit, ke details?',
    pa: 'Phir swagat{name}! 👋 Agge ki chahida — hor properties, visit, ya details?',
    or: 'Puni swagat{name}! 👋 Parabartike kana chahiba — aro properties, visit, ba details?',
  },
  post_visit_compact_greeting: {
    en: 'Welcome back{name}! 👋 Happy to help with feedback, your agent, or more options.',
    hi: 'Phir se swagat{name}! 👋 Feedback, agent, ya aur options — main madad kar sakta hoon.',
    kn: 'Punaha swagata{name}! 👋 Feedback, agent, athava hosa options — nannu sahaya maadutte.',
    te: 'Malli svagatam{name}! 👋 Feedback, agent, leda inka options — nenu help chestanu.',
    ta: 'Matrum varaverppu{name}! 👋 Feedback, agent, illa intha options — naan help pannuven.',
    ml: 'Punar swagatam{name}! 👋 Feedback, agent, atho koodi options — enikku sahayikkam.',
    mr: 'Punha swagat{name}! 👋 Feedback, agent, ki ajun options — mi madat karu shakto.',
    bn: 'Abar swagatam{name}! 👋 Feedback, agent, ba aro options — ami sahajjo korte pari.',
    gu: 'Punah swagat{name}! 👋 Feedback, agent, ke vadhu options — hu madad kari shaku.',
    pa: 'Phir swagat{name}! 👋 Feedback, agent, ya hor options — main madad kar sakda haan.',
    or: 'Puni swagat{name}! 👋 Feedback, agent, ba aro options — mu sahajya kariparibi.',
  },
  visit_compact_confirmed: {
    en: 'Welcome back{name}! Your visit to *{property}* on {when} is still confirmed ✅\n\nTap a button if you need to reschedule or speak to your agent.',
    hi: 'Phir se swagat{name}! *{property}* par {when} ki visit ab bhi confirmed hai ✅\n\nReschedule ya agent se baat ke liye button dabayein.',
    kn: 'Punaha swagata{name}! *{property}* ge {when} visit innu confirmed ide ✅\n\nReschedule athava agent jote maataadalu button press maadi.',
    te: 'Malli svagatam{name}! *{property}* ki {when} visit inka confirm ayyindi ✅\n\nReschedule or agent tho matladadaniki button press cheyandi.',
    ta: 'Matrum varaverppu{name}! *{property}* ku {when} visit innum confirm ✅\n\nReschedule or agent oda pesanum na button press pannunga.',
    ml: 'Punar swagatam{name}! *{property}* il {when} visit innum confirm aanu ✅\n\nReschedule or agent nodu samsarikkan button press cheyyuka.',
    mr: 'Punha swagat{name}! *{property}* la {when} visit ajunhi confirm aahe ✅\n\nReschedule kiva agent shi bolnyasathi button dabaa.',
    bn: 'Abar swagatam{name}! *{property}* e {when} visit ekhono confirm ✅\n\nReschedule ba agent er sathe kotha bolar jonno button chapun.',
    gu: 'Punah swagat{name}! *{property}* par {when} visit haju confirm che ✅\n\nReschedule ke agent sathe vat karva button dabavo.',
    pa: 'Phir swagat{name}! *{property}* te {when} visit abhi vi confirm hai ✅\n\nReschedule ya agent naal gal kar layi button dabao.',
    or: 'Puni swagat{name}! *{property}* re {when} visit ebe confirm achhi ✅\n\nReschedule ba agent sahita katha heba pain button dabantu.',
  },
  visit_compact_scheduled: {
    en: 'Welcome back{name}! Your visit to *{property}* on {when} is still booked 🗓️\n\nTap a button if you need to change the time or speak to your agent.',
    hi: 'Phir se swagat{name}! *{property}* par {when} ki visit ab bhi booked hai 🗓️\n\nTime badalne ya agent se baat ke liye button dabayein.',
    kn: 'Punaha swagata{name}! *{property}* ge {when} visit innu booked ide 🗓️\n\nTime change athava agent jote maataadalu button press maadi.',
    te: 'Malli svagatam{name}! *{property}* ki {when} visit inka booked ayyindi 🗓️\n\nTime marchadaniki or agent tho matladadaniki button press cheyandi.',
    ta: 'Matrum varaverppu{name}! *{property}* ku {when} visit innum booked 🗓️\n\nTime change or agent oda pesanum na button press pannunga.',
    ml: 'Punar swagatam{name}! *{property}* il {when} visit innum booked aanu 🗓️\n\nTime change or agent nodu samsarikkan button press cheyyuka.',
    mr: 'Punha swagat{name}! *{property}* la {when} visit ajunhi booked aahe 🗓️\n\nTime badalnyasathi kiva agent shi bolnyasathi button dabaa.',
    bn: 'Abar swagatam{name}! *{property}* e {when} visit ekhono booked 🗓️\n\nTime change ba agent er sathe kotha bolar jonno button chapun.',
    gu: 'Punah swagat{name}! *{property}* par {when} visit haju booked che 🗓️\n\nTime change ke agent sathe vat karva button dabavo.',
    pa: 'Phir swagat{name}! *{property}* te {when} visit abhi vi booked hai 🗓️\n\nTime change ya agent naal gal kar layi button dabao.',
    or: 'Puni swagat{name}! *{property}* re {when} visit ebe booked achhi 🗓️\n\nTime change ba agent sahita katha heba pain button dabantu.',
  },
  call_welcome_back: {
    en: 'Hello{name}! Welcome back to *{company}* 👋',
    hi: 'Namaste{name}! *{company}* mein phir se swagat hai 👋',
    kn: 'Namaskara{name}! *{company}* ge punaha swagata 👋',
    te: 'Namaskaram{name}! *{company}* ki malli svagatam 👋',
    ta: 'Vanakkam{name}! *{company}* ku matrum varaverppu 👋',
    ml: 'Namaskaram{name}! *{company}* leku punar swagatam 👋',
    mr: 'Namaskar{name}! *{company}* madhye punha swagat 👋',
    bn: 'Nomoshkar{name}! *{company}* e abar swagatam 👋',
    gu: 'Namaste{name}! *{company}* ma punah swagat 👋',
    pa: 'Sat sri akal{name}! *{company}* vich phir swagat 👋',
    or: 'Namaskar{name}! *{company}* re puni swagat 👋',
  },
  call_status_confirmed: {
    en: 'Your callback is *confirmed* ✅',
    hi: 'Aapka callback *confirm* ho gaya hai ✅',
    kn: 'Nimma callback *confirm* aagide ✅',
    te: 'Mee callback *confirm* ayyindi ✅',
    ta: 'Ungal callback *confirm* aagirukku ✅',
    ml: 'Ninte callback *confirm* cheythu ✅',
    mr: 'Tumcha callback *confirm* zala aahe ✅',
    bn: 'Apnar callback *confirm* hoyeche ✅',
    gu: 'Tamaro callback *confirm* thai gayo che ✅',
    pa: 'Tuhada callback *confirm* ho gaya hai ✅',
    or: 'Apananka callback *confirm* heigala ✅',
  },
  call_status_pending: {
    en: 'Your callback request is *awaiting approval* ⏳',
    hi: 'Aapka callback request *approval* ka wait kar raha hai ⏳',
    kn: 'Nimma callback request *approval* ge wait maaduttide ⏳',
    te: 'Mee callback request *approval* kosam wait chestondi ⏳',
    ta: 'Ungal callback request *approval* ku wait pannuthu ⏳',
    ml: 'Ninte callback request *approval* nokkikondirikkunnu ⏳',
    mr: 'Tumcha callback request *approval* sathi wait kart aahe ⏳',
    bn: 'Apnar callback request *approval* er jonno wait korche ⏳',
    gu: 'Tamaro callback request *approval* mate wait kare che ⏳',
    pa: 'Tuhada callback request *approval* da wait kar raha hai ⏳',
    or: 'Apananka callback request *approval* pain wait karuchi ⏳',
  },
  call_status_scheduled: {
    en: 'You have an upcoming callback 📞',
    hi: 'Aapka ek upcoming callback hai 📞',
    kn: 'Nimge ondu upcoming callback ide 📞',
    te: 'Mee upcoming callback undi 📞',
    ta: 'Ungal upcoming callback irukku 📞',
    ml: 'Ninak oru upcoming callback undu 📞',
    mr: 'Tumcha upcoming callback aahe 📞',
    bn: 'Apnar ekti upcoming callback ache 📞',
    gu: 'Tamaro ek upcoming callback che 📞',
    pa: 'Tuhada ik upcoming callback hai 📞',
    or: 'Apananka eka upcoming callback achhi 📞',
  },
  call_menu: {
    en: 'Would you like to change the time, cancel, or explore more projects while you wait?',
    hi: 'Kya aap time badalna, cancel karna, ya aur projects dekhna chahte hain jab tak wait karte hain?',
    kn: 'Time badlaayisi, cancel maadi, athava wait maadutthiruvaaga bere projects nodabahude?',
    te: 'Time marchandi, cancel cheyandi, leda wait chestunte vere projects chudalara?',
    ta: 'Time maathunga, cancel pannunga, illa wait pannumbodhu vera projects paarkalama?',
    ml: 'Time maattamo, cancel cheyyamo, atho wait cheyyumpol vere projects nokamo?',
    mr: 'Time badlaaycha, cancel karaycha, ki wait kartana dusre projects baghayche?',
    bn: 'Time bodhte, cancel korte, ba wait korar somoy onno projects dekhte chan?',
    gu: 'Time badlvo, cancel karvo, ke wait karta vere projects jovo?',
    pa: 'Time badalna, cancel karna, ya wait karan dauraan hor projects vekhna?',
    or: 'Time badleiba, cancel karibe, na wait karuthibaa samayre anya projects dekhiba?',
  },
  more_from_records: {
    en: '📌 *More from our records:*',
    hi: '📌 *हमारे रिकॉर्ड से और:*',
    kn: '📌 *Namma records inda hechchu:*',
    te: '📌 *Maa records nundi inka:*',
    ta: '📌 *Engal records il irundhu innum:*',
    ml: '📌 *Nammude records il ninnu kooduthal:*',
    mr: '📌 *Aamchya records madhun ajun:*',
    bn: '📌 *Amader records theke aro:*',
    gu: '📌 *Amara records mathi vadhu:*',
    pa: '📌 *Sade records ton hor:*',
    or: '📌 *Ama records ru adhika:*',
  },
  btn_change_time: {
    en: '📅 Change Time',
    hi: '📅 समय बदलें',
    kn: '📅 Time Badla',
    te: '📅 Time Marchu',
    ta: '📅 Time Maathu',
    ml: '📅 Time Maattu',
    mr: '📅 Time Badla',
    bn: '📅 Time Bodho',
    gu: '📅 Time Badlo',
    pa: '📅 Time Badlo',
    or: '📅 Time Badle',
  },
  btn_property_details: {
    en: '📋 View Listing',
    hi: '🏗️ संपत्ति विवरण',
    kn: '🏗️ Property Details',
    te: '🏗️ Property Details',
    ta: '🏗️ Property Details',
    ml: '🏗️ Property Details',
    mr: '🏗️ Property Details',
    bn: '🏗️ Property Details',
    gu: '🏗️ Property Details',
    pa: '🏗️ Property Details',
    or: '🏗️ Property Details',
  },
  btn_call_agent: {
    en: '📞 Call Agent',
    hi: '📞 एजेंट को कॉल',
    kn: '📞 Agent Call',
    te: '📞 Agent Call',
    ta: '📞 Agent Call',
    ml: '📞 Agent Call',
    mr: '📞 Agent Call',
    bn: '📞 Agent Call',
    gu: '📞 Agent Call',
    pa: '📞 Agent Call',
    or: '📞 Agent Call',
  },
  btn_confirm_visit: {
    en: '✅ Confirm Visit',
    hi: '✅ Visit Confirm',
    kn: '✅ Visit Confirm',
    te: '✅ Visit Confirm',
    ta: '✅ Visit Confirm',
    ml: '✅ Visit Confirm',
    mr: '✅ Visit Confirm',
    bn: '✅ Visit Confirm',
    gu: '✅ Visit Confirm',
    pa: '✅ Visit Confirm',
    or: '✅ Visit Confirm',
  },
  btn_reschedule: {
    en: '📅 Reschedule',
    hi: '📅 Reschedule',
    kn: '📅 Reschedule',
    te: '📅 Reschedule',
    ta: '📅 Reschedule',
    ml: '📅 Reschedule',
    mr: '📅 Reschedule',
    bn: '📅 Reschedule',
    gu: '📅 Reschedule',
    pa: '📅 Reschedule',
    or: '📅 Reschedule',
  },
  btn_cancel: {
    en: 'Cancel Call',
    hi: 'Cancel Call',
    kn: 'Cancel Call',
    te: 'Cancel Call',
    ta: 'Cancel Call',
    ml: 'Cancel Call',
    mr: 'Cancel Call',
    bn: 'Cancel Call',
    gu: 'Cancel Call',
    pa: 'Cancel Call',
    or: 'Cancel Call',
  },
  btn_cancel_call: {
    en: 'Cancel Call',
    hi: 'Call Cancel',
    kn: 'Call Cancel',
    te: 'Call Cancel',
    ta: 'Call Cancel',
    ml: 'Call Cancel',
    mr: 'Call Cancel',
    bn: 'Call Cancel',
    gu: 'Call Cancel',
    pa: 'Call Cancel',
    or: 'Call Cancel',
  },
  btn_book_visit: {
    en: 'Book Visit',
    hi: 'Visit Book',
    kn: 'Visit Book',
    te: 'Visit Book',
    ta: 'Visit Book',
    ml: 'Visit Book',
    mr: 'Visit Book',
    bn: 'Visit Book',
    gu: 'Visit Book',
    pa: 'Visit Book',
    or: 'Visit Book',
  },
  btn_call_me: {
    en: 'Call Me',
    hi: 'कॉल करें',
    kn: 'Call Me',
    te: 'Call Me',
    ta: 'Call Me',
    ml: 'Call Me',
    mr: 'Call Me',
    bn: 'Call Me',
    gu: 'Call Me',
    pa: 'Call Me',
    or: 'Call Me',
  },
  btn_share_feedback: {
    en: 'Share Feedback',
    hi: 'Feedback Dein',
    kn: 'Feedback Kodi',
    te: 'Feedback Ivandi',
    ta: 'Feedback Solunga',
    ml: 'Feedback Tharu',
    mr: 'Feedback Dya',
    bn: 'Feedback Din',
    gu: 'Feedback Aapo',
    pa: 'Feedback Deo',
    or: 'Feedback Antu',
  },
  btn_talk_agent: {
    en: 'Talk to Agent',
    hi: 'Agent Se Baat',
    kn: 'Agent Jote Maata',
    te: 'Agent Tho Matladu',
    ta: 'Agent Oda Pesu',
    ml: 'Agent Nodu Samsarik',
    mr: 'Agent Shi Bol',
    bn: 'Agent Er Sathe Kotha',
    gu: 'Agent Sathe Vat Karo',
    pa: 'Agent Naal Gal Karo',
    or: 'Agent Sahita Katha',
  },
  btn_see_options: {
    en: 'See More Options',
    hi: 'Aur Options',
    kn: 'Innu Options',
    te: 'Inka Options',
    ta: 'Vera Options',
    ml: 'Kooduthal Options',
    mr: 'Anya Options',
    bn: 'Aro Options',
    gu: 'Vadhu Options',
    pa: 'Hor Options',
    or: 'Adhika Options',
  },
  btn_view_project_listings: {
    en: '🏘️ View Project Listings',
    hi: 'लिस्टिंग देखें',
    kn: 'Listings Nodi',
    te: 'Listings Chudandi',
    ta: 'Listings Paarunga',
    ml: 'Listings Kanu',
    mr: 'Listings Paha',
    bn: 'Listings Dekhun',
    gu: 'Listings Juo',
    pa: 'Listings Dekho',
    or: 'Listings Dekhantu',
  },
  btn_browse_projects: {
    en: 'View Projects',
    hi: 'परियोजनाएँ देखें',
    kn: 'View Projects',
    te: 'View Projects',
    ta: 'View Projects',
    ml: 'View Projects',
    mr: 'View Projects',
    bn: 'View Projects',
    gu: 'View Projects',
    pa: 'View Projects',
    or: 'View Projects',
  },
  btn_narrow_search: {
    en: 'Narrow Search',
    hi: 'Search Sankuchit',
    kn: 'Search Sankuchisu',
    te: 'Search Sankuchinchu',
    ta: 'Search Kurukku',
    ml: 'Search Kurachu',
    mr: 'Search Sankuchit',
    bn: 'Search Sankuchit',
    gu: 'Search Sankuchit',
    pa: 'Search Sankuchit',
    or: 'Search Sankuchit',
  },
  btn_emi: {
    en: 'EMI Calculator',
    hi: 'EMI Calculator',
    kn: 'EMI Calculator',
    te: 'EMI Calculator',
    ta: 'EMI Calculator',
    ml: 'EMI Calculator',
    mr: 'EMI Calculator',
    bn: 'EMI Calculator',
    gu: 'EMI Calculator',
    pa: 'EMI Calculator',
    or: 'EMI Calculator',
  },
  btn_more_details: {
    en: 'More Details',
    hi: 'Aur Details',
    kn: 'Innu Details',
    te: 'Inka Details',
    ta: 'Vera Details',
    ml: 'Kooduthal Details',
    mr: 'Anya Details',
    bn: 'Aro Details',
    gu: 'Vadhu Details',
    pa: 'Hor Details',
    or: 'Adhika Details',
  },
  visit_status_header: {
    en: '*YOUR VISIT*',
    hi: '*AAPKI VISIT*',
    kn: '*NIMMA VISIT*',
    te: '*MEE VISIT*',
    ta: '*UNGAL VISIT*',
    ml: '*NINTE VISIT*',
    mr: '*TUMCHI VISIT*',
    bn: '*APNAR VISIT*',
    gu: '*TAMARI VISIT*',
    pa: '*TUHADI VISIT*',
    or: '*APANANKA VISIT*',
  },
  visit_status_none: {
    en: "You don't have any upcoming visits right now.\n\nWould you like to *book a free site visit*? Reply with a property name and preferred date/time.",
    hi: 'Abhi koi upcoming visit nahi hai.\n\n*Free site visit* book karna chahenge? Property name aur date/time bhejein.',
    kn: 'Iga upcoming visit illa.\n\n*Free site visit* book maadabahude? Property name mattu date/time kalisi.',
    te: 'Ippudu upcoming visit ledu.\n\n*Free site visit* book cheyalara? Property name mariyu date/time pampandi.',
    ta: 'Ippol upcoming visit illa.\n\n*Free site visit* book pannalama? Property name matrum date/time anupunga.',
    ml: 'Ippol upcoming visit illa.\n\n*Free site visit* book cheyyamo? Property name um date/time um ayachu.',
    mr: 'Aata upcoming visit nahi.\n\n*Free site visit* book karaychi? Property name ani date/time pathva.',
    bn: 'Ekhon kono upcoming visit nei.\n\n*Free site visit* book korben? Property name ebong date/time pathan.',
    gu: 'Have upcoming visit nathi.\n\n*Free site visit* book karvo? Property name ane date/time moklo.',
    pa: 'Hun koi upcoming visit nahi.\n\n*Free site visit* book karna? Property name te date/time bhejo.',
    or: 'Ebe kono upcoming visit nahi.\n\n*Free site visit* book karibe? Property name o date/time pathantu.',
  },
  visit_status_recent: {
    en: 'Your most recent visit was to *{property}* ({when}) - status: *{status}*\n\nYou don\'t have an upcoming visit scheduled. Would you like to *book a new site visit*?',
    hi: 'Aapki last visit *{property}* par thi ({when}) - status: *{status}*\n\nKoi upcoming visit nahi. *Nayi site visit* book karein?',
    kn: 'Nimma last visit *{property}* ge ({when}) - status: *{status}*\n\nUpcoming visit illa. *Hosa site visit* book maadabahude?',
    te: 'Mee last visit *{property}* ki ({when}) - status: *{status}*\n\nUpcoming visit ledu. *Kotha site visit* book cheyalara?',
    ta: 'Ungal last visit *{property}* ku ({when}) - status: *{status}*\n\nUpcoming visit illa. *Pudhu site visit* book pannalama?',
    ml: 'Ninte last visit *{property}* il ({when}) - status: *{status}*\n\nUpcoming visit illa. *Puthiya site visit* book cheyyamo?',
    mr: 'Tumchi last visit *{property}* la ({when}) - status: *{status}*\n\nUpcoming visit nahi. *Navin site visit* book karaychi?',
    bn: 'Apnar last visit *{property}* e ({when}) - status: *{status}*\n\nUpcoming visit nei. *Notun site visit* book korben?',
    gu: 'Tamari last visit *{property}* par ({when}) - status: *{status}*\n\nUpcoming visit nathi. *Navi site visit* book karvo?',
    pa: 'Tuhadi last visit *{property}* te ({when}) - status: *{status}*\n\nUpcoming visit nahi. *Navi site visit* book karna?',
    or: 'Apananka last visit *{property}* re ({when}) - status: *{status}*\n\nUpcoming visit nahi. *Nua site visit* book karibe?',
  },
  visit_status_single_footer: {
    en: 'Tap a button below to *reschedule* or *call your agent*.',
    hi: 'Neeche button se *reschedule* ya *agent se baat* karein.',
    kn: 'Kelage button inda *reschedule* athava *agent jote maataadu*.',
    te: 'Kinda button tho *reschedule* leda *agent tho matladandi*.',
    ta: 'Keela button la *reschedule* illa *agent oda pesunga*.',
    ml: 'Thazhe button use cheythu *reschedule* atho *agent nodu samsarikkam*.',
    mr: 'Khali button varun *reschedule* kiva *agent shi bolaa*.',
    bn: 'Nicher button diye *reschedule* ba *agent er sathe kotha bolun*.',
    gu: 'Niche button thi *reschedule* ke *agent sathe vat karo*.',
    pa: 'Hethan button naal *reschedule* ya *agent naal gal karo*.',
    or: 'Tale button re *reschedule* ba *agent sahita katha heba*.',
  },
  visit_status_multi_header: {
    en: 'You have *{count} upcoming visits*:',
    hi: 'Aapki *{count} upcoming visits* hain:',
    kn: 'Nimge *{count} upcoming visits* ide:',
    te: 'Mee *{count} upcoming visits* unnayi:',
    ta: 'Ungal *{count} upcoming visits* irukku:',
    ml: 'Ninak *{count} upcoming visits* undu:',
    mr: 'Tumchya *{count} upcoming visits* aahet:',
    bn: 'Apnar *{count} upcoming visits* ache:',
    gu: 'Tamari *{count} upcoming visits* che:',
    pa: 'Tuhadiyan *{count} upcoming visits* han:',
    or: 'Apananka *{count} upcoming visits* achhi:',
  },
  visit_status_multi_footer: {
    en: 'Reply with the property name to *Confirm*, *Reschedule*, or *Cancel* a specific visit.',
    hi: 'Property name likh kar kisi visit ko *Confirm*, *Reschedule*, ya *Cancel* karein.',
    kn: 'Property name helisi visit *Confirm*, *Reschedule*, athava *Cancel* maadi.',
    te: 'Property name tho visit *Confirm*, *Reschedule*, leda *Cancel* cheyandi.',
    ta: 'Property name solli visit *Confirm*, *Reschedule*, illa *Cancel* pannunga.',
    ml: 'Property name parayuka visit *Confirm*, *Reschedule*, atho *Cancel* cheyyuka.',
    mr: 'Property name sangun visit *Confirm*, *Reschedule*, kiva *Cancel* kara.',
    bn: 'Property name diye visit *Confirm*, *Reschedule*, ba *Cancel* korun.',
    gu: 'Property name thi visit *Confirm*, *Reschedule*, ke *Cancel* karo.',
    pa: 'Property name naal visit *Confirm*, *Reschedule*, ya *Cancel* karo.',
    or: 'Property name lekhiki visit *Confirm*, *Reschedule*, ba *Cancel* karantu.',
  },
  visit_disambiguate_prompt: {
    en: 'You have {count} upcoming visits:\n{options}\nReply 1 or 2, or name the project.',
    hi: 'Aapki {count} upcoming visits hain:\n{options}\n1 ya 2 reply karein, ya project ka naam likhein.',
    kn: 'Nimge {count} upcoming visits ide:\n{options}\n1 athava 2 reply maadi, athava project hesaru helisi.',
    te: 'Mee {count} upcoming visits unnayi:\n{options}\n1 leda 2 reply cheyandi, leda project peru cheppandi.',
    ta: 'Ungal {count} upcoming visits irukku:\n{options}\n1 or 2 reply pannunga, illa project peyar sollunga.',
    ml: 'Ninak {count} upcoming visits undu:\n{options}\n1 atho 2 reply cheyyuka, atho project peru parayuka.',
    mr: 'Tumchya {count} upcoming visits aahet:\n{options}\n1 kiva 2 reply kara, kiva project nav sangaa.',
    bn: 'Apnar {count} upcoming visits ache:\n{options}\n1 ba 2 reply korun, ba project er naam likhun.',
    gu: 'Tamari {count} upcoming visits che:\n{options}\n1 ke 2 reply karo, ke project nu naam lakho.',
    pa: 'Tuhadiyan {count} upcoming visits han:\n{options}\n1 ya 2 reply karo, ya project da naam likho.',
    or: 'Apananka {count} upcoming visits achhi:\n{options}\n1 ba 2 reply karantu, ba project ra naam lekhantu.',
  },
  visit_disambiguate_option: {
    en: '{index}. {property} — {when} ({status})',
    hi: '{index}. {property} — {when} ({status})',
    kn: '{index}. {property} — {when} ({status})',
    te: '{index}. {property} — {when} ({status})',
    ta: '{index}. {property} — {when} ({status})',
    ml: '{index}. {property} — {when} ({status})',
    mr: '{index}. {property} — {when} ({status})',
    bn: '{index}. {property} — {when} ({status})',
    gu: '{index}. {property} — {when} ({status})',
    pa: '{index}. {property} — {when} ({status})',
    or: '{index}. {property} — {when} ({status})',
  },
  nurture_48h: {
    en: 'Hi {name}!\n\nWe noticed you were looking at properties with us. Have you found what you need?\n\nReply YES for fresh recommendations.',
    hi: 'Hi {name}!\n\nHumne dekha aap properties dekh rahe the. Kya aapko mil gaya jo chahiye tha?\n\nFresh recommendations ke liye YES likhein.',
    kn: 'Hi {name}!\n\nNeevu properties noduttiddiri endu nodiddevu. Needide sikkida?\n\nFresh recommendations ge YES banni.',
    te: 'Hi {name}!\n\nMeeru properties chustunnaru ani chusam. Meeku kavalsindi dorikinda?\n\nFresh recommendations ki YES reply cheyandi.',
    ta: 'Hi {name}!\n\nNeenga properties paartheergal endru paartheom. Ungalukku thevaiyana kidaithadha?\n\nFresh recommendations ku YES reply pannunga.',
    ml: 'Hi {name}!\n\nNingal properties nokkiyirunnu ennu nammal kandu. Ningalkku vendathu kittiyo?\n\nFresh recommendations nu YES reply cheyyuka.',
    mr: 'Hi {name}!\n\nTumhi properties baghat hota te amhala disle. Tumhala pahije te milale ka?\n\nFresh recommendations sathi YES reply kara.',
    bn: 'Hi {name}!\n\nApni properties dekhchen dekhechi. Apnar proyojon moto peyechen?\n\nFresh recommendations er jonno YES likhun.',
    gu: 'Hi {name}!\n\nTamne properties joi rahya hata te ame joiu. Tamne joiye te malyu?\n\nFresh recommendations mate YES reply karo.',
    pa: 'Hi {name}!\n\nAsi dekheya tusi properties dekh rahe si. Tusi labh liya jo chahida si?\n\nFresh recommendations layi YES likho.',
    or: 'Hi {name}!\n\nApana properties dekhuthaile dekhibaku pai\u0067alu. Apananka darkar thila miligala?\n\nFresh recommendations pain YES reply karantu.',
  },
  nurture_3d: {
    en: 'Hi {name}! Still exploring? I have new options that may fit your criteria in {area}. Reply YES to see your top 3 matches.',
    hi: 'Hi {name}! Ab bhi explore kar rahe hain? {area} mein aapke criteria ke naye options hain. Top 3 matches ke liye YES likhein.',
    kn: 'Hi {name}! Innu explore maaduttiddira? {area} nalli nimma criteria ge hosa options ide. Top 3 matches ge YES banni.',
    te: 'Hi {name}! Inka explore chestunnara? {area} lo mee criteria ki kotha options unnayi. Top 3 matches ki YES reply cheyandi.',
    ta: 'Hi {name}! Innum explore pannureergala? {area} la ungal criteria ku pudhu options irukku. Top 3 matches ku YES reply pannunga.',
    ml: 'Hi {name}! Innum explore cheyyunnundo? {area} il ningalude criteria ku puthiya options undu. Top 3 matches nu YES reply cheyyuka.',
    mr: 'Hi {name}! Ajunhi explore kart aahet? {area} madhye tumchya criteria sathi navin options aahet. Top 3 matches sathi YES reply kara.',
    bn: 'Hi {name}! Ekhono explore korchen? {area} te apnar criteria onujayi notun options ache. Top 3 matches er jonno YES likhun.',
    gu: 'Hi {name}! Haju explore karo cho? {area} ma tamara criteria mate navi options che. Top 3 matches mate YES reply karo.',
    pa: 'Hi {name}! Haje vi explore kar rahe ho? {area} vich tuhade criteria layi nave options han. Top 3 matches layi YES likho.',
    or: 'Hi {name}! Ebe bi explore karuchanti? {area} re apanananka criteria pain nua options achhi. Top 3 matches pain YES reply karantu.',
  },
  nurture_7d: {
    en: 'Hi {name}! Quick update: demand in {area} has been strong. If you\'re still interested, I can hold a visit slot this week. Reply VISIT to book.',
    hi: 'Hi {name}! Quick update: {area} mein demand strong hai. Agar ab bhi interested hain, is hafte visit slot hold kar sakta hoon. VISIT likhein.',
    kn: 'Hi {name}! Quick update: {area} nalli demand strong ide. Innu interested iddre, ee week visit slot hold maadbahudu. VISIT banni.',
    te: 'Hi {name}! Quick update: {area} lo demand strong ga undi. Inka interested unte, ee week visit slot hold cheyagalanu. VISIT reply cheyandi.',
    ta: 'Hi {name}! Quick update: {area} la demand strong aa irukku. Innum interested na, indha week visit slot hold pannalam. VISIT reply pannunga.',
    ml: 'Hi {name}! Quick update: {area} il demand strong aanu. Innum interested aanenkil, ee week visit slot hold cheyyam. VISIT reply cheyyuka.',
    mr: 'Hi {name}! Quick update: {area} madhye demand strong aahe. Ajunhi interested asal tar ya week visit slot hold karu shakto. VISIT reply kara.',
    bn: 'Hi {name}! Quick update: {area} te demand strong. Ekhono interested hole, ei week visit slot hold korte pari. VISIT likhun.',
    gu: 'Hi {name}! Quick update: {area} ma demand strong che. Haju interested ho to aa week visit slot hold kari shakay. VISIT reply karo.',
    pa: 'Hi {name}! Quick update: {area} vich demand strong hai. Haje vi interested ho ta is hafte visit slot hold kar sakda haan. VISIT likho.',
    or: 'Hi {name}! Quick update: {area} re demand strong. Ebe bi interested thile, ei week visit slot hold kariparibe. VISIT reply karantu.',
  },
  nurture_30d: {
    en: 'Hi {name}! It\'s been a while. Want a quick update on what is available now in {area}? Reply YES and I will share it.',
    hi: 'Hi {name}! Kaafi time ho gaya. {area} mein ab kya available hai, quick update chahiye? YES likhein, main share karunga.',
    kn: 'Hi {name}! Santoshavagide. {area} nalli iga enu available ide quick update beku? YES banni, share maadthini.',
    te: 'Hi {name}! Chala rojulu ayyindi. {area} lo ippudu emi available undo quick update kavala? YES reply cheyandi, share chestanu.',
    ta: 'Hi {name}! Konjam neram aachu. {area} la ippodhu enna available nu quick update venuma? YES reply pannunga, share pannuren.',
    ml: 'Hi {name}! Kazhinju. {area} il ippol enthu available ennu quick update veno? YES reply cheyyuka, share cheyyam.',
    mr: 'Hi {name}! Khup divas zale. {area} madhye ata kay available aahe te quick update pahije ka? YES reply kara, share karen.',
    bn: 'Hi {name}! Onek din hoye geche. {area} te ekhon ki available ache quick update chan? YES likhun, share korbo.',
    gu: 'Hi {name}! Ghano samay thai gayo. {area} ma have shu available che te quick update joiye? YES reply karo, share karish.',
    pa: 'Hi {name}! Kaafi time ho gaya. {area} vich hun ki available hai quick update chahida? YES likho, share karunga.',
    or: 'Hi {name}! Bahuta din heigala. {area} re ebe kana available achhi quick update darkar? YES reply karantu, share karibi.',
  },
  nurture_visit_feedback: {
    en: 'Hi {name}!\n\nHow was your site visit yesterday? Reply with your feedback: loved it, need more options, or want to negotiate.',
    hi: 'Hi {name}!\n\nKal ki site visit kaisi rahi? Feedback dein: pasand aaya, aur options chahiye, ya negotiate karna hai.',
    kn: 'Hi {name}!\n\nNinne site visit hegide? Feedback kodi: ishta aaytu, innu options beku, athava negotiate maadabeku.',
    te: 'Hi {name}!\n\nNinna site visit ela undi? Feedback ivandi: nachindi, inka options kavali, leda negotiate cheyali.',
    ta: 'Hi {name}!\n\nNethu site visit eppadi irundhadhu? Feedback solunga: pudichadhu, vera options venum, illa negotiate pannanum.',
    ml: 'Hi {name}!\n\nIthu site visit engane aayirunnu? Feedback tharuka: ishtapettu, vere options venam, atho negotiate cheyyanam.',
    mr: 'Hi {name}!\n\nKalchi site visit kashi hoti? Feedback dya: avadla, ankhin options pahijet, ki negotiate karayche aahe.',
    bn: 'Hi {name}!\n\nGotoke site visit kemon chhilo? Feedback din: bhalo laglo, aro options lagbe, ba negotiate korte chan.',
    gu: 'Hi {name}!\n\nGai kale site visit kem hati? Feedback aapo: gamyu, vadhu options joiye, ke negotiate karvu che.',
    pa: 'Hi {name}!\n\nKal site visit kivein si? Feedback deo: pasand aaya, hor options chahide, ya negotiate karna hai.',
    or: 'Hi {name}!\n\nGatakalira site visit kemiti thila? Feedback antu: bhala lagila, aau options darkar, ba negotiate karibe.',
  },
  post_visit_feedback_prompt: {
    en: 'Hi {name}! 🏡\n\nThank you for visiting *{property}* with us.\n\nHow was your experience?\n• Rate *1–5*, or\n• Reply: *loved it*, *need more options*, *negotiate*, or *need time to decide*',
    hi: 'Hi {name}! 🏡\n\n*{property}* par visit ke liye dhanyavaad.\n\nExperience kaisi rahi?\n• *1–5* rate karein, ya\n• Reply: *pasand aaya*, *aur options*, *negotiate*, ya *time chahiye*',
    kn: 'Hi {name}! 🏡\n\n*{property}* ge visit ge dhanyavaad.\n\nExperience hegide?\n• *1–5* rate maadi, athava\n• Reply: *ishtavagide*, *inna options*, *negotiate*, athava *time beku*',
    te: 'Hi {name}! 🏡\n\n*{property}* ki visit ki dhanyavaadalu.\n\nExperience ela undi?\n• *1–5* rate cheyandi, leda\n• Reply: *nachindi*, *inka options*, *negotiate*, leda *time kavali*',
    ta: 'Hi {name}! 🏡\n\n*{property}* visit ku nandri.\n\nExperience eppadi irundhadhu?\n• *1–5* rate pannunga, illa\n• Reply: *pudichadhu*, *vera options*, *negotiate*, illa *time venum*',
    ml: 'Hi {name}! 🏡\n\n*{property}* visit nu nanni.\n\nExperience engane?\n• *1–5* rate cheyyuka, atho\n• Reply: *ishtapettu*, *vere options*, *negotiate*, atho *time venam*',
    mr: 'Hi {name}! 🏡\n\n*{property}* la visit sathi dhanyavaad.\n\nExperience kashi hoti?\n• *1–5* rate kara, kinva\n• Reply: *avadla*, *anakhin options*, *negotiate*, kinva *vel lagel*',
    bn: 'Hi {name}! 🏡\n\n*{property}* visit er jonno dhonyobad.\n\nExperience kemon chhilo?\n• *1–5* rate din, ba\n• Reply: *bhalo laglo*, *aro options*, *negotiate*, ba *somoy lagbe*',
    gu: 'Hi {name}! 🏡\n\n*{property}* visit mate aabhar.\n\nExperience kem hati?\n• *1–5* rate karo, ke\n• Reply: *gamyu*, *vadhhu options*, *negotiate*, ke *samay joiye*',
    pa: 'Hi {name}! 🏡\n\n*{property}* visit layi dhanyavaad.\n\nExperience kivein si?\n• *1–5* rate karo, ja\n• Reply: *pasand aaya*, *hor options*, *negotiate*, ja *time chahida*',
    or: 'Hi {name}! 🏡\n\n*{property}* visit pain dhanyabaad.\n\nExperience kemiti thila?\n• *1–5* rate karantu, ba\n• Reply: *bhala lagila*, *aau options*, *negotiate*, ba *samaya darkar*',
  },
  post_visit_feedback_rating_ack: {
    en: 'Thank you for the *{rating}/5* rating! 😊 We\'re glad you visited *{property}*. When you\'re ready, tap *Talk to Agent* or tell us your next step.',
    hi: '*{rating}/5* rating ke liye dhanyavaad! 😊 *{property}* visit ke liye khushi hui. Taiyar hon to *Talk to Agent* dabayein ya next step batayein.',
    kn: '*{rating}/5* rating ge dhanyavaad! 😊 *{property}* visit ge santoshavagide. Ready iddre *Talk to Agent* banni.',
    te: '*{rating}/5* rating ki thanks! 😊 *{property}* visit ki santosham. Ready aithe *Talk to Agent* tap cheyandi.',
    ta: '*{rating}/5* rating ku nandri! 😊 *{property}* visit ku santhosam. Ready na *Talk to Agent* tap pannunga.',
    ml: '*{rating}/5* rating nu nanni! 😊 *{property}* visit santhosham. Ready aayal *Talk to Agent* tap cheyyuka.',
    mr: '*{rating}/5* rating sathi dhanyavaad! 😊 *{property}* visit cha anand. Ready asal tar *Talk to Agent* tap kara.',
    bn: '*{rating}/5* rating er jonno dhonyobad! 😊 *{property}* visit bhalo laglo. Ready hole *Talk to Agent* tap korun.',
    gu: '*{rating}/5* rating mate aabhar! 😊 *{property}* visit gamyu. Ready hoy to *Talk to Agent* tap karo.',
    pa: '*{rating}/5* rating layi dhanyavaad! 😊 *{property}* visit changi lagi. Ready ho ke *Talk to Agent* tap karo.',
    or: '*{rating}/5* rating pain dhanyabaad! 😊 *{property}* visit bhala lagila. Ready thile *Talk to Agent* tap karantu.',
  },
  post_visit_feedback_loved_ack: {
    en: 'That\'s wonderful to hear! 😊 Glad you liked *{property}*. Tap *Talk to Agent* to discuss next steps, or *View Listings* for more options.',
    hi: 'Bahut accha sunke khushi hui! 😊 *{property}* pasand aaya. Next step ke liye *Talk to Agent* dabayein, ya *View Listings* dekhein.',
    kn: 'Khushi aaytu! 😊 *{property}* ishtavagide. Next step ge *Talk to Agent* banni, athava *View Listings* nodi.',
    te: 'Chala santosham! 😊 *{property}* nachindi. Next step ki *Talk to Agent* tap cheyandi, leda *View Listings* chudandi.',
    ta: 'Romba santhosam! 😊 *{property}* pudichadhu. Next step ku *Talk to Agent* tap pannunga, illa *View Listings* paarunga.',
    ml: 'Sanathosham! 😊 *{property}* ishtapettu. Next step nu *Talk to Agent* tap cheyyuka, atho *View Listings* nokku.',
    mr: 'Chhan aikun! 😊 *{property}* avadla. Next step sathi *Talk to Agent* tap kara, kinva *View Listings* paha.',
    bn: 'Khushi holo shunte! 😊 *{property}* bhalo laglo. Next step e *Talk to Agent* tap korun, ba *View Listings* dekhen.',
    gu: 'Khushi thai! 😊 *{property}* gamyu. Next step mate *Talk to Agent* tap karo, ke *View Listings* joo.',
    pa: 'Khushi hoi! 😊 *{property}* pasand aaya. Next step layi *Talk to Agent* tap karo, ja *View Listings* vekho.',
    or: 'Khushi hela! 😊 *{property}* bhala lagila. Next step pain *Talk to Agent* tap karantu, ba *View Listings* dekhandu.',
  },
  post_visit_feedback_more_options_ack: {
    en: 'Sure — I\'ll help you explore more options similar to *{property}*. Tap *View Listings* or share your budget and preferred area.',
    hi: 'Theek hai — *{property}* jaisi aur options dikhata hoon. *View Listings* dabayein ya budget/area batayein.',
    kn: 'Sari — *{property}* tara inna options help maadthini. *View Listings* banni athava budget/area heli.',
    te: 'Sare — *{property}* lanti inka options help chestanu. *View Listings* tap cheyandi leda budget/area cheppandi.',
    ta: 'Sari — *{property}* maari vera options help pannuren. *View Listings* tap pannunga illa budget/area sollunga.',
    ml: 'Shari — *{property}* pole vere options help cheyyam. *View Listings* tap cheyyuka atho budget/area parayuka.',
    mr: 'Thik aahe — *{property}* sarkhe ankhin options dakhvto. *View Listings* tap kara kinva budget/area sanga.',
    bn: 'Thik ache — *{property}* er moto aro options dekhabo. *View Listings* tap korun ba budget/area bolun.',
    gu: 'Barabar — *{property}* jevi vadhu options batavish. *View Listings* tap karo ke budget/area kaho.',
    pa: 'Theek hai — *{property}* varga hor options dikhanga. *View Listings* tap karo ja budget/area daso.',
    or: 'Thik achhi — *{property}* pari aau options dekhaibi. *View Listings* tap karantu ba budget/area kuhantu.',
  },
  post_visit_feedback_negotiate_ack: {
    en: 'Got it — pricing and negotiation for *{property}* needs our specialist. Tap *Talk to Agent* and we\'ll connect you shortly.',
    hi: 'Samajh gaya — *{property}* ke liye pricing/negotiation specialist se hogi. *Talk to Agent* dabayein, jald connect karenge.',
    kn: 'Got it — *{property}* pricing/negotiation specialist inda. *Talk to Agent* banni, bega connect maadthivi.',
    te: 'Got it — *{property}* pricing/negotiation specialist tho. *Talk to Agent* tap cheyandi, twaraga connect chestam.',
    ta: 'Got it — *{property}* pricing/negotiation specialist vazhi. *Talk to Agent* tap pannunga, seekiram connect pannuvom.',
    ml: 'Got it — *{property}* pricing/negotiation specialist vazhi. *Talk to Agent* tap cheyyuka, vegam connect cheyyam.',
    mr: 'Got it — *{property}* pricing/negotiation specialist kadun. *Talk to Agent* tap kara, lagech connect karu.',
    bn: 'Got it — *{property}* er pricing/negotiation specialist er kache. *Talk to Agent* tap korun, taratari connect korbo.',
    gu: 'Got it — *{property}* mate pricing/negotiation specialist thi. *Talk to Agent* tap karo, jaldi connect karishu.',
    pa: 'Got it — *{property}* layi pricing/negotiation specialist ton. *Talk to Agent* tap karo, jaldi connect karange.',
    or: 'Got it — *{property}* pain pricing/negotiation specialist tharu. *Talk to Agent* tap karantu, jaldi connect kariba.',
  },
  post_visit_feedback_defer_ack: {
    en: 'Of course — take your time! 🙂 There\'s no rush on *{property}*. When you\'re ready, tap *Talk to Agent* or reply here anytime.',
    hi: 'Bilkul — apna time lein! 🙂 *{property}* par koi jaldi nahi. Taiyar hon to *Talk to Agent* dabayein ya yahan reply karein.',
    kn: 'Sure — nimma time tagolli! 🙂 *{property}* ge hurry illa. Ready iddre *Talk to Agent* banni athava illi reply maadi.',
    te: 'Sure — mee time teeskondi! 🙂 *{property}* ki hurry ledu. Ready aithe *Talk to Agent* tap cheyandi leda ikkada reply cheyandi.',
    ta: 'Sure — unga time eduthukonga! 🙂 *{property}* ku hurry illa. Ready na *Talk to Agent* tap pannunga illa inga reply pannunga.',
    ml: 'Sure — ningalude time edutholku! 🙂 *{property}* nu hurry illa. Ready aayal *Talk to Agent* tap cheyyuka atho ivide reply cheyyuka.',
    mr: 'Sure — tumcha vel gya! 🙂 *{property}* sathi hurry nahi. Ready asal tar *Talk to Agent* tap kara kinva ithe reply kara.',
    bn: 'Sure — somoy nin! 🙂 *{property}* er jonno hurry nei. Ready hole *Talk to Agent* tap korun ba ekhane reply korun.',
    gu: 'Sure — tamaro samay lo! 🙂 *{property}* mate hurry nathi. Ready hoy to *Talk to Agent* tap karo ke ahiya reply karo.',
    pa: 'Sure — apna time lo! 🙂 *{property}* layi hurry nahi. Ready ho ke *Talk to Agent* tap karo ja ithe reply karo.',
    or: 'Sure — samaya niantu! 🙂 *{property}* pain hurry nahi. Ready thile *Talk to Agent* tap karantu ba ethare reply karantu.',
  },
  post_visit_feedback_negative_ack: {
    en: 'Thank you for the honest feedback on *{property}*. I\'m sorry it wasn\'t the right fit. Tap *View Listings* for alternatives or *Talk to Agent* for personal help.',
    hi: '*{property}* par honest feedback ke liye dhanyavaad. Sahi fit na hone par maaf kijiye. Alternatives ke liye *View Listings* ya *Talk to Agent* dabayein.',
    kn: '*{property}* honest feedback ge dhanyavaad. Sari fit alla andre kshamisi. Alternatives ge *View Listings* athava *Talk to Agent* banni.',
    te: '*{property}* honest feedback ki thanks. Right fit kakapothe kshaminchandi. Alternatives ki *View Listings* leda *Talk to Agent* tap cheyandi.',
    ta: '*{property}* honest feedback ku nandri. Right fit illana mannikavum. Alternatives ku *View Listings* illa *Talk to Agent* tap pannunga.',
    ml: '*{property}* honest feedback nu nanni. Right fit alla enkil kshamikkuka. Alternatives nu *View Listings* atho *Talk to Agent* tap cheyyuka.',
    mr: '*{property}* honest feedback sathi dhanyavaad. Yogy fit na asel tar maaf kara. Alternatives sathi *View Listings* kinva *Talk to Agent* tap kara.',
    bn: '*{property}* er honest feedback er jonno dhonyobad. Right fit na hole khoma korun. Alternatives er jonno *View Listings* ba *Talk to Agent* tap korun.',
    gu: '*{property}* mate honest feedback mate aabhar. Right fit na hoy to maaf karo. Alternatives mate *View Listings* ke *Talk to Agent* tap karo.',
    pa: '*{property}* layi honest feedback layi dhanyavaad. Right fit na hove ta maaf karo. Alternatives layi *View Listings* ja *Talk to Agent* tap karo.',
    or: '*{property}* pain honest feedback pain dhanyabaad. Right fit na helle khama karantu. Alternatives pain *View Listings* ba *Talk to Agent* tap karantu.',
  },
  returning_pivot: {
    en: 'Great — let\'s start fresh! 🏡\n\nShare your *budget*, preferred *area*, and *BHK* (or property type) and I\'ll shortlist the best matches from *{company}*.',
    hi: 'Badhiya — naye se shuru karte hain! 🏡\n\nApna *budget*, *area*, aur *BHK* (ya property type) share karein, main *{company}* se best matches bhejunga.',
    kn: 'Chennagide — hosa start maadona! 🏡\n\nNimma *budget*, *area*, mattu *BHK* (athava property type) share maadi, *{company}* inda best matches kalisutte.',
    te: 'Bagundi — fresh ga start cheddam! 🏡\n\nMee *budget*, *area*, mariyu *BHK* (leda property type) share cheyandi, *{company}* nundi best matches pampistha.',
    ta: 'Nalla irukku — pudhusaa start pannalaam! 🏡\n\nUngal *budget*, *area*, *BHK* (illa property type) share pannunga, *{company}* la irundhu best matches anupuren.',
    ml: 'Nallathu — puthiya start cheyyam! 🏡\n\nNinte *budget*, *area*, *BHK* (atho property type) share cheyyuka, *{company}* il ninnu best matches ayachu tharunnu.',
    mr: 'Chhan — navin suruvat karuya! 🏡\n\nTumcha *budget*, *area*, ani *BHK* (kiva property type) share kara, *{company}* madhun best matches pathvin.',
    bn: 'Bhalo — notun kore shuru kori! 🏡\n\nApnar *budget*, *area*, ebong *BHK* (ba property type) share korun, *{company}* theke best matches pathabo.',
    gu: 'Saras — navi shuruaat kariye! 🏡\n\nTamaro *budget*, *area*, ane *BHK* (ke property type) share karo, *{company}* mathi best matches moklish.',
    pa: 'Vadiya — navi shuruat kariye! 🏡\n\nApna *budget*, *area*, te *BHK* (ya property type) share karo, *{company}* ton best matches bhejunga.',
    or: 'Bhala — nua start kariba! 🏡\n\nApananka *budget*, *area*, ebong *BHK* (ba property type) share karantu, *{company}* ru best matches pathaibi.',
  },
  returning_welcome_back: {
    en: 'Welcome back!',
    hi: 'Phir se swagat hai!',
    kn: 'Punaha swagata!',
    te: 'Malli svagatam!',
    ta: 'Matrum varaverppu!',
    ml: 'Punar swagatam!',
    mr: 'Punha swagat!',
    bn: 'Abar swagatam!',
    gu: 'Punah swagat!',
    pa: 'Phir swagat!',
    or: 'Puni swagat!',
  },
  returning_area_hint: {
    en: 'Still looking at *{area}*, or something new?',
    hi: 'Ab bhi *{area}* dekh rahe hain, ya kuch naya?',
    kn: 'Innu *{area}* noduttiddira, athava hosa?',
    te: 'Inka *{area}* chustunnara, leda kotha?',
    ta: 'Innum *{area}* paarkureergala, illa pudhu?',
    ml: 'Innum *{area}* nokunnundo, atho puthiya?',
    mr: 'Ajunhi *{area}* baghat aahet, ki navin?',
    bn: 'Ekhono *{area}* dekhchen, na notun kichu?',
    gu: 'Haju *{area}* joi rahya cho, ke navu?',
    pa: 'Haje vi *{area}* dekh rahe ho, ya kuj nave?',
    or: 'Ebe bi *{area}* dekhuchanti, na nua kichhi?',
  },
  returning_explore_hint: {
    en: 'Still exploring options, or something new?',
    hi: 'Ab bhi options explore kar rahe hain, ya kuch naya?',
    kn: 'Innu options explore maaduttiddira, athava hosa?',
    te: 'Inka options explore chestunnara, leda kotha?',
    ta: 'Innum options explore pannureergala, illa pudhu?',
    ml: 'Innum options explore cheyyunnundo, atho puthiya?',
    mr: 'Ajunhi options explore kart aahet, ki navin?',
    bn: 'Ekhono options explore korchen, na notun kichu?',
    gu: 'Haju options explore karo cho, ke navu?',
    pa: 'Haje vi options explore kar rahe ho, ya kuj nave?',
    or: 'Ebe bi options explore karuchanti, na nua kichhi?',
  },
  prop_label_price: langPack('Price', 'कीमत'),
  prop_label_type: langPack('Type', 'प्रकार'),
  prop_label_bedrooms: langPack('Bedrooms', 'बेडरूम'),
  prop_label_location: langPack('Location', 'स्थान'),
  prop_label_builder: langPack('Builder', 'बिल्डर'),
  prop_label_rera: langPack('RERA', 'RERA'),
  prop_label_brochure: langPack('Brochure', 'ब्रोशर'),
  prop_label_floor_plans: langPack('Floor plans', 'फ़्लोर प्लान'),
  prop_label_price_list: langPack('Price list', 'प्राइस लिस्ट'),
  prop_label_amenities: langPack('Amenities', 'सुविधाएँ'),
  prop_label_details: langPack('Details', 'विवरण'),
  prop_on_file: langPack('available', 'उपलब्ध'),
  project_browse_none: langPack(
    'No project listings are published right now. Tell me your budget or area and I will help.',
    'अभी कोई परियोजना लिस्टिंग प्रकाशित नहीं है। अपना बजट या इलाका बताएँ।',
  ),
  project_browse_header: langPack(
    'Here are *{count}* project(s) you can explore:',
    'आप *{count}* परियोजना देख सकते हैं:',
  ),
  project_browse_line: langPack(
    '*{index}. {name}* — {count} listings · {types} · {location}{price}',
    '*{index}. {name}* — {count} लिस्टिंग · {types} · {location}{price}',
  ),
  project_browse_footer: langPack(
    'Tap a *project* below to get the brochure and choose a specific property inside it.',
    'नीचे *परियोजना* चुनें — ब्रोशर मिलेगा, फिर उस परियोजना की संपत्ति चुनें।',
  ),
  project_selected_intro: langPack(
    'Great choice — *{name}* has *{count}* available listing(s). Here is the project brochure. Tap a property below for full details, photos, and visit booking.',
    'बढ़िया — *{name}* में *{count}* लिस्टिंग उपलब्ध हैं। परियोजना ब्रोशर नीचे है। विवरण और विज़िट के लिए संपत्ति चुनें।',
  ),
  project_listings_hidden_note: langPack(
    '({hidden} unit(s) in this project are not available for booking right now.)',
    '({hidden} यूनिट अभी बुकिंग के लिए उपलब्ध नहीं हैं।)',
  ),
  choose_project: langPack('Choose project', 'परियोजना चुनें'),
  choose_property: langPack('Choose property', 'संपत्ति चुनें'),
  our_projects: langPack('Our projects', 'हमारी परियोजनाएँ'),
  project_listing_count_label: langPack('{count} listings', '{count} लिस्टिंग'),
  showing_listings_truncated: langPack(
    'Showing 10 of {total} listings — reply with a unit name for others.',
    '10 में से {total} लिस्टिंग दिख रही हैं — बाकी के लिए यूनिट का नाम लिखें।',
  ),
  visit_detail_confirmed_prefix: langPack(
    'Your visit for *{property}* on {date} is confirmed ✅',
    '*{property}* के लिए {date} की विज़िट *पुष्ट* है ✅',
  ),
  visit_detail_scheduled_prefix: langPack(
    'You already have a visit for *{property}* on {date} 🗓️',
    '*{property}* के लिए {date} की विज़िट पहले से है 🗓️',
  ),
  visit_browsing_other_confirmed_note: langPack(
    'You\'re viewing *{viewing}*. Your confirmed visit is for *{booked}* on {date}.',
    'आप *{viewing}* देख रहे हैं। आपकी पुष्ट विज़िट *{booked}* के लिए {date} को है।',
  ),
  visit_browsing_other_scheduled_note: langPack(
    'You\'re viewing *{viewing}*. Your scheduled visit is for *{booked}* on {date}.',
    'आप *{viewing}* देख रहे हैं। आपकी निर्धारित विज़िट *{booked}* के लिए {date} को है।',
  ),
  visit_browsing_other_date_only_note: langPack(
    'You\'re viewing *{viewing}*. You have a visit on {date} — reply *Talk to agent* if you need the property name.',
    'आप *{viewing}* देख रहे हैं। {date} को विज़िट है — संपत्ति का नाम चाहिए तो *Talk to agent* लिखें।',
  ),
  visit_pending_approval_prefix: langPack(
    'Your visit request for *{property}* on {date} is awaiting team approval ⏳',
    '*{property}* के लिए {date} की विज़िट अनुमोदन की प्रतीक्षा में है ⏳',
  ),
  visit_booked_property_reminder: langPack(
    'This is *{property}* — your booked visit is on *{date}* ✅\n\nExplore other listings in this project or browse more projects below.',
    'यह *{property}* है — आपकी बुक की गई विज़िट *{date}* को है ✅\n\nइसी परियोजना की अन्य लिस्टिंग या और परियोजनाएँ नीचे देखें।',
  ),
  property_not_selected_yet: langPack(
    "I don't have a specific property selected yet. Tell me which property you'd like — name or location works.",
    'अभी कोई विशेष संपत्ति चयनित नहीं है। बताएँ किस संपत्ति की जानकारी चाहिए — नाम या इलाका लिखें।',
  ),
  property_no_longer_available: langPack(
    'Sorry, that property is no longer available. Would you like to see our other listings?',
    'क्षमा करें, वह संपत्ति अब उपलब्ध नहीं है। क्या आप अन्य लिस्टिंग देखना चाहेंगे?',
  ),
  browse_list_title: langPack('View properties', 'संपत्तियाँ देखें'),
  browse_list_section: langPack('Matching listings', 'मिलती-जुलती लिस्टिंग'),
  catalog_empty_default: langPack(
    "I couldn't find an exact match in our catalog.\n\nTell me your budget, area, or property type (e.g. \"3 BHK in Whitefield\") and I'll shortlist options.",
    'Hamare catalog mein exact match nahi mila.\n\nApna budget, area, ya property type batayein (jaise "3 BHK Whitefield") — main options bhejunga.',
  ),
  catalog_empty_bhk: langPack(
    "I couldn't find a *{bhk} BHK* in our current catalog.\n\nTell me your preferred area or budget, or tap a filter below — I'll show the closest matches.",
    'Hamare catalog mein *{bhk} BHK* nahi mila.\n\nApna area ya budget batayein, ya neeche filter dabayein — main closest matches dikhata hoon.',
  ),
  catalog_empty_type: langPack(
    "I couldn't find *{type}* listings that match right now.\n\nShare your budget or area, or ask to see all available projects.",
    'Abhi *{type}* listings match nahi ho rahi.\n\nBudget ya area share karein, ya saare available projects dekhne ko kahein.',
  ),
  inventory_count_header_projects: langPack(
    'We have *{count}* active project(s) in our catalog',
    'Hamare catalog mein *{count}* active project hain',
  ),
  inventory_count_header_properties: langPack(
    'We have *{count}* active listing(s) in our catalog',
    'Hamare catalog mein *{count}* active listing hain',
  ),
  inventory_count_none: langPack(
    "We don't have any published projects available for visits right now. Our team can notify you when new inventory is added.",
    'Abhi visit ke liye koi published project nahi hai. Naya inventory aate hi team aapko bata degi.',
  ),
  inventory_count_type_part: langPack('{count} {type}', '{count} {type}'),
  inventory_count_upcoming: langPack(
    '*{count}* upcoming launch(es) (pre-booking open).',
    '*{count}* upcoming launch (pre-booking open).',
  ),
  inventory_count_cta: langPack(
    'Would you like to see apartments, villas, or a specific BHK? Tap below or tell me your preference.',
    'Apartments, villas, ya koi specific BHK dekhna chahenge? Neeche tap karein ya preference batayein.',
  ),
  catalog_match_single_intro: langPack('Yes — we have *{name}*', 'Haan — hamare paas *{name}* hai'),
  catalog_match_single_type: langPack('Type: {type}', 'Type: {type}'),
  catalog_match_single_price: langPack('Price: {price}', 'Keemat: {price}'),
  catalog_match_single_location: langPack('Location: {location}', 'Location: {location}'),
  catalog_match_single_bedrooms: langPack('Bedrooms: {bedrooms} BHK', 'Bedrooms: {bedrooms} BHK'),
  catalog_match_single_brochure: langPack('Brochure: available 📎', 'Brochure: uplabdh 📎'),
  catalog_match_single_footer: langPack(
    "\nI'll share photos and details below. Tap *Property Details* or *Book Visit* when you're ready.",
    '\nNeeche photos aur details bhej raha hoon. *Property Details* ya *Book Visit* dabayein jab ready hon.',
  ),
  catalog_match_multi_header: langPack('Here are *{count}* matching options:', 'Yeh *{count}* matching options hain:'),
  catalog_match_multi_footer: langPack(
    'Tap a listing from the list below for photos, brochure, and visit slots.',
    'Photos, brochure aur visit slots ke liye neeche list se listing chunein.',
  ),
  catalog_match_location_on_request: langPack('Location on request', 'Location on request'),
  no_matching_properties: langPack(
    'No matching properties in our catalog right now.',
    'Abhi hamare catalog mein matching properties nahi hain.',
  ),
  btn_filter_apartment: langPack('Apartments', 'अपार्टमेंट'),
  btn_filter_villa: langPack('Villas', 'विला'),
  btn_filter_plot: langPack('Plots', 'प्लॉट'),
  btn_filter_commercial: langPack('Commercial', 'कमर्शियल'),
  btn_filter_other: langPack('Projects', 'परियोजनाएँ'),
  btn_filter_1bhk: langPack('1 BHK', '1 BHK'),
  btn_filter_2bhk: langPack('2 BHK', '2 BHK'),
  btn_filter_3bhk: langPack('3 BHK', '3 BHK'),
  btn_filter_4bhk: langPack('4 BHK', '4 BHK'),
  btn_filter_5bhk: langPack('5 BHK', '5 BHK'),
  property_sold_explanation: langPack(
    'Sorry, *{name}* is no longer available — it has been sold. I can show you other units in the same project.',
    'क्षमा करें, *{name}* अब उपलब्ध नहीं है — यह बिक चुकी है। मैं इसी परियोजना की अन्य यूनिट दिखा सकता हूँ।',
  ),
  filter_not_in_catalog: langPack(
    "We don't have *{filter}* in our catalog right now. {hint} Tell me your budget or area and I'll find the closest match.",
    'Hamare catalog mein abhi *{filter}* nahi hai. {hint} Apna budget ya area batayein — main closest match dhundhunga.',
  ),
  filter_already_viewing: langPack(
    "You're already viewing *{filter}* options — tap a property from the list above or tell me another preference.",
    'Aap pehle se hi *{filter}* options dekh rahe hain — upar list se property chunein ya aur preference batayein.',
  ),
  filter_applied_projects: langPack(
    'Great choice! Here are *{filter}* projects for you:\n\n{reply}',
    'Bahut accha! Yeh *{filter}* projects hain:\n\n{reply}',
  ),
  filter_applied_list: langPack(
    'Great choice! Found {count} {filter} {unitLabel} for you! 🏠✨',
    'Bahut accha! {count} {filter} {unitLabel} mili! 🏠✨',
  ),
  filter_error: langPack(
    "I'm having trouble filtering properties right now. What specific {filter} properties would you like to know about?",
    'Abhi filter lagane mein dikkat ho rahi hai. Kaun si {filter} properties ke baare mein jaanna chahte hain?',
  ),
  filter_inventory_hint: langPack(
    'We currently have {typeSummary}.',
    'Abhi hamare paas {typeSummary} hain.',
  ),
  filter_inventory_empty: langPack(
    "We're still setting up our listings.",
    'Hamari listings abhi setup ho rahi hain.',
  ),
  filter_closest_option: langPack(
    'Closest option: *{name}* ({location}).',
    'Sabse nazdeek: *{name}* ({location}).',
  ),
  filter_waitlist_cta: langPack(
    'Reply *WAITLIST* to get alerted when a match is listed, or tell me another area/BHK.',
    '*WAITLIST* likhein jab match aaye to alert mile, ya aur area/BHK batayein.',
  ),
  interactive_visit_confirm_no_visit: langPack(
    "I couldn't find an upcoming visit to confirm. Would you like to book a new site visit?",
    'Confirm karne ke liye koi upcoming visit nahi mili. Kya nayi site visit book karein?',
  ),
  interactive_visit_confirm_failed: langPack(
    "I couldn't confirm that visit right now. Please try again or ask our team to help.",
    'Abhi visit confirm nahi ho payi. Dobara try karein ya team se madad lein.',
  ),
  interactive_visit_confirmed: langPack(
    '✅ *Visit Confirmed!*\n\n🏠 *{property}*\n📅 {date}\n\nWe look forward to seeing you! 😊\n\nNeed anything else? Feel free to ask.',
    '✅ *Visit Confirm!*\n\n🏠 *{property}*\n📅 {date}\n\nAapka intezar rahega! 😊\n\nAur kuch chahiye? Poochh sakte hain.',
  ),
  interactive_visit_reschedule_prompt: langPack(
    "📅 Let's find a new time for your visit to *{property}*. When works best for you?",
    '📅 *{property}* ki visit ke liye naya time chunein. Aapke liye kab theek rahega?',
  ),
  interactive_visit_reschedule_no_visit: langPack(
    "I couldn't find an upcoming visit to reschedule. Would you like to book a new site visit?",
    'Reschedule karne ke liye koi upcoming visit nahi mili. Kya nayi site visit book karein?',
  ),
  interactive_book_visit_no_property: langPack(
    "I'd love to schedule a visit! Could you tell me which property you're interested in?",
    'Visit schedule karna chahta hoon! Kaun si property mein dilchaspi hai?',
  ),
  interactive_book_visit_invalid_property: langPack(
    "I couldn't find that property. Let me show you our available options.",
    'Woh property nahi mili. Main available options dikhata hoon.',
  ),
  interactive_book_visit_initiated: langPack(
    "Great choice! 🏠 Let's schedule your visit to *{property}*.\n\nWhen would you prefer to visit?",
    'Bahut accha! 🏠 *{property}* ki visit schedule karte hain.\n\nKab aana pasand karenge?',
  ),
  interactive_share_feedback: langPack(
    'We would love to hear about your visit! Please share your feedback here — our team reads every message.',
    'Aapki visit ke baare mein sunna chahenge! Yahan feedback share karein — team har message padhti hai.',
  ),
  interactive_call_time_prompt: langPack(
    "📞 I'll ask our team to call you — please share a good time if you have one (e.g. *tomorrow 3pm*).",
    '📞 Team aapko call karegi — accha time batayein (jaise *kal 3pm*).',
  ),
  interactive_call_cancel_not_found: langPack(
    "I couldn't find a scheduled callback to cancel.",
    'Cancel karne ke liye koi scheduled callback nahi mili.',
  ),
  interactive_call_cancel_confirmed: langPack(
    "Your callback is already confirmed, so I can't cancel it automatically. I have notified the team to help you.",
    'Callback pehle se confirm hai, auto cancel nahi ho sakta. Team ko notify kar diya hai.',
  ),
  interactive_call_cancelled: langPack(
    "*Callback cancelled*\n\nReply anytime if you'd like to schedule a new call with our team.",
    '*Callback cancel ho gaya*\n\nNayi call schedule karni ho to kabhi bhi reply karein.',
  ),
  interactive_call_reschedule_prompt: langPack(
    'Sure — share your preferred call time (e.g. *tomorrow 6pm*, *Friday 4pm*, or *next Saturday 11am*).',
    'Theek hai — call ka time batayein (jaise *kal 6pm*, *Friday 4pm*).',
  ),
  interactive_visit_time_parse_failed: langPack(
    'Sorry, I could not read that time slot. Please tap a visit time button again or tell me your preferred date.',
    'Maaf kijiye, time slot samajh nahi aaya. Dobara button dabayein ya date batayein.',
  ),
  interactive_visit_property_unavailable: langPack(
    'That project is not available for visit booking right now. I can show you our available and upcoming projects instead.',
    'Woh project abhi visit booking ke liye available nahi hai. Main available aur upcoming projects dikha sakta hoon.',
  ),
  interactive_visit_no_agent: langPack(
    "Thanks for selecting a time! We're getting your visit set up and our team will confirm the details with you shortly. 🗓️",
    'Time chunne ke liye dhanyavad! Visit setup ho rahi hai — team jald confirm karegi. 🗓️',
  ),
  interactive_visit_confirmed_change: langPack(
    "Your visit is already confirmed, so I won't change it automatically.\n\nI've notified the team with your preferred new time.",
    'Visit pehle se confirm hai, auto change nahi hoga.\n\nTeam ko naya time bata diya hai.',
  ),
  interactive_generic_slot_no_property: langPack(
    "Which property would you like to visit? Share the project name and I'll get you some time slots.",
    'Kaun si property visit karni hai? Project ka naam batayein — time slots bhejunga.',
  ),
  out_of_scope_property_clarify: langPack(
    'I want to stay accurate — which property did you mean?',
    'Sahi jaankari ke liye — aap kis property ki baat kar rahe hain?',
  ),
  scoped_browse_offer: langPack(
    'I can share details on the options we discussed. Tap Browse Projects to see all.',
    'Main discuss ki gayi options share kar sakta hoon. Sab dekhne ke liye Browse Projects tap karein.',
  ),
  second_visit_cross_project_confirm: langPack(
    'You already have a visit for *{existingProperty}*. Book a second visit for *{targetProperty}*?',
    'Aapki *{existingProperty}* ki visit pehle se hai. *{targetProperty}* ki second visit book karein?',
  ),
  second_visit_allowed_note: langPack(
    'Note: You also have a visit for *{otherProperty}* on *{date}*.',
    'Note: *{otherProperty}* ki visit *{date}* par bhi booked hai.',
  ),
  visit_same_property_already: langPack(
    'You already have a visit booked for this property. Use Change Time if you want a different slot.',
    'Is property ki visit pehle se booked hai. Slot badalne ke liye Change Time use karein.',
  ),
  greeting_hindi_followup: langPack(
    '\n\n*Namaste{name}!* 🙏\n\n*{company}* mein aapka swagat hai — aap bilkul sahi jagah aaye hain. 🏡\n\nAap kis area mein ghar dekhna chahte hain, aur budget roughly kitna hai?',
    '\n\n*Namaste{name}!* 🙏\n\n*{company}* mein aapka swagat hai — aap bilkul sahi jagah aaye hain. 🏡\n\nAap kis area mein ghar dekhna chahte hain, aur budget roughly kitna hai?',
  ),
};

function interpolate(template: string, vars: CopyVars): string {
  let out = template;
  for (const [key, raw] of Object.entries(vars)) {
    const val = raw == null ? '' : String(raw);
    out = out.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
  }
  out = out.replace(/\{name\}/g, vars.name != null ? ` ${vars.name}` : '');
  return out;
}

export function tBuyer(lang: string | null | undefined, key: BuyerCopyKey, vars: CopyVars = {}): string {
  const normalized = normalizeBuyerLang(lang);
  const table = COPY[key];
  const template = table[normalized] ?? table.en;
  return interpolate(template, vars);
}

export type PropertyDetailLabels = {
  price: string;
  type: string;
  bedrooms: string;
  location: string;
  builder: string;
  rera: string;
  brochure: string;
  floorPlans: string;
  priceList: string;
  amenities: string;
  details: string;
  onFile: string;
};

export function propertyDetailLabels(lang: string | null | undefined): PropertyDetailLabels {
  return {
    price: tBuyer(lang, 'prop_label_price'),
    type: tBuyer(lang, 'prop_label_type'),
    bedrooms: tBuyer(lang, 'prop_label_bedrooms'),
    location: tBuyer(lang, 'prop_label_location'),
    builder: tBuyer(lang, 'prop_label_builder'),
    rera: tBuyer(lang, 'prop_label_rera'),
    brochure: tBuyer(lang, 'prop_label_brochure'),
    floorPlans: tBuyer(lang, 'prop_label_floor_plans'),
    priceList: tBuyer(lang, 'prop_label_price_list'),
    amenities: tBuyer(lang, 'prop_label_amenities'),
    details: tBuyer(lang, 'prop_label_details'),
    onFile: tBuyer(lang, 'prop_on_file'),
  };
}

export type BuyerButtonKey =
  | 'change_time'
  | 'property_details'
  | 'call_agent'
  | 'confirm_visit'
  | 'reschedule'
  | 'cancel_call'
  | 'book_visit'
  | 'call_me'
  | 'share_feedback'
  | 'talk_agent'
  | 'see_options'
  | 'browse_projects'
  | 'view_project_listings'
  | 'narrow_search'
  | 'emi'
  | 'more_details';

const BUTTON_KEY_MAP: Record<BuyerButtonKey, BuyerCopyKey> = {
  change_time: 'btn_change_time',
  property_details: 'btn_property_details',
  call_agent: 'btn_call_agent',
  confirm_visit: 'btn_confirm_visit',
  reschedule: 'btn_reschedule',
  cancel_call: 'btn_cancel_call',
  book_visit: 'btn_book_visit',
  call_me: 'btn_call_me',
  share_feedback: 'btn_share_feedback',
  talk_agent: 'btn_talk_agent',
  see_options: 'btn_see_options',
  view_project_listings: 'btn_view_project_listings',
  browse_projects: 'btn_browse_projects',
  narrow_search: 'btn_narrow_search',
  emi: 'btn_emi',
  more_details: 'btn_more_details',
};

export function buyerButtonTitle(lang: string | null | undefined, key: BuyerButtonKey): string {
  const title = tBuyer(lang, BUTTON_KEY_MAP[key]);
  return title.length > 20 ? title.slice(0, 20) : title;
}

const FILTER_TYPE_EMOJI: Record<string, string> = {
  apartment: '🏢',
  villa: '🏡',
  plot: '📐',
  commercial: '🏬',
  other: '🏗️',
};

const FILTER_COPY_KEY: Record<string, BuyerCopyKey> = {
  apartment: 'btn_filter_apartment',
  villa: 'btn_filter_villa',
  plot: 'btn_filter_plot',
  commercial: 'btn_filter_commercial',
  other: 'btn_filter_other',
  '1bhk': 'btn_filter_1bhk',
  '2bhk': 'btn_filter_2bhk',
  '3bhk': 'btn_filter_3bhk',
  '4bhk': 'btn_filter_4bhk',
  '5bhk': 'btn_filter_5bhk',
};

/** Localized inventory filter button title (property type or BHK). */
export function buyerFilterButtonTitle(
  lang: string | null | undefined,
  filterKey: string,
  withEmoji = false,
): string {
  const normalized = filterKey.toLowerCase();
  const copyKey = FILTER_COPY_KEY[normalized];
  const label = copyKey ? tBuyer(lang, copyKey) : filterKey;
  if (withEmoji && FILTER_TYPE_EMOJI[normalized]) {
    return `${FILTER_TYPE_EMOJI[normalized]} ${label}`;
  }
  const title = label.length > 20 ? label.slice(0, 20) : label;
  return title;
}

/** Hindi follow-up block appended after custom English greeting templates. */
export function hindiGreetingFollowupBlock(
  company: string,
  customerName?: string | null,
): string {
  const name = customerName?.trim() ? `, *${customerName.trim()}*` : '';
  return tBuyer('hi', 'greeting_hindi_followup', { company, name });
}

const VISIT_STATUS_LABELS: Record<string, Record<BuyerLang, string>> = {
  scheduled: {
    en: 'Scheduled', hi: 'Scheduled', kn: 'Scheduled', te: 'Scheduled', ta: 'Scheduled',
    ml: 'Scheduled', mr: 'Scheduled', bn: 'Scheduled', gu: 'Scheduled', pa: 'Scheduled', or: 'Scheduled',
  },
  confirmed: {
    en: 'Confirmed', hi: 'Confirmed', kn: 'Confirmed', te: 'Confirmed', ta: 'Confirmed',
    ml: 'Confirmed', mr: 'Confirmed', bn: 'Confirmed', gu: 'Confirmed', pa: 'Confirmed', or: 'Confirmed',
  },
  completed: {
    en: 'Completed', hi: 'Completed', kn: 'Completed', te: 'Completed', ta: 'Completed',
    ml: 'Completed', mr: 'Completed', bn: 'Completed', gu: 'Completed', pa: 'Completed', or: 'Completed',
  },
  cancelled: {
    en: 'Cancelled', hi: 'Cancelled', kn: 'Cancelled', te: 'Cancelled', ta: 'Cancelled',
    ml: 'Cancelled', mr: 'Cancelled', bn: 'Cancelled', gu: 'Cancelled', pa: 'Cancelled', or: 'Cancelled',
  },
  no_show: {
    en: 'No-show', hi: 'No-show', kn: 'No-show', te: 'No-show', ta: 'No-show',
    ml: 'No-show', mr: 'No-show', bn: 'No-show', gu: 'No-show', pa: 'No-show', or: 'No-show',
  },
  rescheduled: {
    en: 'Rescheduled', hi: 'Rescheduled', kn: 'Rescheduled', te: 'Rescheduled', ta: 'Rescheduled',
    ml: 'Rescheduled', mr: 'Rescheduled', bn: 'Rescheduled', gu: 'Rescheduled', pa: 'Rescheduled', or: 'Rescheduled',
  },
};

export function visitStatusLabel(lang: string | null | undefined, status: string): string {
  const normalized = normalizeBuyerLang(lang);
  return VISIT_STATUS_LABELS[status]?.[normalized]
    ?? VISIT_STATUS_LABELS[status]?.en
    ?? status;
}

export function nurtureMessageForReason(
  lang: string | null | undefined,
  reason: string,
  vars: { name: string; area: string },
): string {
  const keyMap: Record<string, BuyerCopyKey> = {
    '48h_no_activity': 'nurture_48h',
    '3d_reengage': 'nurture_3d',
    '7d_urgency': 'nurture_7d',
    '30d_reengage': 'nurture_30d',
    visit_post_feedback: 'post_visit_feedback_prompt',
  };
  const key = keyMap[reason] ?? 'nurture_48h';
  return tBuyer(lang, key, vars);
}

type OutboundHistoryEntry = { senderType?: string; content?: string; createdAt?: Date | string };

function messageTimestamp(entry: OutboundHistoryEntry): number | null {
  if (!entry.createdAt) return null;
  const ts = new Date(entry.createdAt).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function recentAiOutboundMessages(
  history: OutboundHistoryEntry[],
  windowMs: number,
): OutboundHistoryEntry[] {
  const ai = history.filter((m) => m.senderType === 'ai' || m.senderType === 'agent');
  const cutoff = Date.now() - windowMs;
  const withinWindow = ai.filter((m) => {
    const ts = messageTimestamp(m);
    return ts !== null && ts >= cutoff;
  });
  return (withinWindow.length > 0 ? withinWindow : ai).slice(-5);
}

/** Matches booking confirmations, visit-aware welcomes, and compact visit acks. */
export function contentMatchesRecentVisitOutbound(content: string, propertyName: string): boolean {
  const c = String(content ?? '');
  const prop = propertyName.trim();
  const mentionsProperty = !prop || c.toLowerCase().includes(prop.toLowerCase());
  if (!mentionsProperty) return false;
  return (
    /visit scheduled|visit rescheduled|visit confirmed|site visit|preferred visit time|awaiting team approval|still confirmed|welcome back/i.test(c)
    || (/confirmed/i.test(c) && /visit|property/i.test(c))
  );
}

/** True when a visit-status or visit-welcome outbound was sent recently for this property. */
export function wasRecentVisitWelcomeSent(
  history: OutboundHistoryEntry[],
  propertyName: string,
  windowMs = 4 * 60 * 60 * 1000,
): boolean {
  const prop = propertyName.trim();
  if (!prop) return false;
  return recentAiOutboundMessages(history, windowMs).some((m) =>
    contentMatchesRecentVisitOutbound(String(m.content ?? ''), prop),
  );
}

/** True when a callback welcome or confirmation was sent recently. */
export function wasRecentCallWelcomeSent(
  history: OutboundHistoryEntry[],
  windowMs = 4 * 60 * 60 * 1000,
): boolean {
  return recentAiOutboundMessages(history, windowMs).some((m) => {
    const c = String(m.content ?? '');
    return (
      /callback|call back|call me|call agent/i.test(c)
      && (/confirmed|scheduled|awaiting|welcome back|still confirmed/i.test(c))
    );
  });
}

/** True when a returning/post-visit welcome was sent recently (bare "Hi" dedupe). */
export function wasRecentBareGreetingWelcomeSent(
  history: OutboundHistoryEntry[],
  windowMs = 4 * 60 * 60 * 1000,
): boolean {
  return recentAiOutboundMessages(history, windowMs).some((m) => {
    const c = String(m.content ?? '');
    return (
      /welcome back|phir se swagat|punaha swagata|malli svagatam|matrum varaverppu|punar swagatam|punha swagat|abar swagatam|punah swagat|phir swagat|puni swagat/i.test(c)
      || /how did.*visit go|recent site visit|still interested in|still exploring options|what would you like next/i.test(c)
    );
  });
}
