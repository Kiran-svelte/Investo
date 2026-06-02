"use strict";
/**
 * Never-Say-No Engine — full 46-scenario conversion orchestrator.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildNeverSayNoContext = buildNeverSayNoContext;
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = __importDefault(require("../config/logger"));
const alternativeInventory_service_1 = require("./alternativeInventory.service");
const emi_service_1 = require("./emi.service");
const never_say_no_constants_1 = require("../constants/never-say-no.constants");
const conversionSettings_service_1 = require("./conversionSettings.service");
const conversionIntent_service_1 = require("./conversionIntent.service");
const neverSayNoPromptSections_service_1 = require("./neverSayNoPromptSections.service");
async function searchPartnerInventory(partnerCompanyIds, criteria) {
    if (partnerCompanyIds.length === 0)
        return [];
    const results = [];
    for (const partnerId of partnerCompanyIds.slice(0, 5)) {
        const properties = await (0, alternativeInventory_service_1.searchExactProperties)({
            ...criteria,
            companyId: partnerId,
            limit: 3,
        });
        if (properties.length > 0) {
            const partner = await prisma_1.default.company.findUnique({
                where: { id: partnerId },
                select: { name: true },
            });
            const partnerName = partner?.name || 'Our partner';
            for (const prop of properties) {
                results.push({ companyId: partnerId, companyName: partnerName, property: prop });
            }
        }
    }
    return results;
}
function buildFractionalOwnershipSnippet(budget) {
    const propertyValue = budget * 4;
    const investmentAmount = propertyValue * 0.25;
    const monthlyRoi = Math.round((investmentAmount * 0.08) / 12);
    const fmtCr = (v) => (v / 10000000).toFixed(1) + 'Cr';
    const fmtL = (v) => (v / 100000).toFixed(1) + 'L';
    return (`## FRACTIONAL OWNERSHIP\n` +
        `- Own 25% of a ₹${fmtCr(propertyValue)} asset for ₹${fmtL(investmentAmount)} — approx ₹${monthlyRoi.toLocaleString('en-IN')}/mo income.\n` +
        `- Position as smart entry for budgets under ₹75L.`);
}
function buildEmiBridgeSnippet(stretchedBudget, originalBudget) {
    const emi = (0, emi_service_1.calculateEmi)({
        principal: stretchedBudget,
        downPayment: stretchedBudget * 0.2,
        interestRate: 8.5,
        tenureMonths: 240,
    });
    const fmtL = (v) => (v / 100000).toFixed(1) + 'L';
    const fmtEmi = Math.round(emi.monthlyEmi).toLocaleString('en-IN');
    return (`## EMI BRIDGE\n` +
        `Budget ₹${fmtL(originalBudget)} → stretch ₹${fmtL(stretchedBudget)} | EMI ~₹${fmtEmi}/mo (20% down, 20yr @ 8.5%).`);
}
function computeHighestTier(exact, alternatives, partnerCount, isFractional, usedCompetitor) {
    if (exact.length > 0)
        return 0;
    if (alternatives.length > 0) {
        const tierMap = {
            upsell_bhk: 1,
            downsell_bhk: 1,
            nearby_area: 2,
            budget_stretch: 3,
            type_pivot: 4,
            plot_pivot: 4,
            commercial_pivot: 5,
            ready_to_move: 5,
            waitlist: 7,
        };
        return tierMap[alternatives[0].tier] ?? 3;
    }
    if (partnerCount > 0)
        return 8;
    if (isFractional)
        return 6;
    if (usedCompetitor)
        return 9;
    return 7;
}
async function buildNeverSayNoContext(companyId, criteria, options = {}) {
    const settings = await (0, conversionSettings_service_1.getConversionSettings)(companyId);
    const intents = (0, conversionIntent_service_1.detectConversionIntents)(options.customerMessage || '');
    const criteriaWithConfig = {
        ...criteria,
        companyId,
        budgetStretchPercent: settings.budget_stretch_percent,
        upsellEnabled: settings.upsell_enabled,
        preferReadyToMove: intents.urgentPossession,
        propertyType: intents.wantsPlot && !criteria.propertyType
            ? 'plot'
            : intents.wantsCommercial && !criteria.propertyType
                ? 'commercial'
                : criteria.propertyType,
    };
    const exact = await (0, alternativeInventory_service_1.searchExactProperties)({ ...criteriaWithConfig, limit: 10 });
    const alternatives = exact.length === 0 ? await (0, alternativeInventory_service_1.searchAlternativeTiers)(criteriaWithConfig) : [];
    const partnerResults = exact.length === 0 && alternatives.length === 0
        ? await searchPartnerInventory(settings.partner_company_ids, criteriaWithConfig)
        : [];
    const hasOwnInventory = exact.length > 0 || alternatives.length > 0;
    const hasPartnerInventory = partnerResults.length > 0;
    const budgetMax = criteria.budgetMax ? Number(criteria.budgetMax) : null;
    let emiSnippet = null;
    let isFractionalOffered = false;
    if (budgetMax && exact.length === 0) {
        const stretchedMax = budgetMax * (1 + settings.budget_stretch_percent / 100);
        const cheapestAlt = alternatives.flatMap((t) => t.properties)[0];
        if (cheapestAlt?.priceMin) {
            const price = Number(cheapestAlt.priceMin);
            if (price > budgetMax) {
                emiSnippet = buildEmiBridgeSnippet(price, budgetMax);
            }
        }
        else if (!hasOwnInventory && partnerResults.length === 0) {
            emiSnippet = buildEmiBridgeSnippet(stretchedMax, budgetMax);
        }
        if (settings.offer_fractional &&
            budgetMax < never_say_no_constants_1.FRACTIONAL_OWNERSHIP_BUDGET_THRESHOLD_PAISE) {
            isFractionalOffered = true;
        }
    }
    const lines = [];
    lines.push('## NEVER-SAY-NO CONVERSION ENGINE (ALL SCENARIOS ACTIVE)');
    lines.push('⚠️ NEVER say "sorry", "we don\'t have", or "not available" without alternatives below.');
    lines.push('⚠️ ALWAYS end with a question or visit CTA.');
    lines.push('');
    if (exact.length > 0) {
        lines.push('### ✅ EXACT MATCHES');
        exact.slice(0, 5).forEach((p) => lines.push((0, alternativeInventory_service_1.formatPropertyLine)(p)));
        lines.push('');
    }
    for (const tier of alternatives) {
        lines.push(`### 🔄 ${tier.tier.toUpperCase()}`);
        lines.push(`→ ${tier.messageHint}`);
        tier.properties.slice(0, 3).forEach((p) => lines.push((0, alternativeInventory_service_1.formatPropertyLine)(p)));
        lines.push('');
    }
    if (partnerResults.length > 0) {
        lines.push('### 🤝 PARTNER TENANT INVENTORY');
        for (const r of partnerResults.slice(0, 3)) {
            lines.push(`  Partner: ${r.companyName}`);
            lines.push(`  ${(0, alternativeInventory_service_1.formatPropertyLine)(r.property)}`);
        }
        lines.push('  → Disclose referral fee; client pays same price.');
        lines.push('');
    }
    if (emiSnippet) {
        lines.push(emiSnippet);
        lines.push('');
    }
    if (isFractionalOffered && budgetMax) {
        lines.push(buildFractionalOwnershipSnippet(budgetMax));
        lines.push('');
    }
    if (settings.launch_weeks_from_now && !hasOwnInventory) {
        lines.push('### 📅 PRE-LAUNCH');
        lines.push(`Launch in ${settings.launch_weeks_from_now} weeks — pre-launch ~10% below public price. Offer early-access list.`);
        lines.push('');
    }
    if (settings.special_offers.length > 0) {
        lines.push('### 🎁 SPECIAL OFFERS');
        settings.special_offers.forEach((o) => lines.push(`  - ${o}`));
        lines.push('');
    }
    lines.push(...(0, neverSayNoPromptSections_service_1.buildIntentScenarioSections)({
        settings,
        intents,
        hasOwnInventory,
        hasPartnerInventory,
        customerName: options.customerName,
        area: criteria.locationPreference,
    }));
    lines.push((0, neverSayNoPromptSections_service_1.buildWaitlistSection)(settings, options.language));
    if (!hasOwnInventory && !hasPartnerInventory) {
        lines.push('');
        lines.push('### 💡 VALUE-ADD SERVICES');
        never_say_no_constants_1.VALUE_ADD_SERVICES.forEach((s) => lines.push(`  - ${s}`));
        lines.push('');
        lines.push((0, neverSayNoPromptSections_service_1.buildCompetitorReferralSection)(settings));
    }
    if (settings.business_type === 'rental') {
        lines.push('### RENTAL BUSINESS RULES');
        lines.push('Buy requests → rent-to-own + sales partner intro.');
        lines.push('');
    }
    else if (settings.business_type === 'residential_sale') {
        lines.push('### RESIDENTIAL SALE RULES');
        lines.push('Commercial requests → residential ROI + commercial agent intro.');
        lines.push('');
    }
    else if (settings.business_type === 'fractional') {
        lines.push('### FRACTIONAL SPECIALIST');
        lines.push('Lead with fractional ROI; upsell full ownership when budget grows.');
        lines.push('');
    }
    const usedCompetitor = !hasOwnInventory && !hasPartnerInventory;
    const highestTierUsed = usedCompetitor
        ? 9
        : computeHighestTier(exact, alternatives, partnerResults.length, isFractionalOffered, false);
    const exactPropertyIds = exact.map((p) => p.id);
    const alternativePropertyIds = [
        ...alternatives.flatMap((t) => t.properties.map((p) => p.id)),
        ...partnerResults.map((r) => r.property.id),
    ];
    const hasInventoryAlternatives = exactPropertyIds.length + alternativePropertyIds.length > 0;
    const fallbackCta = hasInventoryAlternatives
        ? 'Would you like to book a site visit for your top pick this week?'
        : 'Should I add you to the waitlist, run a portal search, or connect you to a partner?';
    logger_1.default.info('Never-Say-No context built', {
        companyId,
        exactCount: exact.length,
        alternativeTiers: alternatives.map((t) => t.tier),
        partnerResultCount: partnerResults.length,
        highestTierUsed,
        intents: Object.entries(intents).filter(([, v]) => v).map(([k]) => k),
    });
    return {
        promptBlock: lines.join('\n'),
        exactPropertyIds,
        alternativePropertyIds: [...new Set(alternativePropertyIds)],
        highestTierUsed,
        emiSnippet,
        isFractionalOffered,
        isPartnerReferralOffered: partnerResults.length > 0 || settings.partners.some((p) => p.active),
        fallbackCta,
        hasInventoryAlternatives,
    };
}
