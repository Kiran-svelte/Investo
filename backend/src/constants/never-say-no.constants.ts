/**
 * Never-Say-No Engine Constants
 *
 * Implements the full 46-scenario conversion matrix from the product spec.
 * Every scenario maps a client intent + inventory gap to a specific response strategy.
 * 
 * Priority order for alternatives:
 * 1. Own inventory (modify: different BHK, area, price, timeline)
 * 2. Partner inventory (via linked partner company IDs)
 * 3. Alternative products (rental, fractional, pre-launch, commercial → residential)
 * 4. Alternative services (legal check, market report, waitlist, community)
 * 5. Last resort: competitor referral with referral fee capture
 */

/** Business types a company can be configured as. */
export type CompanyBusinessType =
  | 'residential_sale'   // Sells residential properties
  | 'rental'             // Only rents residential properties
  | 'mixed'              // Both sale and rental
  | 'commercial'         // Only commercial spaces
  | 'fractional';        // Fractional ownership specialist

/** Tier of alternative offered. Higher number = further from the original request. */
export type AlternativeTierLevel =
  | 0  // Exact match
  | 1  // Upsell BHK (one more bedroom)
  | 2  // Nearby area (same city, different area)
  | 3  // Budget stretch (15% more, with EMI)
  | 4  // Type pivot (villa ↔ apartment)
  | 5  // Business type pivot (buy → rent-to-own, or rental → sale partner)
  | 6  // Fractional ownership (for low budget)
  | 7  // Pre-launch waitlist
  | 8  // Partner company inventory
  | 9; // Competitor referral (last resort)

/** A single alternative strategy with messaging template. */
export interface AlternativeStrategy {
  /** Numeric tier — lower is better (closer to original request). */
  tier: AlternativeTierLevel;
  /** Human-readable label for analytics tracking. */
  label: string;
  /**
   * Message template injected into AI prompt.
   * Supports placeholders: {bhk}, {area}, {budget}, {stretchBudget},
   * {emi}, {city}, {partnerName}, {referralDiscount}
   */
  messageTemplate: string;
  /** Whether this strategy requires a partner to be configured. */
  requiresPartner: boolean;
  /** Whether this strategy requires a referral fee agreement. */
  capturesReferralFee: boolean;
}

/**
 * Scenario: Client asks for X BHK when it is NOT available.
 * Response: Offer X+1 BHK with value comparison.
 */
export const SCENARIO_UPSELL_BHK: AlternativeStrategy = {
  tier: 1,
  label: 'upsell_bhk',
  messageTemplate:
    "We don't have {bhk} BHK right now in {area}, but our {upsellBhk} BHK gives *30% more space for 20% more price* — better long-term value. Want to compare the floor plans?",
  requiresPartner: false,
  capturesReferralFee: false,
};

/**
 * Scenario: Client's preferred area has no inventory.
 * Response: Offer nearby area with connectivity highlight.
 */
export const SCENARIO_NEARBY_AREA: AlternativeStrategy = {
  tier: 2,
  label: 'nearby_area',
  messageTemplate:
    "We don't have {propertyType} in {preferredArea}, but we have great options in *{nearbyArea}* — just {distance} away with {connectivity}. Prices are often better too. Shall I share?",
  requiresPartner: false,
  capturesReferralFee: false,
};

/**
 * Scenario: Client's budget is slightly low.
 * Response: Stretch with EMI calculation.
 */
export const SCENARIO_BUDGET_STRETCH: AlternativeStrategy = {
  tier: 3,
  label: 'budget_stretch',
  messageTemplate:
    "At ₹{budget}, options are limited. But at ₹{stretchBudget} you unlock much better projects. *Home loan EMI: approx ₹{emi}/month* on 20-year tenure with 20% down payment. Want to check eligibility?",
  requiresPartner: false,
  capturesReferralFee: false,
};

/**
 * Scenario: Client wants apartment, we only have villas (or vice versa).
 * Response: Pivot property type with comparison.
 */
export const SCENARIO_TYPE_PIVOT_VILLA: AlternativeStrategy = {
  tier: 4,
  label: 'type_pivot_to_villa',
  messageTemplate:
    "No flats matching your criteria right now, but we have *gated villas* with the same privacy plus better amenities (pool, clubhouse, 24/7 security). Often better value per sqft. Want to see a comparison?",
  requiresPartner: false,
  capturesReferralFee: false,
};

export const SCENARIO_TYPE_PIVOT_APARTMENT: AlternativeStrategy = {
  tier: 4,
  label: 'type_pivot_to_apartment',
  messageTemplate:
    "Villa inventory is limited right now. *Premium apartments* in the same area offer similar quality with better maintenance support. Want to see options in the same price range?",
  requiresPartner: false,
  capturesReferralFee: false,
};

/**
 * Scenario: Rental-only company, client wants to buy.
 * Response A: Connect to sale partner.
 * Response B: Rent-to-own pathway.
 */
export const SCENARIO_RENTAL_TO_SALE_PARTNER: AlternativeStrategy = {
  tier: 5,
  label: 'business_pivot_rental_to_sale_partner',
  messageTemplate:
    "We specialise in *premium rentals*, but I can connect you to our trusted sales partner who handles the same quality of properties. You pay the *same price*, and we earn a referral — no extra cost to you. Want an intro?",
  requiresPartner: true,
  capturesReferralFee: true,
};

export const SCENARIO_RENT_TO_OWN: AlternativeStrategy = {
  tier: 5,
  label: 'rent_to_own',
  messageTemplate:
    "Here's an option: *rent now, buy later* 🏡\\n\\nRent from us for 12 months at ₹{rentAmount}/month. If you decide to buy within 12 months, *we'll deduct 50% of total rent from the purchase price*. It's a risk-free way to experience the property before committing.",
  requiresPartner: false,
  capturesReferralFee: false,
};

/**
 * Scenario: Client's budget is too low even for alternatives.
 * Response: Fractional ownership with ROI.
 */
export const SCENARIO_FRACTIONAL_OWNERSHIP: AlternativeStrategy = {
  tier: 6,
  label: 'fractional_ownership',
  messageTemplate:
    "At ₹{budget}, here's something exciting: *fractional ownership* 🎯\\n\\nOwn *25% of a ₹{propertyValue} property* for just ₹{investmentAmount}. Monthly ROI: approx ₹{monthlyRoi}. This is how savvy investors enter real estate at lower capital. Want to know more?",
  requiresPartner: false,
  capturesReferralFee: false,
};

/**
 * Scenario: No inventory available now.
 * Response: Pre-launch waitlist with urgency.
 */
export const SCENARIO_PRE_LAUNCH_WAITLIST: AlternativeStrategy = {
  tier: 7,
  label: 'pre_launch_waitlist',
  messageTemplate:
    "No matching inventory right now, but our *next launch is in {launchWeeks} weeks* with properties matching your criteria. Pre-launch prices are typically *10% lower* than public launch. Want me to add you to the early-access list?",
  requiresPartner: false,
  capturesReferralFee: false,
};

/**
 * Scenario: Partner company has inventory that matches.
 * Response: Partner referral with disclosure.
 */
export const SCENARIO_PARTNER_INVENTORY: AlternativeStrategy = {
  tier: 8,
  label: 'partner_inventory',
  messageTemplate:
    "I've checked our partner network and *{partnerName}* has exactly what you're looking for in {area}! 🎯\\n\\nFull disclosure: If you proceed, I get a small referral fee, but *you pay exactly the same price*. I'll be with you through the entire process. Want me to connect you?",
  requiresPartner: true,
  capturesReferralFee: true,
};

/**
 * Scenario: Nothing works — last resort is competitor referral.
 * Response: Send to competitor with referral fee.
 */
export const SCENARIO_COMPETITOR_REFERRAL: AlternativeStrategy = {
  tier: 9,
  label: 'competitor_referral',
  messageTemplate:
    "I want to be completely honest — I don't have exactly what you're looking for, but I know someone who does. Tell *{competitorName}* I sent you, and they'll give you a *{referralDiscount}% discount*. Your satisfaction matters more than the sale. 🙏",
  requiresPartner: false,
  capturesReferralFee: true,
};

/** Engagement recovery messages by days of silence. */
export const RE_ENGAGEMENT_TEMPLATES: Record<3 | 7 | 30, string> = {
  3: "Hi {name}! 👋 Still looking for a property? I have *3 new listings* that match your requirements. Want me to share?",
  7: "Market update for {area}: Prices have *increased 5% this week* 📈 Properties in your budget range are moving fast. Want to lock in before further appreciation?",
  30: "It's been a while, {name}! 🏡 I've put together a *personalised market report* for {area} based on your requirements. Things have changed — want to take a fresh look?",
};

/** Possession gap strategies — when possession is 6 months away but client needs now. */
export const POSSESSION_GAP_STRATEGIES: readonly string[] = [
  "Rent a similar unit in the same project for {months} months at ₹{rentAmount}/month — we'll deduct *50% of total rent* from your purchase price when you move in.",
  "We have a *ready-to-move* unit {distance} away — same builder, same quality, just 2 minutes walk. Want to see it?",
];

/** Response when client wants pan-India but company is city-specific. */
export const PAN_INDIA_RESPONSE =
  "We're specialists in {city} — you get the *best local knowledge and exclusive deals* here. But our partner network covers *Pune, Hyderabad, Chennai, Mumbai*. Which city are you looking at?";

/** Response when client asks about international property. */
export const INTERNATIONAL_RESPONSE =
  "We focus on India, but we have *Dubai partners* with the same service standards. The Dubai market has shown *12% appreciation this year*. Want me to connect you with our Dubai team?";

/** Value-add services when AI cannot help with property. */
export const VALUE_ADD_SERVICES: readonly string[] = [
  "I can do a *free legal verification* of any property you're considering — anywhere in India. No commitment needed.",
  "Before you decide, would you like the *top 5 things first-time buyers miss*? Many of our clients found this invaluable.",
  "Join our *WhatsApp community of 5,000+ property buyers*. Share experiences, get honest reviews, ask anything. Want the invite link?",
  "I can give you a *free market valuation* of the area you're interested in — helps you negotiate better.",
];

/** All strategies in priority order for the engine to try. */
export const ALTERNATIVE_STRATEGIES_PRIORITY: readonly AlternativeStrategy[] = [
  SCENARIO_UPSELL_BHK,
  SCENARIO_NEARBY_AREA,
  SCENARIO_BUDGET_STRETCH,
  SCENARIO_TYPE_PIVOT_VILLA,
  SCENARIO_TYPE_PIVOT_APARTMENT,
  SCENARIO_RENTAL_TO_SALE_PARTNER,
  SCENARIO_RENT_TO_OWN,
  SCENARIO_FRACTIONAL_OWNERSHIP,
  SCENARIO_PRE_LAUNCH_WAITLIST,
  SCENARIO_PARTNER_INVENTORY,
  SCENARIO_COMPETITOR_REFERRAL,
];

/** Minimum budget below which fractional ownership is always offered (₹ in paise). */
export const FRACTIONAL_OWNERSHIP_BUDGET_THRESHOLD_PAISE = 7_500_000; // ₹75L

/** Default budget stretch percentage when company has not configured one. */
export const DEFAULT_BUDGET_STRETCH_PERCENT = 15;

/** Default fractional ownership percentage offered. */
export const DEFAULT_FRACTIONAL_PERCENT = 25;

/** Default approximate monthly ROI on fractional (as % of investment per year). */
export const DEFAULT_FRACTIONAL_ANNUAL_ROI_PERCENT = 8;

/** Number of silent days before triggering re-engagement messages. */
export const RE_ENGAGEMENT_THRESHOLDS_DAYS: readonly number[] = [3, 7, 30];
