"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchExactProperties = searchExactProperties;
exports.searchAlternativeTiers = searchAlternativeTiers;
exports.formatPropertyLine = formatPropertyLine;
exports.formatAlternativesForPrompt = formatAlternativesForPrompt;
exports.criteriaFromLead = criteriaFromLead;
const prisma_1 = __importDefault(require("../config/prisma"));
const DEFAULT_BUDGET_STRETCH_PERCENT = 0.15;
function stretchRatio(criteria) {
    const pct = criteria.budgetStretchPercent;
    if (pct != null && Number.isFinite(pct)) {
        return Math.min(0.5, Math.max(0.05, pct / 100));
    }
    return DEFAULT_BUDGET_STRETCH_PERCENT;
}
function toNumber(value) {
    if (value === null || value === undefined)
        return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function buildBudgetFilter(budgetMin, budgetMax) {
    const AND = [];
    if (budgetMin != null) {
        AND.push({ OR: [{ priceMax: null }, { priceMax: { gte: budgetMin } }] });
    }
    if (budgetMax != null) {
        AND.push({ OR: [{ priceMin: null }, { priceMin: { lte: budgetMax } }] });
    }
    return AND.length > 0 ? { AND } : undefined;
}
async function searchExactProperties(criteria) {
    const limit = criteria.limit ?? 10;
    const where = {
        companyId: criteria.companyId,
        status: 'available',
    };
    if (criteria.bedrooms != null)
        where.bedrooms = criteria.bedrooms;
    if (criteria.propertyType)
        where.propertyType = criteria.propertyType;
    const location = criteria.locationPreference?.trim() || criteria.city?.trim();
    if (location) {
        where.OR = [
            { locationArea: { contains: location, mode: 'insensitive' } },
            { locationCity: { contains: location, mode: 'insensitive' } },
        ];
    }
    const budgetFilter = buildBudgetFilter(criteria.budgetMin, criteria.budgetMax);
    if (budgetFilter)
        Object.assign(where, budgetFilter);
    return prisma_1.default.property.findMany({
        where: where,
        take: limit,
        orderBy: { createdAt: 'desc' },
    });
}
async function searchAlternativeTiers(criteria) {
    const tiers = [];
    const baseWhere = { companyId: criteria.companyId, status: 'available' };
    // Upsell: +1 BHK same area/city
    if (criteria.upsellEnabled !== false && criteria.bedrooms != null && criteria.bedrooms >= 1) {
        const upsellWhere = {
            ...baseWhere,
            bedrooms: criteria.bedrooms + 1,
        };
        if (criteria.propertyType)
            upsellWhere.propertyType = criteria.propertyType;
        if (criteria.locationPreference) {
            upsellWhere.OR = [
                { locationArea: { contains: criteria.locationPreference, mode: 'insensitive' } },
                { locationCity: { contains: criteria.locationPreference, mode: 'insensitive' } },
            ];
        }
        const upsell = await prisma_1.default.property.findMany({ where: upsellWhere, take: 3 });
        if (upsell.length > 0) {
            tiers.push({
                tier: 'upsell_bhk',
                properties: upsell,
                messageHint: `We don't have ${criteria.bedrooms} BHK in that pocket right now, but ${criteria.bedrooms + 1} BHK gives more space — often better long-term value. Want to compare?`,
            });
        }
    }
    // Nearby area: same city, different area
    const city = criteria.city || criteria.locationPreference;
    if (city) {
        const nearby = await prisma_1.default.property.findMany({
            where: {
                ...baseWhere,
                locationCity: { contains: city, mode: 'insensitive' },
                ...(criteria.bedrooms != null ? { bedrooms: criteria.bedrooms } : {}),
                ...(criteria.propertyType ? { propertyType: criteria.propertyType } : {}),
            },
            take: 3,
            orderBy: { priceMin: 'asc' },
        });
        const filtered = nearby.filter((p) => !criteria.locationPreference ||
            !p.locationArea?.toLowerCase().includes(criteria.locationPreference.toLowerCase()));
        if (filtered.length > 0) {
            tiers.push({
                tier: 'nearby_area',
                properties: filtered,
                messageHint: `No exact match in ${criteria.locationPreference || city}, but we have strong options in nearby areas — often better commute or price. Shall I share?`,
            });
        }
    }
    // Budget stretch
    if (criteria.budgetMax != null) {
        const stretchedMax = criteria.budgetMax * (1 + stretchRatio(criteria));
        const stretched = await searchExactProperties({
            ...criteria,
            budgetMax: stretchedMax,
            limit: 3,
        });
        if (stretched.length > 0) {
            tiers.push({
                tier: 'budget_stretch',
                properties: stretched,
                messageHint: `With a small stretch to ~₹${(stretchedMax / 100000).toFixed(1)}L you unlock better projects. I can share EMI options too.`,
            });
        }
    }
    // Type pivot: villa <-> apartment
    if (criteria.propertyType === 'apartment') {
        const villas = await prisma_1.default.property.findMany({
            where: { ...baseWhere, propertyType: 'villa', ...(criteria.bedrooms != null ? { bedrooms: criteria.bedrooms } : {}) },
            take: 3,
        });
        if (villas.length > 0) {
            tiers.push({
                tier: 'type_pivot',
                properties: villas,
                messageHint: 'No matching flats right now — gated villas can offer similar privacy with clubhouse amenities. Interested?',
            });
        }
    }
    else if (criteria.propertyType === 'villa') {
        const apts = await prisma_1.default.property.findMany({
            where: { ...baseWhere, propertyType: 'apartment', ...(criteria.bedrooms != null ? { bedrooms: criteria.bedrooms } : {}) },
            take: 3,
        });
        if (apts.length > 0) {
            tiers.push({
                tier: 'type_pivot',
                properties: apts,
                messageHint: 'Villa inventory is limited — premium apartments in the same zone can match your budget. Want to see?',
            });
        }
    }
    return tiers;
}
function formatPropertyLine(p) {
    const min = toNumber(p.priceMin);
    const max = toNumber(p.priceMax);
    const price = min && max
        ? `₹${(min / 100000).toFixed(1)}–${(max / 100000).toFixed(1)}L`
        : min
            ? `from ₹${(min / 100000).toFixed(1)}L`
            : 'Price on request';
    return `- ${p.name} | ${p.locationArea || ''}, ${p.locationCity || ''} | ${p.bedrooms || '?'} BHK ${p.propertyType} | ${price}`;
}
function formatAlternativesForPrompt(exact, tiers) {
    const lines = [];
    lines.push('## CONVERSION RULES (NEVER-SAY-NO — TENANT INVENTORY ONLY)');
    lines.push('- Do NOT say "sorry" or "we don\'t have anything" without offering alternatives below.');
    lines.push('- Always end with a question or visit CTA.');
    if (exact.length > 0) {
        lines.push('\n## EXACT MATCHES');
        exact.forEach((p) => lines.push(formatPropertyLine(p)));
    }
    for (const tier of tiers) {
        lines.push(`\n## ALTERNATIVE: ${tier.tier.toUpperCase()}`);
        lines.push(`Hint: ${tier.messageHint}`);
        tier.properties.forEach((p) => lines.push(formatPropertyLine(p)));
    }
    if (exact.length === 0 && tiers.length === 0) {
        lines.push('\n## NO INVENTORY MATCH');
        lines.push('Offer: waitlist (capture requirements), EMI discussion if budget given, or ask to adjust area/BHK/budget.');
        lines.push('Say you will alert them when matching units are listed (2–4 weeks typical).');
    }
    return lines.join('\n');
}
function criteriaFromLead(lead) {
    return {
        companyId: lead.companyId,
        budgetMin: toNumber(lead.budgetMin),
        budgetMax: toNumber(lead.budgetMax),
        locationPreference: lead.locationPreference,
        propertyType: lead.propertyType,
        city: lead.locationPreference?.split(',')[0]?.trim() || lead.locationPreference,
    };
}
