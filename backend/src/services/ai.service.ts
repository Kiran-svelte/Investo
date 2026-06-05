import config from '../config';
import logger from '../config/logger';
import {
  resolveCustomerDisclaimer,
  shouldAppendDisclaimer,
} from '../constants/legalDisclaimer.constants';
import {
  ConversationState,
  ConversationStage,
  NextBestAction,
  conversationStateManager,
  classifyMessageIntent,
  getStageConfig,
} from './conversationStateMachine';
import {
  buildFastPathCustomerReply,
  isConversationAcknowledgmentMessage,
  resolveAdminLanguageCode,
  shouldSkipKnowledgeSearchForMessage,
} from './customerMessageFastPath.service';
import { buildRealEstateAssistantPolicyPrompt } from '../constants/realEstateAssistantPrompt.constants';
import { fetchOpenAi, OPENAI_CHAT_URL } from './openaiStatus.service';
import {
  formatKnowledgeContextForPrompt,
  searchPropertyKnowledge,
} from './propertyKnowledge.service';
import {
  formatClientMemoryForPrompt,
  searchClientMemory,
  syncLeadClientMemory,
} from './clientMemory.service';
import { stripInternalCustomerMeta } from './aiTransparency.service';

type AIProviderName = 'kimi' | 'openai' | 'claude';

interface AIRequest {
  companyId?: string;
  customerMessage: string;
  conversationHistory: any[];
  lead: any;
  properties: any[];
  aiSettings: any;
  companyName: string;
  conversationState?: ConversationState;
  /** Grounded never-say-no block from conversionEngine.service */
  conversionPromptBlock?: string;
  neverSayNoFallbackCta?: string;
  neverSayNoHasAlternatives?: boolean;
  /** Customer messages so far (for first-contact disclaimer). */
  customerMessageCount?: number;
  /**
   * Pre-built real-time lead context block from liveLeadContext.service.
   * Injected at the top of the system prompt to prevent Context Amnesia.
   * Contains current visit status, scheduled time, property, and agent info.
   */
  liveLeadContextBlock?: string;
  /**
   * The lead's current active (scheduled/confirmed) visit, if any.
   * Passed to the fast-path so greetings are visit-aware.
   */
  activeVisit?: import('./liveLeadContext.service').ActiveVisitContext | null;
}

interface AIResponse {
  text: string;
  detectedLanguage: string;
  extractedInfo?: {
    budget_min?: number;
    budget_max?: number;
    location_preference?: string;
    property_type?: string;
    customer_name?: string;
  };
  newState?: ConversationState; // NEW: Updated state after processing
  nextAction?: NextBestAction;  // NEW: What the policy brain decided
}

const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  kn: 'Kannada',
  te: 'Telugu',
  ta: 'Tamil',
  ml: 'Malayalam',
  mr: 'Marathi',
  bn: 'Bengali',
  gu: 'Gujarati',
  pa: 'Punjabi',
  or: 'Odia',
};

export class AIService {
  /**
   * Generate an AI response using the goal-directed state machine.
   * 
   * DUAL BRAIN ARCHITECTURE:
   * 1. Policy Brain: Decides WHAT to do (stage transitions, objection handling, etc.)
   * 2. Language Brain (LLM): Generates HOW to say it (natural language)
   */
  async generateResponse(request: AIRequest): Promise<AIResponse> {
    // Initialize or use existing state
    let state = request.conversationState || conversationStateManager.createInitialState();
    
    // POLICY BRAIN: Process message and decide next action
    const { newState, nextAction } = conversationStateManager.processMessage(
      state,
      request.customerMessage,
      undefined // extractedInfo will be populated after LLM response
    );

    logger.info('Policy brain decision', {
      previousStage: state.stage,
      newStage: newState.stage,
      action: nextAction.action,
      promptModifiers: nextAction.promptModifiers,
    });

    const fastPath = buildFastPathCustomerReply({
      customerMessage: request.customerMessage,
      companyName: request.companyName,
      customerName: request.lead?.customerName,
      aiSettings: request.aiSettings,
      conversationHistory: request.conversationHistory,
      propertyNames: request.properties?.map((p: { name?: string }) => p.name).filter(Boolean),
      // Visit-aware greeting: if the client has an active visit, the fast path
      // returns visit summary instead of the first-time-buyer welcome message.
      upcomingVisit: request.activeVisit ?? null,
    });
    if (fastPath) {
      return {
        text: fastPath.text,
        detectedLanguage: fastPath.detectedLanguage,
        newState,
        nextAction,
      };
    }

    const knowledgeChunks =
      request.companyId && !shouldSkipKnowledgeSearchForMessage(
        request.customerMessage,
        (request.conversationHistory ?? []).length,
      )
        ? await searchPropertyKnowledge(request.companyId, request.customerMessage, 8)
        : [];
    const knowledgeContext = formatKnowledgeContextForPrompt(knowledgeChunks);

    let clientMemoryContext = '';
    if (request.companyId && request.lead?.id) {
      try {
        await syncLeadClientMemory(request.lead.id);
        const clientChunks = await searchClientMemory({
          companyId: request.companyId,
          query: request.customerMessage,
          leadId: request.lead.id,
          limit: 10,
        });
        clientMemoryContext = formatClientMemoryForPrompt(
          clientChunks,
          request.lead.customerName,
        );
      } catch (err: unknown) {
        logger.warn('Buyer client memory retrieval failed', {
          leadId: request.lead.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // LANGUAGE BRAIN: Generate response with policy-guided prompt
    const systemPrompt = this.buildGoalDirectedPrompt(
      request,
      newState,
      nextAction,
      knowledgeContext,
      clientMemoryContext,
      request.liveLeadContextBlock,
    );
    const messages = this.buildMessages(request);
    const providers = this.getProviderOrder();
    let lastError: Error | null = null;

    for (const provider of providers) {
      if (!this.hasProviderCredentials(provider)) {
        continue;
      }

      try {
        const response = await this.callProvider(provider, systemPrompt, messages);
        
        // Update state with extracted info from LLM response.
        // Do NOT call processMessage() again here — it would double-increment messageCount,
        // causing stage advancement thresholds to fire at half the expected turn count.
        // Instead, directly apply the extracted lead preferences to the already-advanced state.
        if (response.extractedInfo) {
          const info = response.extractedInfo;
          const updatedCommitments = { ...newState.commitments };
          if (info.budget_min || info.budget_max) updatedCommitments.budgetConfirmed = true;
          if (info.location_preference) updatedCommitments.locationConfirmed = true;
          if (info.property_type) updatedCommitments.propertyTypeConfirmed = true;
          response.newState = { ...newState, commitments: updatedCommitments };
        } else {
          response.newState = newState;
        }
        
        response.nextAction = nextAction;
        return response;
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn('AI provider failed', {
          provider,
          error: lastError.message,
        });
      }
    }

    if (lastError) {
      logger.warn('All configured AI providers failed, using smart mock response', {
        error: lastError.message,
      });
    } else {
      logger.warn('No AI provider configured, using smart mock response');
    }

    const mockResp = this.mockResponse(request);
    mockResp.newState = newState;
    mockResp.nextAction = nextAction;
    return mockResp;
  }

  /**
   * Build a goal-directed prompt using Policy Brain decisions.
   * This is the LANGUAGE BRAIN - it crafts the actual message.
   */
  private disclaimerPromptLine(request: AIRequest): string {
    const count = request.customerMessageCount ?? 1;
    if (!shouldAppendDisclaimer({ customerMessageCount: count })) {
      return '';
    }
    const disclaimer = resolveCustomerDisclaimer(request.aiSettings);
    return `\n## DISCLAIMER (include once naturally at end)\n${disclaimer}`;
  }

  private buildGoalDirectedPrompt(
    request: AIRequest,
    state: ConversationState,
    nextAction: NextBestAction,
    knowledgeContext = '',
    clientMemoryContext = '',
    liveLeadContextBlock = '',
  ): string {
    const { aiSettings, companyName, properties, lead } = request;
    const stageConfig = getStageConfig(state.stage);
    const tone = aiSettings.responseTone || 'friendly';
    
    // Build property context
    const propertyList = properties
      .filter((p: any) => p.status === 'available')
      .slice(0, 10)
      .map((p: any) => {
        const amenities = typeof p.amenities === 'string' ? JSON.parse(p.amenities) : (p.amenities || []);
        return `- ${p.name} | ${p.locationArea}, ${p.locationCity} | ₹${formatPrice(p.priceMin)}-${formatPrice(p.priceMax)} | ${p.bedrooms}BHK ${p.propertyType} | Amenities: ${(amenities || []).slice(0, 5).join(', ')}${p.brochureUrl ? ' | Brochure PDF: on file' : ''}`;
      })
      .join('\n');

    // Build commitment status
    const commitmentStatus = [
      state.commitments.budgetConfirmed ? '✅ Budget' : '❌ Budget',
      state.commitments.locationConfirmed ? '✅ Location' : '❌ Location',
      state.commitments.propertyTypeConfirmed ? '✅ Property Type' : '❌ Property Type',
      state.commitments.visitSlotDiscussed ? '✅ Visit Discussed' : '❌ Visit Discussed',
    ].join(' | ');

    return `# GOAL-DIRECTED REAL ESTATE AI FOR ${companyName}
${liveLeadContextBlock ? `\n${liveLeadContextBlock}\n` : ''}
## YOUR MISSION
You are NOT a generic chatbot. You are a SALES FUNNEL AI with ONE goal: Get the customer to book a property site visit.

## CURRENT STATE
- Stage: ${state.stage.toUpperCase()} (${stageConfig.goal})
- Messages in stage: ${state.messageCount}
- Commitments: ${commitmentStatus}
- Value Score: ${state.valueScore}/10
- Urgency Score: ${state.urgencyScore}/10

## POLICY BRAIN DECISION
Action: ${nextAction.action}
${nextAction.promptModifiers.map(m => `- ${m}`).join('\n')}

## STAGE FOCUS
${stageConfig.promptFocus}

${buildRealEstateAssistantPolicyPrompt()}

## ABSOLUTE RULES
1. RESPOND IN THE CUSTOMER'S LANGUAGE when they write in that language; otherwise use ${SUPPORTED_LANGUAGES[resolveAdminLanguageCode(aiSettings)] || 'English'} (company default: ${aiSettings.defaultLanguage || 'en'})
2. NEVER discuss non-real-estate topics. Bridge back immediately.
3. LEGAL SAFETY: NEVER state prices, BHK, area, amenities, RERA, possession, discounts, ROI, loan amounts, or comparisons unless they appear verbatim in AVAILABLE PROPERTIES, GROUNDED PROJECT KNOWLEDGE, or the NEVER-SAY-NO block below.
4. EMI figures are allowed ONLY when the NEVER-SAY-NO block includes an EMI BRIDGE snippet (deterministic calculator output).
5. Do not invent percentage discounts, "limited offer" claims, or possession/handover dates.
6. If a fact is missing from the data blocks, say it is not in our current records and offer an agent or brochure — do not guess.
6b. When a listing shows Brochure PDF on file, offer to share it; the system sends the PDF attachment after your message. Never paste URLs or markdown links for brochures.
6c. Match customer location words (area, city) and property type (villa, apartment, plot, commercial) to the closest listing in AVAILABLE PROPERTIES before describing a project.
7. ONE clear call-to-action per message.
8. Keep responses under 200 words.
8b. NEVER append meta footers (Confidence, Sources, "Reply WRONG", price-updated lines) — those are internal only.
9. ${state.stage === 'rapport' ? 'Ask ONE warm open question about what they are looking for (area, budget, property type). Do NOT list your services or say "Here is how I can help". Open with a personal question like "What area are you exploring?" or "Looking for something to move in soon, or a long-term investment?"' : state.stage === 'qualify' ? 'Ask ONE question per response' : state.stage === 'shortlist' ? 'Present properties with VALUE highlights' : state.stage === 'commitment' ? 'Ask for the visit commitment' : state.stage === 'visit_booking' && state.commitments.visitSlotDiscussed ? 'Customer already proposed a visit time — confirm details only; do NOT ask again if they want to book a visit' : 'Move toward booking'}
10. NEVER list your capabilities. NEVER say "Here's how I can help:", "I can do:", or any numbered service menu. Respond to what they actually said.
${this.disclaimerPromptLine(request)}

## TONE: ${tone.toUpperCase()}
- Persuasion Level: ${aiSettings.persuasionLevel || 7}/10
- Be helpful, not pushy
- Empathize before addressing objections

## AVAILABLE PROPERTIES
${propertyList || 'No properties listed. Tell customer listings are being updated and ask for their requirements.'}

${knowledgeContext ? `\n${knowledgeContext}\n` : ''}

${clientMemoryContext ? `\n${clientMemoryContext}\n` : ''}

${request.conversionPromptBlock ? `\n${request.conversionPromptBlock}\n` : ''}

## CUSTOMER INFO
- Name: ${lead.customerName || 'Unknown'}
- Budget: ${lead.budgetMin ? `₹${formatPrice(lead.budgetMin)}-₹${formatPrice(lead.budgetMax)}` : 'Not shared yet'}
- Location: ${lead.locationPreference || 'Not shared yet'}
- Type: ${lead.propertyType || 'Not shared yet'}

${nextAction.objectionPlaybook ? `
## OBJECTION HANDLING (ACTIVE)
Objection Type: ${nextAction.objectionPlaybook.objectionType}
EMPATHY FIRST: "${nextAction.objectionPlaybook.empathyFirst}"
REFRAME: "${nextAction.objectionPlaybook.reframe}"
BRIDGE TO VALUE: "${nextAction.objectionPlaybook.bridgeToValue}"
` : ''}

${nextAction.action === 'escalate' ? this.operatorContactPromptBlock(aiSettings) : ''}

## RESPONSE FORMAT
Respond with the WhatsApp message to send. Use *bold* for emphasis.

⚠️ NEVER emit a numbered capability menu ("Here's how I can help: 1. Answer questions 2. Compare...")
⚠️ NEVER start with "I'm here to assist you with" or "Here's what I can do" — that is robotic.
✅ Instead: ask ONE warm question, or make ONE specific property observation relevant to their message.
✅ Use emojis sparingly (1-2 per message) to match WhatsApp's natural tone: 🏡 💬 ✅ 🗓️

End your response with:
###EXTRACT###
{"language":"xx","budget_min":null,"budget_max":null,"location_preference":null,"property_type":null,"customer_name":null}
(Only include fields you're confident about)`;
  }

  private operatorContactPromptBlock(aiSettings: { operatorContact?: unknown }): string {
    const raw = aiSettings?.operatorContact;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return '\n## SPECIALIST HANDOFF\nTell the customer a property specialist will contact them shortly.';
    }
    const contact = raw as Record<string, unknown>;
    const name = typeof contact.name === 'string' ? contact.name.trim() : '';
    const phone = typeof contact.phone === 'string' ? contact.phone.trim() : '';
    if (!name && !phone) {
      return '\n## SPECIALIST HANDOFF\nTell the customer a property specialist will contact them shortly.';
    }
    return `\n## SPECIALIST HANDOFF\nShare that *${name || 'our specialist'}*${phone ? ` (${phone})` : ''} will take over for pricing and booking details.`;
  }

  private getProviderOrder(): AIProviderName[] {
    const primaryProvider = (config.ai.provider || 'openai').toLowerCase() as AIProviderName;
    const configured: AIProviderName[] = [];
    if (config.ai.openaiApiKey?.trim()) {
      configured.push('openai');
    }
    if (config.ai.kimiApiKey?.trim()) {
      configured.push('kimi');
    }
    if (config.ai.claudeApiKey?.trim()) {
      configured.push('claude');
    }

    if (configured.length === 0) {
      return ['openai', 'kimi', 'claude'];
    }

    return [primaryProvider, ...configured.filter((provider) => provider !== primaryProvider)];
  }

  private hasProviderCredentials(provider: AIProviderName): boolean {
    switch (provider) {
      case 'kimi':
        return Boolean(config.ai.kimiApiKey);
      case 'openai':
        return Boolean(config.ai.openaiApiKey);
      case 'claude':
        return Boolean(config.ai.claudeApiKey);
      default:
        return false;
    }
  }

  private async callProvider(provider: AIProviderName, systemPrompt: string, messages: Array<{ role: string; content: string }>): Promise<AIResponse> {
    switch (provider) {
      case 'kimi':
        return await this.callKimi(systemPrompt, messages);
      case 'openai':
        return await this.callOpenAI(systemPrompt, messages);
      case 'claude':
        return await this.callClaude(systemPrompt, messages);
      default:
        throw new Error(`Unsupported AI provider: ${provider}`);
    }
  }

  /**
   * Build the system prompt that wires the AI exclusively for real estate.
   */
  private buildSystemPrompt(request: AIRequest): string {
    const { aiSettings, companyName, properties, lead } = request;
    const tone = aiSettings.responseTone || 'friendly';
    const persuasionLevel = aiSettings.persuasionLevel || 7;
    const locations = (aiSettings.operatingLocations || []).join(', ');
    const faqs = (aiSettings.faqKnowledge || [])
      .map((f: any) => `Q: ${f.question}\nA: ${f.answer}`)
      .join('\n\n');

    // Build property catalog for AI context
    const propertyList = properties
      .filter((p: any) => p.status === 'available')
      .slice(0, 10)
      .map((p: any) => {
        const amenities = typeof p.amenities === 'string' ? JSON.parse(p.amenities) : (p.amenities || []);
        return `- ${p.name} | ${p.locationArea}, ${p.locationCity} | ₹${formatPrice(p.priceMin)}-${formatPrice(p.priceMax)} | ${p.bedrooms}BHK ${p.propertyType} | Amenities: ${amenities.join(', ')} | RERA: ${p.reraNumber || 'N/A'}${p.brochureUrl ? ' | Brochure PDF: on file' : ''}`;
      })
      .join('\n');

    return `You are an AI real estate assistant for ${companyName}.

${buildRealEstateAssistantPolicyPrompt()}

## ABSOLUTE RULES (NEVER VIOLATE)
1. You are ONLY about real estate. NEVER discuss politics, religion, sports, entertainment, other products, or any non-real-estate topic. If asked, politely redirect: "I specialize in helping you find your dream property! Let me help you with that."
2. ALWAYS detect the customer's language and respond in the SAME language. You support: ${Object.values(SUPPORTED_LANGUAGES).join(', ')}. If they write in mixed languages (Hinglish, etc.), respond in the dominant language.
3. NEVER make promises about exact prices or availability without referencing the property database below.
4. NEVER share information about other companies or other customers.
5. LEGAL SAFETY: only state property facts that appear in AVAILABLE PROPERTIES or the NEVER-SAY-NO block. Do not invent builder, RERA, approvals, possession date, availability, amenities, discount %, ROI, loan amounts, or price.
6. EMI figures are allowed ONLY when the NEVER-SAY-NO block includes an EMI BRIDGE snippet.
7. If a required property fact is missing, say it is not in our current records and offer to connect an agent or share the brochure/source.
8. Your SOLE purpose is to: understand needs → match properties → convince them to book a site visit.
9. If the customer asks to CANCEL or RESCHEDULE a site visit, do NOT repeat an old "visit scheduled" confirmation. Acknowledge the change and ask for their new preferred day and time if unclear. The system updates the calendar separately — never invent a confirmation for a date they did not request.
${this.disclaimerPromptLine(request)}

## YOUR PERSONALITY
- Tone: ${tone}
- Be warm, approachable, and genuinely helpful
- Persuasion level: ${persuasionLevel}/10
- Never be pushy or aggressive
- Always empathize with concerns before addressing them

## CONVERSATION APPROACH
- Start with ONE warm, open question about what they're looking for (area, budget, type).
- Discover needs naturally through conversation: budget, location, property type, timeline.
- Match requirements to 2-3 best listings from AVAILABLE PROPERTIES.
- Highlight value, location advantages, and unique benefits — no invented claims.
- Guide them toward booking a *free, no-commitment site visit*.
- Always end with ONE clear call-to-action.
- NEVER open with a numbered list of what you can do. That reads like a robot.

## OBJECTION HANDLING
- "Too expensive" → Show similar in lower range, explain long-term value, EMI options
- "Not interested" → Ask specifically what doesn't match, show alternative
- "Will think about it" → "Absolutely! But since visiting is free and no commitment, why not just come see it this weekend? Many of our happy homeowners started with just a visit!"
- "Looking at other options" → "That's smart! Comparing is important. We'd love for you to see our properties too - they often surprise people with the value they offer."
- "Too far" → Highlight connectivity, upcoming infrastructure, price advantage

## CREATING URGENCY (WITHOUT PRESSURE)
- "This property has been getting a lot of interest lately"
- "I can reserve a visit slot for you before they fill up"
- "Properties in this area have been appreciating well"

## AVAILABLE PROPERTIES
${propertyList || 'No properties currently listed. Inform the customer that listings are being updated and ask for their preferences so you can notify them.'}

${request.conversionPromptBlock ? `\n${request.conversionPromptBlock}\n` : ''}

## OPERATING AREAS
${locations || 'All major cities'}

## COMPANY FAQ
${faqs || 'No specific FAQs configured.'}

## CUSTOMER INFO (if known)
- Name: ${lead.customerName || 'Unknown'}
- Budget: ${lead.budgetMin ? `₹${formatPrice(lead.budgetMin)}-₹${formatPrice(lead.budgetMax)}` : 'Not specified'}
- Location preference: ${lead.locationPreference || 'Not specified'}
- Property type: ${lead.propertyType || 'Not specified'}

## RESPONSE FORMAT
Respond ONLY with the message text to send to the customer. Keep responses concise (under 300 words) and conversational. Use WhatsApp-friendly formatting (* for bold, _ for italic).

## EXTRACTION
After your response, add a JSON block on a new line starting with ###EXTRACT### containing any information you detected:
{"language":"xx","budget_min":null,"budget_max":null,"location_preference":null,"property_type":null,"customer_name":null}
Only include fields you are confident about. Use null for unknown fields.`;
  }

  private buildMessages(request: AIRequest): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    // Add conversation history (last 20 messages)
    const history = request.conversationHistory.slice(-20);
    for (const msg of history) {
      if (msg.senderType === 'customer') {
        messages.push({ role: 'user', content: msg.content });
      } else if (msg.senderType === 'ai') {
        messages.push({ role: 'assistant', content: msg.content });
      }
    }

    const latest = request.customerMessage.trim();
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (latest && lastUser?.content?.trim() !== latest) {
      messages.push({ role: 'user', content: latest });
    }

    return messages;
  }

  /**
   * Call Claude API.
   */
  private async callClaude(systemPrompt: string, messages: Array<{ role: string; content: string }>): Promise<AIResponse> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.ai.claudeApiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.ai.claudeModel,
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.length > 0 ? messages : [{ role: 'user', content: 'Hello' }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error: ${response.status} ${error}`);
    }

    const data = await response.json() as any;
    const text = data.content?.[0]?.text || '';

    return this.parseAIResponse(text);
  }

  /**
   * Call Kimi API as the primary provider.
   */
  private async callKimi(systemPrompt: string, messages: Array<{ role: string; content: string }>): Promise<AIResponse> {
    const response = await fetch(this.buildChatCompletionsUrl(config.ai.kimiApiBaseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.ai.kimiApiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.kimi25Model,
        max_tokens: 1024,
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          ...(messages.length > 0 ? messages : [{ role: 'user', content: 'Hello' }]),
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Kimi API error: ${response.status} ${error}`);
    }

    const data = await response.json() as any;
    const text = data.choices?.[0]?.message?.content || '';

    return this.parseAIResponse(text);
  }

  /**
   * Call OpenAI API as fallback.
   */
  private async callOpenAI(systemPrompt: string, messages: Array<{ role: string; content: string }>): Promise<AIResponse> {
    const allMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const response = await fetchOpenAi(
      OPENAI_CHAT_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.ai.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: config.ai.openaiModel,
          messages: allMessages,
          max_tokens: 1024,
          temperature: 0.7,
        }),
      },
      { retries: 2, label: 'whatsapp_ai_chat' },
    );

    const data = await response.json() as any;
    const text = data.choices?.[0]?.message?.content || '';

    return this.parseAIResponse(text);
  }

  private buildChatCompletionsUrl(baseUrl: string): string {
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return new URL('chat/completions', normalizedBaseUrl).toString();
  }

  /**
   * Fallback response when ALL configured LLM providers fail (network, rate-limit, API key).
   * This path must NEVER produce the generic onboarding greeting mid-conversation — that was
   * the root cause of the "Hello! Welcome to Palm. How can I help you find your dream property?"
   * message appearing after a reschedule action.
   *
   * Rules:
   * - If customer has an active visit → acknowledge it; do not reset.
   * - If conversation has prior history → continue naturally; do not greet again.
   * - Never list capabilities. Never use numbered menus.
   * - One clear CTA only.
   */
  private mockResponse(request: AIRequest): AIResponse {
    const name = request.lead?.customerName ? ` ${request.lead.customerName}` : '';
    const company = request.companyName || 'us';

    // Priority 1: Visit-aware fallback — never ignore an active visit.
    if (request.activeVisit) {
      const { propertyName, status } = request.activeVisit;
      const prop = propertyName ? `*${propertyName}*` : 'your property';
      const statusLine =
        status === 'confirmed'
          ? `Your visit to ${prop} is confirmed ✅`
          : `You have an upcoming visit to ${prop} 🗓️`;
      return {
        text:
          `${statusLine}\n\nI'm having a brief connection issue but I'll be right back.\n\n` +
          `Reply *Confirm*, *Reschedule*, or *Call Agent* and I'll take care of it. 👍`,
        detectedLanguage: 'en',
        extractedInfo: undefined,
      };
    }

    // Priority 2: Returning customer (has conversation history) — do not greet again.
    const historyLength = (request.conversationHistory ?? []).length;
    if (historyLength >= 2) {
      return {
        text:
          `Apologies${name}, I'm experiencing a brief technical issue. ` +
          `I'll respond to your query in a moment — please bear with me! 🙏`,
        detectedLanguage: 'en',
        extractedInfo: undefined,
      };
    }

    // Priority 3: First contact only — minimal, non-robotic greeting.
    return {
      text:
        `*Hey${name}!* 👋 Welcome to *${company}*.\n\n` +
        `What area are you exploring, and what's your budget range? ` +
        `I'll match you with the right properties right away. 🏡`,
      detectedLanguage: 'en',
      extractedInfo: undefined,
    };
  }

  /**
   * Parse AI response and extract structured info.
   */
  private parseAIResponse(rawText: string): AIResponse {
    let text = rawText;
    let extractedInfo: AIResponse['extractedInfo'] = undefined;
    let detectedLanguage = 'en';

    // Extract the ###EXTRACT### JSON block
    const extractMatch = text.match(/###EXTRACT###\s*(\{[\s\S]*?\})/);
    if (extractMatch) {
      text = text.replace(/###EXTRACT###[\s\S]*$/, '').trim();
      try {
        const info = JSON.parse(extractMatch[1]);
        detectedLanguage = info.language || 'en';
        extractedInfo = {};
        if (info.budget_min) extractedInfo.budget_min = info.budget_min;
        if (info.budget_max) extractedInfo.budget_max = info.budget_max;
        if (info.location_preference) extractedInfo.location_preference = info.location_preference;
        if (info.property_type) extractedInfo.property_type = info.property_type;
        if (info.customer_name) extractedInfo.customer_name = info.customer_name;
      } catch {
        logger.warn('Failed to parse AI extraction block');
      }
    }

    return { text: stripInternalCustomerMeta(text), detectedLanguage, extractedInfo };
  }
}

function formatPrice(value: number | null): string {
  if (!value) return '0';
  if (value >= 10000000) return (value / 10000000).toFixed(1) + 'Cr';
  if (value >= 100000) return (value / 100000).toFixed(1) + 'L';
  if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
  return value.toString();
}

export const aiService = new AIService();
