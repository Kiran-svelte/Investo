import type { Lead } from '@prisma/client';
import {
  criteriaFromLead,
  formatAlternativesForPrompt,
  searchAlternativeTiers,
  searchExactProperties,
  type PropertySearchCriteria,
} from './alternativeInventory.service';
import { calculateEmi } from './emi.service';
import { getConversionSettings } from './conversionSettings.service';

export interface ConversionContext {
  exactPropertyIds: string[];
  alternativePropertyIds: string[];
  promptBlock: string;
  emiSnippet: string | null;
}

/**
 * Builds grounded conversion context for AI (tenant inventory only).
 * Partner/portal tiers are Phase 4 — read from company.settings when added.
 */
export async function buildConversionContext(
  lead: Lead,
  overrides?: Partial<PropertySearchCriteria>,
): Promise<ConversionContext> {
  const conversion = await getConversionSettings(lead.companyId);
  const criteria: PropertySearchCriteria = {
    ...criteriaFromLead(lead),
    budgetStretchPercent: conversion.budget_stretch_percent,
    upsellEnabled: conversion.upsell_enabled,
    ...overrides,
  };

  const exact = await searchExactProperties({ ...criteria, limit: 10 });
  const alternatives = exact.length === 0 ? await searchAlternativeTiers(criteria) : [];

  const promptBlock = formatAlternativesForPrompt(exact, alternatives);

  let emiSnippet: string | null = null;
  const budgetMax = criteria.budgetMax;
  if (budgetMax && exact.length === 0) {
    const cheapest = alternatives.flatMap((t) => t.properties)[0];
    const price = cheapest?.priceMin ? Number(cheapest.priceMin) : budgetMax * 1.1;
    if (price > budgetMax) {
      const emi = calculateEmi({
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
