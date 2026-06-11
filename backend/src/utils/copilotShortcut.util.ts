/**
 * @file copilotShortcut.util.ts
 * @description Staff copilot quick-action button resolution.
 *
 * DESIGN DECISION: buttons are now contextual, not hardcoded.
 *   - For welcome/help_fallback: return the 3 deterministic welcome shortcuts (no LLM).
 *   - For confirmation: return null (pending-action flow must not be interrupted).
 *   - For all other replyKind values: call a tiny LLM pass (~150 tokens) that reads
 *     the outbound reply and picks 2–3 buttons from the known allowlist.
 *   - If the LLM fails or times out (2 s), fall back gracefully to null.
 *   - IDs are validated against the known button pool before being returned,
 *     so LLM hallucination cannot inject arbitrary button ids.
 */

import config from '../config';
import logger from '../config/logger';
import type { WhatsAppComponent } from '../types/whatsapp-turn.types';
import { isGlobalFeatureEnabled } from './featureRollout.util';

// ─── Button Catalogue ─────────────────────────────────────────────────────────

/** Buttons shown on welcome/help messages — deterministic, never LLM. */
export const COPILOT_WELCOME_BUTTONS = [
  { id: 'copilot-visits-today', title: 'Visits today', command: 'visits today' },
  { id: 'copilot-new-leads', title: 'New leads today', command: 'new leads today' },
  { id: 'copilot-visits-tomorrow', title: 'Visits tomorrow', command: 'visits tomorrow' },
] as const;

/** @deprecated Use COPILOT_WELCOME_BUTTONS */
export const COPILOT_SHORTCUT_BUTTONS = COPILOT_WELCOME_BUTTONS;

/** Full pool of context-sensitive buttons the LLM may select from. */
export const COPILOT_CONTEXT_BUTTONS = [
  { id: 'copilot-confirm-visit', title: 'Confirm visit', command: 'confirm visit' },
  { id: 'copilot-reschedule-visit', title: 'Reschedule visit', command: 'reschedule visit' },
  { id: 'copilot-complete-visit', title: 'Mark completed', command: 'complete visit' },
  { id: 'copilot-cancel-visit', title: 'Cancel visit', command: 'cancel visit' },
  { id: 'copilot-dashboard', title: 'Dashboard stats', command: 'dashboard stats' },
  { id: 'copilot-my-performance', title: 'My performance', command: 'my performance' },
  { id: 'copilot-list-leads', title: 'List leads', command: 'list leads' },
] as const;

const ALL_COPILOT_BUTTONS = [...COPILOT_WELCOME_BUTTONS, ...COPILOT_CONTEXT_BUTTONS];

/** id → command mapping for inbound button resolution (used by the WhatsApp handler). */
const COPILOT_BUTTON_COMMANDS: Readonly<Record<string, string>> = Object.fromEntries(
  ALL_COPILOT_BUTTONS.map((button) => [button.id, button.command]),
);

/** Valid button id set — used to filter/validate LLM output. No injection possible. */
const VALID_BUTTON_IDS: Set<string> = new Set(ALL_COPILOT_BUTTONS.map((b) => b.id as string));

/** id → title mapping for assembling the response from validated ids. */
const BUTTON_ID_TO_TITLE: Record<string, string> = Object.fromEntries(
  ALL_COPILOT_BUTTONS.map((b) => [b.id, b.title as string]),
);

// ─── Inbound Command Resolution ───────────────────────────────────────────────

/**
 * Resolve a staff inbound text from an interactive button id and/or visible title.
 * Used by the WhatsApp webhook handler to map button taps back to CRM commands.
 *
 * @param input.interactiveId - WhatsApp interactive button id.
 * @param input.messageText - Raw visible text if no interactive id.
 * @returns The canonical CRM command string, or the raw message text.
 */
export function resolveCopilotInboundCommand(input: {
  interactiveId?: string | null;
  messageText?: string | null;
}): string {
  const interactiveId = input.interactiveId?.trim();
  if (interactiveId && interactiveId.startsWith('copilot-')) {
    const mapped = COPILOT_BUTTON_COMMANDS[interactiveId];
    if (mapped) return mapped;
  }

  const messageText = (input.messageText ?? '').trim();
  if (!messageText) return '';

  const byTitle = ALL_COPILOT_BUTTONS.find(
    (button) => button.title.toLowerCase() === messageText.toLowerCase(),
  );
  if (byTitle) return byTitle.command;

  return messageText;
}

/**
 * Returns true when the interactive id is a known copilot shortcut.
 *
 * @param interactiveId - WhatsApp interactive button id to check.
 */
export function isCopilotShortcutInteractiveId(interactiveId?: string | null): boolean {
  return Boolean(interactiveId?.trim().startsWith('copilot-'));
}

// ─── Button Policy ────────────────────────────────────────────────────────────

export type CopilotReplyKind =
  | 'welcome'
  | 'help_fallback'
  | 'crm'
  | 'workflow'
  | 'intent'
  | 'agent'
  | 'confirmation'
  | 'error';

export type CopilotQuickActionInput = {
  replyKind: CopilotReplyKind;
  outboundText: string;
};

/** Welcome/help always get the default shortcut row — deterministic, no LLM. */
export function shouldSendCopilotShortcutMenu(reason: CopilotReplyKind): boolean {
  return reason === 'welcome' || reason === 'help_fallback';
}

/** LLM timeout for contextual button generation — keep extremely tight. */
const BUTTON_LLM_TIMEOUT_MS = 2_000;

/**
 * Contextual quick-action button ids catalogue string for the LLM prompt.
 * Pre-built at module init so it is not reconstructed on every call.
 */
const BUTTON_CATALOGUE_FOR_PROMPT = ALL_COPILOT_BUTTONS.map(
  (b) => `${b.id} — "${b.title}"`,
).join('\n');

/**
 * Ask a lightweight LLM to select 2–3 contextual follow-up buttons from the
 * known catalogue based on the outbound reply text.
 *
 * @param outboundText - The AI/copilot reply that was just sent to the staff user.
 * @returns Array of validated quick-action button objects, or null on failure.
 */
async function resolveButtonsFromLlm(
  outboundText: string,
): Promise<Array<{ id: string; title: string }> | null> {
  const hasOpenAi = Boolean(config.ai?.openaiApiKey?.trim());
  const hasClaude = Boolean(config.ai?.claudeApiKey?.trim());
  const hasKimi = Boolean(config.ai?.kimiApiKey?.trim());

  if (!hasOpenAi && !hasClaude && !hasKimi) return null;

  const systemPrompt =
    `You are a UI assistant for a real estate CRM staff copilot.\n` +
    `Given the assistant's last reply, choose 2–3 follow-up quick-action buttons the staff member is most likely to tap next.\n` +
    `Return ONLY a JSON array of button ids, e.g. ["copilot-confirm-visit","copilot-list-leads"].\n` +
    `You MUST only use ids from this list:\n${BUTTON_CATALOGUE_FOR_PROMPT}\n` +
    `Return [] if no buttons are relevant. Never invent ids.`;

  const userPrompt = `Reply:\n${outboundText.slice(0, 800)}`;

  try {
    const rawJson = await Promise.race([
      callLlmForButtons(systemPrompt, userPrompt, { hasOpenAi, hasClaude, hasKimi }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Button LLM timed out')),
          BUTTON_LLM_TIMEOUT_MS,
        ),
      ),
    ]);

    const parsed = parseButtonIds(rawJson);
    return parsed.length ? parsed : null;
  } catch (err: unknown) {
    logger.debug('resolveButtonsFromLlm: skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Call the first available LLM provider for button selection.
 * Provider priority: OpenAI → Claude → Kimi.
 *
 * @param system - System prompt for the LLM.
 * @param user - User prompt for the LLM.
 * @param providers - Flags indicating which providers have API keys.
 * @returns Raw string from the LLM.
 * @throws Error if all configured providers fail.
 */
async function callLlmForButtons(
  system: string,
  user: string,
  providers: { hasOpenAi: boolean; hasClaude: boolean; hasKimi: boolean },
): Promise<string> {
  if (providers.hasOpenAi) {
    try {
      return await callOpenAiForButtons(system, user);
    } catch {
      // fall through to next provider
    }
  }
  if (providers.hasClaude) {
    try {
      return await callClaudeForButtons(system, user);
    } catch {
      // fall through to next provider
    }
  }
  if (providers.hasKimi) {
    return callKimiForButtons(system, user);
  }
  throw new Error('No AI provider available for button generation');
}

/** Call OpenAI for button id selection. */
async function callOpenAiForButtons(system: string, user: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ai.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.openaiModel || 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 80,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '[]';
}

/** Call Claude for button id selection. */
async function callClaudeForButtons(system: string, user: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ai.claudeApiKey!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.ai.claudeModel || 'claude-haiku-4-5',
      max_tokens: 80,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!response.ok) throw new Error(`Claude ${response.status}`);
  const data = (await response.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? '[]';
}

/** Call Kimi for button id selection. */
async function callKimiForButtons(system: string, user: string): Promise<string> {
  const baseUrl = config.ai.kimiApiBaseUrl?.replace(/\/$/, '') ?? 'https://api.moonshot.cn/v1';
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ai.kimiApiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.kimi25Model || 'moonshot-v1-8k',
      temperature: 0,
      max_tokens: 80,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Kimi ${response.status}`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '[]';
}

/**
 * Parse a raw LLM string into a validated button array.
 * Only ids from VALID_BUTTON_IDS are returned — any hallucinated id is silently dropped.
 * Caps at 3 buttons (WhatsApp interactive limit).
 *
 * @param raw - Raw string from the LLM.
 * @returns Validated array of { id, title } objects (0–3 items).
 */
function parseButtonIds(raw: string): Array<{ id: string; title: string }> {
  try {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    const jsonStart = candidate.indexOf('[');
    const jsonEnd = candidate.lastIndexOf(']');
    if (jsonStart < 0 || jsonEnd <= jsonStart) return [];

    const parsed = JSON.parse(candidate.slice(jsonStart, jsonEnd + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item): item is string => typeof item === 'string' && VALID_BUTTON_IDS.has(item))
      .slice(0, 3)
      .map((id) => ({ id, title: BUTTON_ID_TO_TITLE[id] ?? id }));
  } catch {
    return [];
  }
}


function resolveDeterministicCopilotButtons(
  outboundText: string,
): Array<{ id: string; title: string }> {
  const text = outboundText.toLowerCase();
  if (/\bvisit|\bscheduled|\bconfirm|\breschedule|\bcancel visit/.test(text)) {
    return [
      { id: 'copilot-confirm-visit', title: 'Confirm visit' },
      { id: 'copilot-reschedule-visit', title: 'Reschedule visit' },
      { id: 'copilot-visits-today', title: 'Visits today' },
    ];
  }
  if (/\blead|\bcustomer|\bclient|\bstatus|\bvisited/.test(text)) {
    return [
      { id: 'copilot-new-leads', title: 'New leads today' },
      { id: 'copilot-list-leads', title: 'List leads' },
      { id: 'copilot-dashboard', title: 'Dashboard stats' },
    ];
  }
  if (/\bproperty|\bbrochure|\binventory|\bcatalog/.test(text)) {
    return [
      { id: 'copilot-list-leads', title: 'List leads' },
      { id: 'copilot-dashboard', title: 'Dashboard stats' },
      { id: 'copilot-my-performance', title: 'My performance' },
    ];
  }
  return COPILOT_WELCOME_BUTTONS.map(({ id, title }) => ({ id, title }));
}

/**
 * Resolve contextual staff copilot quick-action buttons for one turn.
 *
 * Decision table:
 *   welcome / help_fallback → deterministic 3-button welcome set (no LLM).
 *   confirmation            → null (pending-action flow must not be broken).
 *   all other kinds         → LLM-selected 2-3 buttons from the known pool.
 *
 * Never throws. Failures return null gracefully.
 *
 * @param input.replyKind - Classification of the outbound reply.
 * @param input.outboundText - Full text of the reply that was sent.
 * @returns Array of { id, title } buttons, or null when no menu should be shown.
 */
export async function resolveStaffCopilotQuickActions(
  input: CopilotQuickActionInput,
): Promise<Array<{ id: string; title: string }> | null> {
  // Deterministic welcome/help — always the same 3 shortcuts, no LLM needed.
  if (shouldSendCopilotShortcutMenu(input.replyKind)) {
    return COPILOT_WELCOME_BUTTONS.map(({ id, title }) => ({ id, title }));
  }

  // Pending-confirmation turns must never have shortcut buttons.
  if (input.replyKind === 'confirmation') return null;

  const llmButtons = await resolveButtonsFromLlm(input.outboundText);
  if (llmButtons?.length) return llmButtons;

  if (isGlobalFeatureEnabled('contextualCopilotButtons')) {
    return resolveDeterministicCopilotButtons(input.outboundText);
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve the WhatsApp interactive component block for one staff copilot turn.
 * Async wrapper around resolveStaffCopilotQuickActions for use in agent-router.
 *
 * @param input - Reply kind and outbound text.
 * @returns Array of WhatsAppComponent (0 or 1 items), ready for the WhatsApp API.
 */
export async function resolveCopilotComponentsAsync(
  input: CopilotQuickActionInput,
): Promise<WhatsAppComponent[]> {
  const actions = await resolveStaffCopilotQuickActions(input);
  if (!actions?.length) return [];
  return [{ kind: 'buttons', buttons: actions }];
}
