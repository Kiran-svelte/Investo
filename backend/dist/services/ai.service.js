"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiService = exports.AIService = void 0;
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
const legalDisclaimer_constants_1 = require("../constants/legalDisclaimer.constants");
const conversationStateMachine_1 = require("./conversationStateMachine");
const customerMessageFastPath_service_1 = require("./customerMessageFastPath.service");
const buyerVisitQuery_service_1 = require("./buyerVisitQuery.service");
const realEstateAssistantPrompt_constants_1 = require("../constants/realEstateAssistantPrompt.constants");
const openaiStatus_service_1 = require("./openaiStatus.service");
const propertyKnowledge_service_1 = require("./propertyKnowledge.service");
const clientMemory_service_1 = require("./clientMemory.service");
const aiTransparency_service_1 = require("./aiTransparency.service");
const SUPPORTED_LANGUAGES = {
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
class AIService {
    /**
     * Generate an AI response using the goal-directed state machine.
     *
     * DUAL BRAIN ARCHITECTURE:
     * 1. Policy Brain: Decides WHAT to do (stage transitions, objection handling, etc.)
     * 2. Language Brain (LLM): Generates HOW to say it (natural language)
     */
    async generateResponse(request) {
        // Initialize or use existing state
        let state = request.conversationState || conversationStateMachine_1.conversationStateManager.createInitialState();
        // POLICY BRAIN: Process message and decide next action
        const { newState, nextAction } = conversationStateMachine_1.conversationStateManager.processMessage(state, request.customerMessage, undefined // extractedInfo will be populated after LLM response
        );
        logger_1.default.info('Policy brain decision', {
            previousStage: state.stage,
            newStage: newState.stage,
            action: nextAction.action,
            promptModifiers: nextAction.promptModifiers,
        });
        // Deterministic visit-status replies — never LLM, never escalate (ai.md §3 & §5).
        if ((0, buyerVisitQuery_service_1.isBuyerVisitStatusQuery)(request.customerMessage)
            && request.companyId
            && request.lead?.id) {
            const visitReply = await (0, buyerVisitQuery_service_1.buildBuyerVisitStatusReply)({
                leadId: request.lead.id,
                companyId: request.companyId,
                companyName: request.companyName,
            });
            return {
                text: visitReply,
                detectedLanguage: (0, customerMessageFastPath_service_1.resolveAdminLanguageCode)(request.aiSettings),
                newState: {
                    ...newState,
                    stage: newState.stage === 'human_escalated' ? 'confirmation' : newState.stage,
                    escalationReason: null,
                },
                nextAction: { action: 'continue', promptModifiers: ['Visit status listed from database.'] },
            };
        }
        // Never keep customers stuck in human_escalated for normal messages.
        if (newState.stage === 'human_escalated' && nextAction.action === 'escalate') {
            newState.stage = 'rapport';
            newState.escalationReason = null;
            nextAction.action = 'continue';
            nextAction.targetStage = undefined;
            nextAction.promptModifiers = [
                'Customer re-engaged after escalation. Continue naturally — do NOT say a specialist will assist.',
            ];
        }
        const fastPath = (0, customerMessageFastPath_service_1.buildFastPathCustomerReply)({
            customerMessage: request.customerMessage,
            companyName: request.companyName,
            customerName: request.lead?.customerName,
            aiSettings: request.aiSettings,
            conversationHistory: request.conversationHistory,
            propertyNames: request.properties?.map((p) => p.name).filter(Boolean),
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
        const knowledgeChunks = request.companyId && !(0, customerMessageFastPath_service_1.shouldSkipKnowledgeSearchForMessage)(request.customerMessage, (request.conversationHistory ?? []).length)
            ? await (0, propertyKnowledge_service_1.searchPropertyKnowledge)(request.companyId, request.customerMessage, 8)
            : [];
        const knowledgeContext = (0, propertyKnowledge_service_1.formatKnowledgeContextForPrompt)(knowledgeChunks);
        let clientMemoryContext = '';
        let leadMemoryBlock = '';
        let conversationContextBlock = request.conversationContextBlock ?? '';
        if (request.companyId && request.lead?.id) {
            try {
                const { buildPromptMemoryBlock } = await Promise.resolve().then(() => __importStar(require('./lead-memory.service')));
                leadMemoryBlock = await buildPromptMemoryBlock(request.lead.id);
            }
            catch (err) {
                logger_1.default.warn('Lead memory block failed', {
                    leadId: request.lead.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            if (!conversationContextBlock && request.conversationId) {
                try {
                    const { buildConversationContextBlock } = await Promise.resolve().then(() => __importStar(require('./conversation-summary.service')));
                    conversationContextBlock = await buildConversationContextBlock(request.conversationId, request.lead.id, request.companyId);
                }
                catch (err) {
                    logger_1.default.warn('Conversation context block failed', {
                        leadId: request.lead.id,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            try {
                const clientChunks = await (0, clientMemory_service_1.searchClientMemory)({
                    companyId: request.companyId,
                    query: request.customerMessage,
                    leadId: request.lead.id,
                    limit: 10,
                });
                clientMemoryContext = (0, clientMemory_service_1.formatClientMemoryForPrompt)(clientChunks, request.lead.customerName);
            }
            catch (err) {
                logger_1.default.warn('Buyer client memory retrieval failed', {
                    leadId: request.lead.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
        const mergedMemoryContext = [leadMemoryBlock, conversationContextBlock, clientMemoryContext]
            .filter(Boolean)
            .join('\n\n');
        // LANGUAGE BRAIN: Generate response with policy-guided prompt
        const systemPrompt = this.buildGoalDirectedPrompt(request, newState, nextAction, knowledgeContext, mergedMemoryContext, request.liveLeadContextBlock);
        const messages = this.buildMessages(request);
        const providers = this.getProviderOrder();
        let lastError = null;
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
                    if (info.budget_min || info.budget_max)
                        updatedCommitments.budgetConfirmed = true;
                    if (info.location_preference)
                        updatedCommitments.locationConfirmed = true;
                    if (info.property_type)
                        updatedCommitments.propertyTypeConfirmed = true;
                    response.newState = { ...newState, commitments: updatedCommitments };
                }
                else {
                    response.newState = newState;
                }
                response.nextAction = nextAction;
                return response;
            }
            catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                logger_1.default.warn('AI provider failed', {
                    provider,
                    error: lastError.message,
                });
            }
        }
        if (lastError) {
            logger_1.default.warn('All configured AI providers failed, using smart mock response', {
                error: lastError.message,
            });
        }
        else {
            logger_1.default.warn('No AI provider configured, using smart mock response');
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
    disclaimerPromptLine(request) {
        const count = request.customerMessageCount ?? 1;
        if (!(0, legalDisclaimer_constants_1.shouldAppendDisclaimer)({ customerMessageCount: count })) {
            return '';
        }
        const disclaimer = (0, legalDisclaimer_constants_1.resolveCustomerDisclaimer)(request.aiSettings);
        return `\n## DISCLAIMER (include once naturally at end)\n${disclaimer}`;
    }
    buildGoalDirectedPrompt(request, state, nextAction, knowledgeContext = '', clientMemoryContext = '', liveLeadContextBlock = '') {
        const { aiSettings, companyName, properties, lead } = request;
        const stageConfig = (0, conversationStateMachine_1.getStageConfig)(state.stage);
        const tone = aiSettings.responseTone || 'friendly';
        // Build property context — filter to available only, limit to 10 to avoid huge prompts
        const propertyList = properties
            .filter((p) => p.status === 'available')
            .slice(0, 10)
            .map((p) => {
            let amenityList = [];
            if (Array.isArray(p.amenities)) {
                amenityList = p.amenities;
            }
            else if (typeof p.amenities === 'string' && p.amenities) {
                try {
                    amenityList = JSON.parse(p.amenities);
                }
                catch {
                    amenityList = [];
                }
            }
            const amenityStr = amenityList.slice(0, 5).join(', ');
            return `- ${p.name} | ${p.locationArea}, ${p.locationCity} | ₹${formatPrice(p.priceMin)}-${formatPrice(p.priceMax)} | ${p.bedrooms}BHK ${p.propertyType} | Amenities: ${amenityStr}${p.brochureUrl ? ' | Brochure PDF: on file' : ''}`;
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

${(0, realEstateAssistantPrompt_constants_1.buildRealEstateAssistantPolicyPrompt)()}

## ABSOLUTE RULES
1. RESPOND IN THE CUSTOMER'S LANGUAGE when they write in that language; otherwise use ${SUPPORTED_LANGUAGES[(0, customerMessageFastPath_service_1.resolveAdminLanguageCode)(aiSettings)] || 'English'} (company default: ${aiSettings.defaultLanguage || 'en'})
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
(Only include fields you're confident about)

${realEstateAssistantPrompt_constants_1.PERSONALITY_BLOCK}`;
    }
    operatorContactPromptBlock(aiSettings) {
        const raw = aiSettings?.operatorContact;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return '\n## SPECIALIST HANDOFF\nTell the customer a property specialist will contact them shortly.';
        }
        const contact = raw;
        const name = typeof contact.name === 'string' ? contact.name.trim() : '';
        const phone = typeof contact.phone === 'string' ? contact.phone.trim() : '';
        if (!name && !phone) {
            return '\n## SPECIALIST HANDOFF\nTell the customer a property specialist will contact them shortly.';
        }
        return `\n## SPECIALIST HANDOFF\nShare that *${name || 'our specialist'}*${phone ? ` (${phone})` : ''} will take over for pricing and booking details.`;
    }
    getProviderOrder() {
        const primaryProvider = (config_1.default.ai.provider || 'openai').toLowerCase();
        const configured = [];
        if (config_1.default.ai.openaiApiKey?.trim()) {
            configured.push('openai');
        }
        if (config_1.default.ai.kimiApiKey?.trim()) {
            configured.push('kimi');
        }
        if (config_1.default.ai.claudeApiKey?.trim()) {
            configured.push('claude');
        }
        if (configured.length === 0) {
            return ['openai', 'kimi', 'claude'];
        }
        return [primaryProvider, ...configured.filter((provider) => provider !== primaryProvider)];
    }
    hasProviderCredentials(provider) {
        switch (provider) {
            case 'kimi':
                return Boolean(config_1.default.ai.kimiApiKey);
            case 'openai':
                return Boolean(config_1.default.ai.openaiApiKey);
            case 'claude':
                return Boolean(config_1.default.ai.claudeApiKey);
            default:
                return false;
        }
    }
    async callProvider(provider, systemPrompt, messages) {
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
    buildMessages(request) {
        const messages = [];
        // Add conversation history (last 20 messages)
        const history = request.conversationHistory.slice(-20);
        for (const msg of history) {
            if (msg.senderType === 'customer') {
                messages.push({ role: 'user', content: msg.content });
            }
            else if (msg.senderType === 'ai') {
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
    async callClaude(systemPrompt, messages) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config_1.default.ai.claudeApiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: config_1.default.ai.claudeModel,
                max_tokens: 1024,
                system: systemPrompt,
                messages: messages.length > 0 ? messages : [{ role: 'user', content: 'Hello' }],
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Claude API error: ${response.status} ${error}`);
        }
        const data = await response.json();
        const text = data.content?.[0]?.text || '';
        return this.parseAIResponse(text);
    }
    /**
     * Call Kimi API as the primary provider.
     */
    async callKimi(systemPrompt, messages) {
        const response = await fetch(this.buildChatCompletionsUrl(config_1.default.ai.kimiApiBaseUrl), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config_1.default.ai.kimiApiKey}`,
            },
            body: JSON.stringify({
                model: config_1.default.ai.kimi25Model,
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
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        return this.parseAIResponse(text);
    }
    /**
     * Call OpenAI API as fallback.
     */
    async callOpenAI(systemPrompt, messages) {
        const allMessages = [
            { role: 'system', content: systemPrompt },
            ...messages,
        ];
        const response = await (0, openaiStatus_service_1.fetchOpenAi)(openaiStatus_service_1.OPENAI_CHAT_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config_1.default.ai.openaiApiKey}`,
            },
            body: JSON.stringify({
                model: config_1.default.ai.openaiModel,
                messages: allMessages,
                max_tokens: 1024,
                temperature: 0.7,
            }),
        }, { retries: 2, label: 'whatsapp_ai_chat' });
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        return this.parseAIResponse(text);
    }
    buildChatCompletionsUrl(baseUrl) {
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
    mockResponse(request) {
        const salutation = (0, customerMessageFastPath_service_1.formatCustomerSalutation)(request.lead?.customerName);
        const company = request.companyName || 'us';
        // Priority 0: Visit-status query — answer from context even when LLM is down.
        if ((0, buyerVisitQuery_service_1.isBuyerVisitStatusQuery)(request.customerMessage)
            && request.companyId
            && request.lead?.id) {
            // sync path only — caller should have handled async; use activeVisit snapshot if present.
            if (request.activeVisit) {
                const prop = request.activeVisit.propertyName ?? 'your property';
                const when = request.activeVisit.scheduledAt.toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    weekday: 'long',
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                });
                return {
                    text: `You have a visit to *${prop}* on ${when} (${request.activeVisit.status}).\n\n` +
                        `Reply *Confirm*, *Reschedule*, or *Cancel*.`,
                    detectedLanguage: 'en',
                };
            }
        }
        // Priority 1: Visit-aware fallback — never ignore an active visit.
        if (request.activeVisit) {
            const { propertyName, status } = request.activeVisit;
            const prop = propertyName ? `*${propertyName}*` : 'your property';
            const statusLine = status === 'confirmed'
                ? `Your visit to ${prop} is confirmed ✅`
                : `You have an upcoming visit to ${prop} 🗓️`;
            return {
                text: `${statusLine}\n\nI'm having a brief connection issue but I'll be right back.\n\n` +
                    `Reply *Confirm*, *Reschedule*, or *Call Agent* and I'll take care of it. 👍`,
                detectedLanguage: 'en',
                extractedInfo: undefined,
            };
        }
        // Priority 2: Returning customer (has conversation history) — do not greet again.
        const historyLength = (request.conversationHistory ?? []).length;
        if (historyLength >= 2) {
            return {
                text: `Apologies${salutation}, I'm experiencing a brief technical issue. ` +
                    `I'll respond to your query in a moment — please bear with me! 🙏`,
                detectedLanguage: 'en',
                extractedInfo: undefined,
            };
        }
        // Priority 3: First contact only — minimal, non-robotic greeting.
        return {
            text: `*Hey${salutation}!* 👋 Welcome to *${company}*.\n\n` +
                `What area are you exploring, and what's your budget range? ` +
                `I'll match you with the right properties right away. 🏡`,
            detectedLanguage: 'en',
            extractedInfo: undefined,
        };
    }
    /**
     * Parse AI response and extract structured info.
     */
    parseAIResponse(rawText) {
        let text = rawText;
        let extractedInfo = undefined;
        let detectedLanguage = 'en';
        // Extract the ###EXTRACT### JSON block
        const extractMatch = text.match(/###EXTRACT###\s*(\{[\s\S]*?\})/);
        if (extractMatch) {
            text = text.replace(/###EXTRACT###[\s\S]*$/, '').trim();
            try {
                const info = JSON.parse(extractMatch[1]);
                detectedLanguage = info.language || 'en';
                extractedInfo = {};
                if (info.budget_min)
                    extractedInfo.budget_min = info.budget_min;
                if (info.budget_max)
                    extractedInfo.budget_max = info.budget_max;
                if (info.location_preference)
                    extractedInfo.location_preference = info.location_preference;
                if (info.property_type)
                    extractedInfo.property_type = info.property_type;
                if (info.customer_name)
                    extractedInfo.customer_name = info.customer_name;
            }
            catch {
                logger_1.default.warn('Failed to parse AI extraction block');
            }
        }
        return { text: (0, aiTransparency_service_1.stripInternalCustomerMeta)(text), detectedLanguage, extractedInfo };
    }
}
exports.AIService = AIService;
/**
 * Formats a price value from Prisma (which may be a Decimal object) into a human-readable
 * Indian currency string (e.g. 45L, 1.2Cr). Accepts Prisma Decimal, plain number, or null.
 *
 * @param value - Price value (Prisma Decimal, number, or null)
 * @returns Formatted price string (e.g. "45L", "1.2Cr")
 */
function formatPrice(value) {
    if (value === null || value === undefined)
        return '0';
    const num = typeof value === 'number' ? value : value.toNumber();
    if (!num)
        return '0';
    if (num >= 10000000)
        return (num / 10000000).toFixed(1) + 'Cr';
    if (num >= 100000)
        return (num / 100000).toFixed(1) + 'L';
    if (num >= 1000)
        return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}
exports.aiService = new AIService();
