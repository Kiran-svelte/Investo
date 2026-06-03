/** Notify useCompanyFeatures (and sidebar) to reload after toggles change. */
export const FEATURES_RELOAD_EVENT = 'investo:company-features-reload';

export function dispatchCompanyFeaturesReload(): void {
  window.dispatchEvent(new Event(FEATURES_RELOAD_EVENT));
}
