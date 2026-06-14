/**
 * @module whatsapp-turn.types
 *
 * Shared type contract for the WhatsApp turn orchestration pipeline.
 * All buyer and staff turn handlers must return a `TurnResult` so the
 * sender layer has a single, uniform payload to transmit.
 *
 * Design goals:
 * - Single TurnResult contract — no ad-hoc tuples or parallel return shapes.
 * - WhatsAppComponent replaces raw interactive JSON objects in the sender.
 * - TurnContext threads per-turn state (commit flags, workflow outcome) through
 *   the mutation language guard and sanitizer without global mutable state.
 */

export type WhatsAppAudience = 'buyer' | 'staff';

/** Controls human-like typing delay before outbound AI replies. */
export type ReplyPacingMode = 'full' | 'minimal' | 'none';

export type WhatsAppButton = { id: string; title: string };

export type ListSection = {
  title: string;
  rows: Array<{ id: string; title: string; description?: string }>;
};

/** Discriminated union of all interactive + media components for one turn. */
export type WhatsAppComponent =
  | { kind: 'buttons'; buttons: WhatsAppButton[] }
  | { kind: 'list'; title: string; sections: ListSection[] }
  | { kind: 'media'; url: string; mime: string; caption?: string };

export type TurnActionResult = {
  action: string;
  status: 'success' | 'failed' | 'needs_confirmation';
  resourceId?: string;
};

/**
 * The single return type for every buyer and staff turn handler.
 * The sender layer reads `text` + `components` and never constructs
 * its own interactive JSON — all payload building goes through
 * `metaMessageBuilder.service.ts`.
 */
export type TurnResult = {
  audience: WhatsAppAudience;
  /** Whether this handler handled the turn (false = fallthrough to next handler). */
  handled: boolean;
  /** Primary text body to send. Required when handled = true. */
  text?: string;
  /**
   * Optional interactive or media attachments.
   *
   * **Max per turn (enforced by `enforceTurnComponentBudget`):**
   * - 0 or 1 interactive (`kind='buttons'` | `kind='list'`)
   * - 0 or 1 media (`kind='media'`)
   * - Total max = 2 components
   *
   * Priority when both brochure and hero image qualify: brochure media wins.
   */
  components?: WhatsAppComponent[];
  /**
   * Optional outcome of a mutation this turn.
   * Used by `mutationLanguageGuard` to validate booking language.
   */
  actionResult?: TurnActionResult;
  /**
   * Optional key-value pairs to persist back to the conversation row
   * (stage advance, proposedVisitTime, etc.).
   */
  statePatch?: Record<string, unknown>;
  /** When true, caller must return immediately without further processing. */
  terminal?: boolean;
  /**
   * Human reply pacing before send. Defaults to `'minimal'` in the sender layer.
   * Deterministic fast paths should use `'minimal'` or `'none'`.
   */
  replyPacing?: ReplyPacingMode;
};

/**
 * Per-turn context threaded through the buyer pipeline.
 * Constructed once per inbound message; passed read-only to each handler.
 *
 * NOTE: This is a snapshot at turn start.
 * DB writes must not mutate this object.
 */
export type InboundTurnContext = {
  companyId: string;
  customerPhone: string;
  messageId?: string;
  messageText: string;
  interactiveId?: string;
  interactiveType?: string;
  /** True when conversation.status === 'agent_active' || !conversation.aiEnabled */
  humanTakeover: boolean;
};

/**
 * Extended per-turn context available mid-pipeline (after lead + conversation resolution).
 * Carries mutation outcome flags so `mutationLanguageGuard` can validate booking language.
 */
export type MidTurnContext = InboundTurnContext & {
  leadId: string;
  conversationId: string;
  /** Whether a visit booking DB write succeeded earlier this turn. */
  visitCommitted: boolean;
  /** Whether a workflow mutation completed successfully this turn. */
  workflowSuccess: boolean;
  /** Which workflow ran this turn, if any. */
  workflowId?: string;
  /** Aggregate action status for mutation language validation. */
  actionStatus?: 'success' | 'failed' | 'needs_confirmation';
};

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator input / dependency types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All data required by the buyer-turn orchestrator for a single inbound turn.
 * Constructed once in `whatsapp.service.ts` and passed down to every handler.
 * Must not be mutated by handlers — DB writes update the DB directly.
 */
export type BuyerTurnInput = {
  companyId: string;
  customerPhone: string;
  messageId: string | undefined;
  messageText: string;
  interactiveId?: string;
  interactiveType?: string;
  companyName: string;
  leadId: string;
  leadStatus: string;
  leadAssignedAgentId: string | null;
  leadCustomerName: string | null;
  leadLanguage: string | null;
  conversationId: string;
  conversationSelectedPropertyId: string | null;
  conversationProposedVisitTime: Date | null;
  conversationRecommendedPropertyIds: readonly string[];
  /** Raw commitments JSON — used by focus stack (Chunk 02). */
  conversationCommitments?: unknown;
  /** Focus model when FEATURE_BUYER_FOCUS_STACK is ON. */
  conversationFocus?: import('../services/buyer/buyerConversationFocus.service').BuyerConversationFocus;
  conversationStage: string;
  /** True when conversation.status === 'agent_active' || !conversation.aiEnabled */
  humanTakeover: boolean;
  /** Message history (last 30, oldest first). */
  history: Array<{ senderType: string; content: string; createdAt: Date }>;
  /** Whether any message in history has senderType 'ai' or 'agent'. */
  hasPriorOutbound: boolean;
};

/**
 * Injected service handles used by orchestrator handlers.
 * Keeps handlers unit-testable — mock these, not the whole WhatsAppService.
 */
export type BuyerTurnDeps = {
  /** Write a message row to the DB. Returns the created record. */
  persistOutboundMessage: (content: string, language?: string) => Promise<void>;
  /** Resolve company WhatsApp config (already resolved before the orchestrator is called). */
  whatsappConfig: import('../services/whatsapp.service').CompanyWhatsAppConfig;
};

/** Result from interactive button/list handlers — includes optional unified TurnResult for sendTurnResult. */
export type InteractiveActionResult = {
  handled: boolean;
  action?: string;
  newState?: {
    stage?: string;
    selectedPropertyId?: string;
    proposedVisitTime?: Date;
    recommendedPropertyIds?: string[];
  };
  leadStatus?: string;
  /** When set, caller must dispatch via sendTurnResult (single outbound contract). */
  turnResult?: TurnResult;
};
