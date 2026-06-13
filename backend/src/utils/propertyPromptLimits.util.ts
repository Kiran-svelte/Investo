import config from '../config';
import logger from '../config/logger';

export type PropertyPromptLimits = {
  descriptionPromptMax: number;
  focusedDescriptionMax: number;
  whatsappDescriptionMax: number;
  catalogAmenitiesMax: number;
  listAmenitiesMax: number;
  whatsappAmenitiesMax: number;
  availablePropertiesMax: number;
  knowledgeChunksMax: number;
  vectorSearchLimit: number;
  vectorSearchFocusedLimit: number;
  focusedPropertyChunks: number;
  moreInfoKnowledgeFetch: number;
  moreInfoKnowledgeAppend: number;
  enrichKnowledgeChunks: number;
};

const DEFAULT_LIMITS: PropertyPromptLimits = {
  descriptionPromptMax: 400,
  focusedDescriptionMax: 900,
  whatsappDescriptionMax: 600,
  catalogAmenitiesMax: 8,
  listAmenitiesMax: 5,
  whatsappAmenitiesMax: 12,
  availablePropertiesMax: 10,
  knowledgeChunksMax: 10,
  vectorSearchLimit: 8,
  vectorSearchFocusedLimit: 10,
  focusedPropertyChunks: 5,
  moreInfoKnowledgeFetch: 3,
  moreInfoKnowledgeAppend: 2,
  enrichKnowledgeChunks: 2,
};

const EXPANDED_LIMITS: PropertyPromptLimits = {
  descriptionPromptMax: 800,
  focusedDescriptionMax: 1800,
  whatsappDescriptionMax: 1200,
  catalogAmenitiesMax: 20,
  listAmenitiesMax: 12,
  whatsappAmenitiesMax: 24,
  availablePropertiesMax: 20,
  knowledgeChunksMax: 20,
  vectorSearchLimit: 16,
  vectorSearchFocusedLimit: 20,
  focusedPropertyChunks: 12,
  moreInfoKnowledgeFetch: 8,
  moreInfoKnowledgeAppend: 5,
  enrichKnowledgeChunks: 4,
};

let shadowMismatchLogged = false;

function logShadowMismatchOnce(): void {
  if (shadowMismatchLogged || !config.features.shadowMode) return;
  if (config.features.expandedPropertyPrompts) return;
  shadowMismatchLogged = true;
  logger.warn('expandedPropertyPrompts shadow active — serving default limits', {
    featureName: 'expandedPropertyPrompts',
    defaultKnowledgeChunksMax: DEFAULT_LIMITS.knowledgeChunksMax,
    expandedKnowledgeChunksMax: EXPANDED_LIMITS.knowledgeChunksMax,
  });
}

export function getPropertyPromptLimits(): PropertyPromptLimits {
  if (config.features.expandedPropertyPrompts) {
    return EXPANDED_LIMITS;
  }
  logShadowMismatchOnce();
  return DEFAULT_LIMITS;
}

/** Test helper — reset one-shot shadow log between cases. */
export function resetPropertyPromptLimitsShadowLogForTests(): void {
  shadowMismatchLogged = false;
}
