"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildConversionContext = buildConversionContext;
const alternativeInventory_service_1 = require("./alternativeInventory.service");
const emi_service_1 = require("./emi.service");
const conversionSettings_service_1 = require("./conversionSettings.service");
/**
 * Builds grounded conversion context for AI (tenant inventory only).
 * Partner/portal tiers are Phase 4 — read from company.settings when added.
 */
async function buildConversionContext(lead, overrides) {
    const conversion = await (0, conversionSettings_service_1.getConversionSettings)(lead.companyId);
    const criteria = {
        ...(0, alternativeInventory_service_1.criteriaFromLead)(lead),
        budgetStretchPercent: conversion.budget_stretch_percent,
        upsellEnabled: conversion.upsell_enabled,
        ...overrides,
    };
    const exact = await (0, alternativeInventory_service_1.searchExactProperties)({ ...criteria, limit: 10 });
    const alternatives = exact.length === 0 ? await (0, alternativeInventory_service_1.searchAlternativeTiers)(criteria) : [];
    const promptBlock = (0, alternativeInventory_service_1.formatAlternativesForPrompt)(exact, alternatives);
    let emiSnippet = null;
    const budgetMax = criteria.budgetMax;
    if (budgetMax && exact.length === 0) {
        const cheapest = alternatives.flatMap((t) => t.properties)[0];
        const price = cheapest?.priceMin ? Number(cheapest.priceMin) : budgetMax * 1.1;
        if (price > budgetMax) {
            const emi = (0, emi_service_1.calculateEmi)({
                principal: price,
                downPayment: price * 0.2,
                interestRate: 8.5,
                tenureMonths: 240,
            });
            emiSnippet = `EMI estimate (20% down, 20yr @ 8.5%): approx ₹${Math.round(emi.monthlyEmi).toLocaleString('en-IN')}/month on ₹${(price / 100000).toFixed(1)}L property.`;
        }
    }
    const exactPropertyIds = exact.map((p) => p.id);
    const alternativePropertyIds = alternatives.flatMap((t) => t.properties.map((p) => p.id));
    return {
        exactPropertyIds,
        alternativePropertyIds: [...new Set(alternativePropertyIds)],
        promptBlock: emiSnippet ? `${promptBlock}\n\n## EMI BRIDGE\n${emiSnippet}` : promptBlock,
        emiSnippet,
    };
}
