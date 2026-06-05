/**
 * Declarative map of AI / WhatsApp capabilities wired in code (for health + proof scripts).
 * Update when new outbound message types or orchestration layers are connected.
 */
export const AI_STACK_CAPABILITIES = {
  llm_intent_orchestrator: {
    wired: true,
    path: 'backend/src/services/agent/agent-intent-orchestrator.service.ts',
    routes: ['classifyAgentIntent', 'extractAgentIntentParameters', 'executeAgentIntent'],
  },
  workflow_engine: {
    wired: true,
    path: 'backend/src/services/workflow/workflow-engine.service.ts',
    workflow_count: 15,
    action_handlers: 45,
  },
  client_memory_rag: {
    wired: true,
    buyer: 'ai.service.ts → searchClientMemory + propertyKnowledge embeddings',
    staff: 'agent-router → buildClientMemoryContextForAgent → invokeAgent',
  },
  whatsapp_interactive: {
    quick_reply_buttons: { wired: true, note: 'sendContextualQuickReplies after buyer AI turn' },
    interactive_buttons: { wired: true, note: 'sendInteractiveButtons; GreenAPI → numbered menu' },
    interactive_list: { wired: true, note: 'Property filter dropdown' },
    catalog_cards: { wired: true, note: 'sendCatalogMessage (image + CTA buttons)' },
    location: { wired: true, note: 'location-* interactive + sendLocation' },
    contact_card: { wired: true, note: 'sendContactCard' },
    flow_messages: { wired: true, note: 'sendFlowMessage (Meta Flow ID required)' },
    reactions: { wired: true, note: 'sendReaction' },
    media: { wired: true, note: 'sendImage / brochure delivery' },
    staff_copilot_shortcuts: { wired: true, note: 'sendCompanyInteractiveButtons after staff reply' },
  },
  staff_router_order: [
    'confirmations',
    'tryDeterministicAgentCrmReply',
    'classifyAndRunWorkflow',
    'classifyAndExecuteAgentIntent',
    'invokeAgent + clientMemory RAG',
  ],
  buyer_orchestrator: {
    wired: true,
    path: 'backend/src/services/whatsapp.service.ts',
    layers: [
      'classifyWorkflowMessage (LLM intent classifier)',
      'WORKFLOW_ACTION_HANDLERS (45 action handlers)',
      'classifyAndRunBuyerWorkflow → runWorkflow',
    ],
    fallback: 'aiService.generateResponse (policy + language brain)',
  },
  buyer_router_order: [
    'tryCommitCustomerVisitBooking',
    'classifyAndRunBuyerWorkflow (intent → handlers)',
    'aiService.generateResponse + RAG',
    'contextual quick replies + filters + media',
  ],
  staff_orchestrator: {
    wired: true,
    path: 'backend/src/services/agent/agent-router.service.ts',
    layers: [
      'classifyWorkflowMessage / classifyAgentIntent (LLM)',
      'WORKFLOW_ACTION_HANDLERS + executeAgentIntent tools',
      'classifyAndRunWorkflow → classifyAndExecuteAgentIntent → invokeAgent',
    ],
  },
} as const;
