import type { ConversionSettings } from './conversionSettings.service';
import type { ConversionIntents } from './conversionIntent.service';
import type { ConversionPartner } from './conversionSettings.service';
import {
  INTERNATIONAL_RESPONSE,
  PAN_INDIA_RESPONSE,
  POSSESSION_GAP_STRATEGIES,
  RE_ENGAGEMENT_TEMPLATES,
  SCENARIO_COMPETITOR_REFERRAL,
  VALUE_ADD_SERVICES,
} from '../constants/never-say-no.constants';

export interface ScenarioPromptInput {
  settings: ConversionSettings;
  intents: ConversionIntents;
  hasOwnInventory: boolean;
  hasPartnerInventory: boolean;
  customerName?: string | null;
  area?: string | null;
}

export function buildIntentScenarioSections(input: ScenarioPromptInput): string[] {
  const lines: string[] = [];
  const { settings, intents, hasOwnInventory, hasPartnerInventory } = input;
  const city = settings.primary_city || 'your city';
  const area = input.area || city;

  if (intents.wantsPanIndia) {
    lines.push('### 🌏 PAN-INDIA REQUEST');
    lines.push(
      PAN_INDIA_RESPONSE.replace('{city}', city).replace(
        'Pune, Hyderabad, Chennai, Mumbai',
        settings.pan_india_cities.join(', '),
      ),
    );
    lines.push('');
  }

  if (intents.wantsInternational && settings.international_partners_enabled) {
    lines.push('### ✈️ INTERNATIONAL REQUEST');
    lines.push(INTERNATIONAL_RESPONSE);
    lines.push('');
  }

  if (intents.urgentPossession) {
    lines.push('### ⏱️ POSSESSION URGENCY');
    for (const template of POSSESSION_GAP_STRATEGIES) {
      lines.push(
        `  - ${template
          .replace('{months}', String(settings.possession_gap_months))
          .replace('{rentAmount}', '— use property rent if known —')
          .replace('{distance}', '2 min')}`,
      );
    }
    lines.push('');
  }

  if (intents.wantsToBuy && settings.business_type === 'rental' && settings.offer_rent_to_own) {
    lines.push('### 🏠 RENT-TO-OWN (Client wants to BUY, you are rental-focused)');
    lines.push(
      `  - Rent for ${settings.rent_to_own_months} months; if they buy within that window, deduct ${settings.rent_credit_percent}% of total rent from purchase price.`,
    );
    lines.push('  - Or introduce sales partner — same quality, same price, disclose referral.');
    lines.push('');
  }

  if (intents.wantsCommercial && settings.business_type === 'residential_sale') {
    lines.push('### 🏢 COMMERCIAL REQUEST (Residential specialist)');
    lines.push('  - Offer residential ROI comparison vs commercial.');
    lines.push('  - Offer free intro to top commercial agent — no cost to client.');
    lines.push('');
  }

  if (intents.wantsPlot) {
    lines.push('### 📐 PLOT / LAND REQUEST');
    lines.push('  - If no plots: offer under-construction apartments with exit-after-possession angle.');
    lines.push('  - Or partner who specialises in plots (see partner list).');
    lines.push('');
  }

  if (intents.wantsIndependentHouse) {
    lines.push('### 🏡 INDEPENDENT HOUSE REQUEST');
    lines.push('  - Offer gated villa with same privacy + amenities comparison.');
    lines.push('  - Or partner house inventory with referral disclosure.');
    lines.push('');
  }

  const activePartners = settings.partners.filter((p) => p.active);
  if (!hasOwnInventory && !hasPartnerInventory && activePartners.length > 0) {
    lines.push('### 🤝 EXTERNAL PARTNER CRM (Manual network)');
    for (const p of activePartners.slice(0, 5)) {
      lines.push(`  - ${p.name}${p.contact_phone ? ` (${p.contact_phone})` : ''}${p.notes ? ` — ${p.notes}` : ''}`);
    }
    lines.push(
      "  → Say: 'I've checked our partner network — they may have exactly what you need. I earn a referral fee but you pay the same market price.'",
    );
    lines.push('');
  }

  if (!hasOwnInventory && settings.portal_search_enabled) {
    lines.push('### 🔍 PUBLIC LISTING NETWORK (MagicBricks / 99acres / Housing.com)');
    lines.push(
      '  - Our team monitors public listings daily for matches to client criteria.',
    );
    lines.push(
      "  - Say: 'I'll search top portals now and connect you to the listing agent — you stay in this chat, I negotiate referral and support.'",
    );
    lines.push('');
  }

  if (intents.notInterested) {
    lines.push('### 💬 NOT INTERESTED');
    lines.push(
      "  → Ask: 'When is a good time to follow up?' Offer monthly market updates for their area.",
    );
    lines.push('');
  }

  if (intents.letMeThink) {
    lines.push('### 💬 LET ME THINK');
    lines.push('  → Send top 3 comparison summary. Ask what is unclear.');
    lines.push('');
  }

  if (intents.tooExpensive) {
    lines.push('### 💬 TOO EXPENSIVE');
    lines.push('  → Offer 5% negotiation room OR extended payment plan (24 months) if company allows.');
    lines.push('  → Show downsell BHK or nearby area with better price.');
    lines.push('');
  }

  if (intents.foundElsewhere) {
    lines.push('### 💬 FOUND ANOTHER PROPERTY');
    lines.push(
      "  → Offer FREE legal verification before they sign — no obligation. '" +
        VALUE_ADD_SERVICES[0] +
        "'",
    );
    lines.push('');
  }

  if (intents.blockedOrSilent && settings.cross_channel_followup_enabled) {
    lines.push('### 📧 CROSS-CHANNEL FOLLOW-UP');
    lines.push('  - If WhatsApp fails: send email/SMS with market update (system will attempt automatically).');
    lines.push('');
  }

  // Re-engagement copy reference for automation alignment
  lines.push('### 📅 SILENCE RE-ENGAGEMENT (Automated jobs 3d/7d/30d)');
  lines.push(`  - 3d: ${RE_ENGAGEMENT_TEMPLATES[3].replace('{name}', input.customerName || 'there').replace('{area}', area)}`);
  lines.push(`  - 7d: ${RE_ENGAGEMENT_TEMPLATES[7].replace('{name}', input.customerName || 'there').replace('{area}', area)}`);
  lines.push(`  - 30d: ${RE_ENGAGEMENT_TEMPLATES[30].replace('{name}', input.customerName || 'there').replace('{area}', area)}`);
  lines.push('');

  return lines;
}

export function buildCompetitorReferralSection(settings: ConversionSettings): string {
  const template = SCENARIO_COMPETITOR_REFERRAL.messageTemplate
    .replace('{competitorName}', settings.competitor_name)
    .replace('{referralDiscount}', String(settings.referral_discount_percent));

  return (
    `### 🎯 LAST RESORT — COMPETITOR REFERRAL (Tier 9)\n` +
    `Use ONLY after offering own inventory, partners, portal search, waitlist, and value-adds.\n` +
    `Script: ${template}\n` +
    `Track: mention referral fee capture in CRM notes.`
  );
}

export function buildWaitlistSection(settings: ConversionSettings, language?: string | null): string {
  const copy =
    settings.waitlist_copy[language as keyof typeof settings.waitlist_copy] || settings.waitlist_copy.en;
  return (
    `### 📋 WAITLIST (Always available)\n` +
    `${copy}\n` +
    `Typical wait: 2–4 weeks. Capture BHK, area, budget in conversation commitments.`
  );
}

export function formatExternalPartnersForPrompt(partners: ConversionPartner[]): string[] {
  return partners
    .filter((p) => p.active)
    .map((p) => `  - ${p.name}${p.contact_phone ? ` | ${p.contact_phone}` : ''}`);
}
