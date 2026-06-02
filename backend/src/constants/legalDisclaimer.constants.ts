/** Default first-contact / periodic legal disclaimer for customer-facing AI. */
export const DEFAULT_PROPERTY_DISCLAIMER_EN =
  'Details shared here are indicative and subject to verification on your site visit.';

export const DISCLAIMER_SETTING_KEY = 'customer_disclaimer';

export function resolveCustomerDisclaimer(aiSettings?: {
  faqKnowledge?: unknown;
  greetingTemplate?: string | null;
} | null): string {
  const faqs = Array.isArray(aiSettings?.faqKnowledge) ? aiSettings.faqKnowledge : [];
  const custom = faqs.find(
    (f: any) =>
      f?.key === DISCLAIMER_SETTING_KEY ||
      f?.id === DISCLAIMER_SETTING_KEY ||
      String(f?.question || '').toLowerCase().includes('disclaimer'),
  );
  if (custom?.answer && typeof custom.answer === 'string' && custom.answer.trim()) {
    return custom.answer.trim();
  }
  return DEFAULT_PROPERTY_DISCLAIMER_EN;
}

/** Include disclaimer on first AI reply or every Nth customer turn when periodic mode is on. */
export function shouldAppendDisclaimer(options: {
  customerMessageCount: number;
  periodicEvery?: number;
}): boolean {
  const { customerMessageCount, periodicEvery = 0 } = options;
  if (customerMessageCount <= 1) return true;
  if (periodicEvery > 0 && customerMessageCount % periodicEvery === 0) return true;
  return false;
}
