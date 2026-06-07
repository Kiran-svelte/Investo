/**
 * Global safe LLM parameters for buyer-facing chat (fix.md §2).
 * All buyer LLM calls must use these overrides.
 */
export const BUYER_LLM_SAFE_PARAMS = {
  temperature: 0,
  max_tokens: 300,
  frequency_penalty: 0.4,
  presence_penalty: 0.4,
  stop: ['\nUser:', 'Human:', '\nCustomer:'],
  response_format: { type: 'json_object' as const },
} as const;

/** OpenAI-compatible chat/completions body fragment. */
export function withBuyerLlmSafeParams<T extends Record<string, unknown>>(body: T): T & typeof BUYER_LLM_SAFE_PARAMS {
  return { ...body, ...BUYER_LLM_SAFE_PARAMS };
}
