"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiService = exports.AIService = void 0;
const config_1 = __importDefault(require("../config"));
const logger_1 = __importDefault(require("../config/logger"));
const conversationStateMachine_1 = require("./conversationStateMachine");
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
        // LANGUAGE BRAIN: Generate response with policy-guided prompt
        const systemPrompt = this.buildGoalDirectedPrompt(request, newState, nextAction);
        const messages = this.buildMessages(request);
        const providers = this.getProviderOrder();
        let lastError = null;
        for (const provider of providers) {
            if (!this.hasProviderCredentials(provider)) {
                continue;
            }
            try {
                const response = await this.callProvider(provider, systemPrompt, messages);
                // Update state with extracted info from LLM response
                if (response.extractedInfo) {
                    const { newState: finalState } = conversationStateMachine_1.conversationStateManager.processMessage(newState, '', // Empty message since we just extracted info
                    response.extractedInfo);
                    response.newState = finalState;
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
            throw lastError;
        }
        logger_1.default.warn('No AI provider configured, using smart mock response');
        const mockResp = this.mockResponse(request);
        mockResp.newState = newState;
        mockResp.nextAction = nextAction;
        return mockResp;
    }
    /**
     * Build a goal-directed prompt using Policy Brain decisions.
     * This is the LANGUAGE BRAIN - it crafts the actual message.
     */
    buildGoalDirectedPrompt(request, state, nextAction) {
        const { aiSettings, companyName, properties, lead } = request;
        const stageConfig = (0, conversationStateMachine_1.getStageConfig)(state.stage);
        const tone = aiSettings.responseTone || 'friendly';
        // Build property context
        const propertyList = properties
            .filter((p) => p.status === 'available')
            .slice(0, 10)
            .map((p) => {
            const amenities = typeof p.amenities === 'string' ? JSON.parse(p.amenities) : (p.amenities || []);
            return `- ${p.name} | ${p.locationArea}, ${p.locationCity} | ₹${formatPrice(p.priceMin)}-${formatPrice(p.priceMax)} | ${p.bedrooms}BHK ${p.propertyType} | Amenities: ${(amenities || []).slice(0, 5).join(', ')}${p.brochureUrl ? ` | Brochure: ${p.brochureUrl}` : ''}`;
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

## ABSOLUTE RULES
1. RESPOND IN THE CUSTOMER'S LANGUAGE (detect automatically)
2. NEVER discuss non-real-estate topics. Bridge back immediately.
3. NEVER make promises about exact prices without property data below.
4. ONE clear call-to-action per message.
5. Keep responses under 200 words.
6. ${state.stage === 'rapport' ? 'Be warm and curious' : state.stage === 'qualify' ? 'Ask ONE question per response' : state.stage === 'shortlist' ? 'Present properties with VALUE highlights' : state.stage === 'commitment' ? 'Ask for the visit commitment' : 'Move toward booking'}

## TONE: ${tone.toUpperCase()}
- Persuasion Level: ${aiSettings.persuasionLevel || 7}/10
- Be helpful, not pushy
- Empathize before addressing objections

## AVAILABLE PROPERTIES
${propertyList || 'No properties listed. Tell customer listings are being updated and ask for their requirements.'}

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

## RESPONSE FORMAT
Respond with the WhatsApp message to send. Use *bold* for emphasis.
End your response with:
###EXTRACT###
{"language":"xx","budget_min":null,"budget_max":null,"location_preference":null,"property_type":null,"customer_name":null}
(Only include fields you're confident about)`;
    }
    getProviderOrder() {
        const primaryProvider = (config_1.default.ai.provider || 'kimi').toLowerCase();
        const providers = ['kimi', 'openai', 'claude'];
        return [primaryProvider, ...providers.filter((provider) => provider !== primaryProvider)];
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
    /**
     * Build the system prompt that wires the AI exclusively for real estate.
     */
    buildSystemPrompt(request) {
        const { aiSettings, companyName, properties, lead } = request;
        const tone = aiSettings.responseTone || 'friendly';
        const persuasionLevel = aiSettings.persuasionLevel || 7;
        const locations = (aiSettings.operatingLocations || []).join(', ');
        const faqs = (aiSettings.faqKnowledge || [])
            .map((f) => `Q: ${f.question}\nA: ${f.answer}`)
            .join('\n\n');
        // Build property catalog for AI context
        const propertyList = properties
            .filter((p) => p.status === 'available')
            .slice(0, 10)
            .map((p) => {
            const amenities = typeof p.amenities === 'string' ? JSON.parse(p.amenities) : (p.amenities || []);
            return `- ${p.name} | ${p.locationArea}, ${p.locationCity} | ₹${formatPrice(p.priceMin)}-${formatPrice(p.priceMax)} | ${p.bedrooms}BHK ${p.propertyType} | Amenities: ${amenities.join(', ')} | RERA: ${p.reraNumber || 'N/A'}${p.brochureUrl ? ` | Brochure: ${p.brochureUrl}` : ''}`;
        })
            .join('\n');
        return `You are an AI real estate assistant for ${companyName}.

## ABSOLUTE RULES (NEVER VIOLATE)
1. You are ONLY about real estate. NEVER discuss politics, religion, sports, entertainment, other products, or any non-real-estate topic. If asked, politely redirect: "I specialize in helping you find your dream property! Let me help you with that."
2. ALWAYS detect the customer's language and respond in the SAME language. You support: ${Object.values(SUPPORTED_LANGUAGES).join(', ')}. If they write in mixed languages (Hinglish, etc.), respond in the dominant language.
3. NEVER make promises about exact prices or availability without referencing the property database below.
4. NEVER share information about other companies or other customers.
5. Your SOLE purpose is to: understand needs → match properties → convince them to book a site visit.

## YOUR PERSONALITY
- Tone: ${tone}
- Be warm, approachable, and genuinely helpful
- Persuasion level: ${persuasionLevel}/10
- Never be pushy or aggressive
- Always empathize with concerns before addressing them

## CONVERSATION STRATEGY
1. GREET warmly and ask how you can help
2. DISCOVER needs: budget, preferred location, property type (apartment/villa/plot), bedrooms, timeline
3. MATCH: Search the property database and present 2-3 best options
4. PERSUADE: Highlight benefits, value, location advantages
5. CLOSE: Get them to agree to a FREE, NO-COMMITMENT site visit
6. Always end with a call-to-action

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
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config_1.default.ai.openaiApiKey}`,
            },
            body: JSON.stringify({
                model: config_1.default.ai.openaiModel,
                messages: allMessages,
                max_tokens: 1024,
                temperature: 0.7,
            }),
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenAI API error: ${response.status} ${error}`);
        }
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        return this.parseAIResponse(text);
    }
    buildChatCompletionsUrl(baseUrl) {
        const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
        return new URL('chat/completions', normalizedBaseUrl).toString();
    }
    /**
     * Smart mock response for testing without API keys.
     * Generates contextual responses based on the customer message.
     */
    mockResponse(request) {
        const msg = request.customerMessage.toLowerCase();
        const name = request.lead.customerName || 'there';
        const properties = request.properties.filter((p) => p.status === 'available').slice(0, 3);
        const company = request.companyName;
        let text;
        const isGreeting = /\b(hello|hey|namaste)\b/.test(msg) || /^hi\b/.test(msg) || msg === 'hi';
        if (isGreeting && !msg.includes('budget') && !msg.includes('visit') && !msg.includes('schedule') && !msg.includes('price')) {
            text = `*Namaste ${name}!* 🙏\n\nWelcome to ${company}! I'm your AI real estate assistant.\n\nI can help you find your dream property. Could you tell me:\n• Your *budget range*?\n• Preferred *location*?\n• Property type (apartment/villa/plot)?\n\nLet's find the perfect match for you! 🏡`;
        }
        else if (msg.includes('budget') || msg.includes('price') || msg.includes('lakh') || msg.includes('crore') || msg.includes('cost')) {
            const propList = properties.map((p) => `🏠 *${p.name}* - ${p.locationArea}, ${p.locationCity} | ₹${formatPrice(p.priceMin)}-${formatPrice(p.priceMax)}`).join('\n');
            text = `Great! Based on your interest, here are some options:\n\n${propList || 'We are updating our listings. Let me note your budget and get back to you!'}\n\nWould you like to *schedule a free site visit* for any of these? 📅`;
        }
        else if (msg.includes('visit') || msg.includes('see') || msg.includes('schedule') || msg.includes('appointment')) {
            text = `Wonderful! 🎉 I'd love to arrange a *FREE site visit* for you.\n\nPlease share:\n• Your *preferred date* (weekday/weekend)\n• *Time slot* (morning/afternoon/evening)\n\nOur team will confirm and send you the location details. No commitment required! 😊`;
        }
        else if (msg.includes('location') || msg.includes('area') || msg.includes('where')) {
            const locations = request.aiSettings?.operatingLocations || ['Major cities'];
            text = `We have premium properties across: *${Array.isArray(locations) ? locations.join(', ') : locations}*\n\nWhich area interests you most? I can show you the best options there! 📍`;
        }
        else {
            const propList = properties.slice(0, 2).map((p) => `🏠 *${p.name}* - ${p.locationArea} | ₹${formatPrice(p.priceMin)}-${formatPrice(p.priceMax)}`).join('\n');
            text = `Thank you for your message, ${name}! 😊\n\nHere are some featured properties:\n${propList || 'Our listings are being updated.'}\n\nTell me your preferences (budget, location, type) and I'll find the *perfect match* for you! 🏡\n\nOr would you like to schedule a *free site visit*?`;
        }
        return {
            text,
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
        return { text, detectedLanguage, extractedInfo };
    }
}
exports.AIService = AIService;
function formatPrice(value) {
    if (!value)
        return '0';
    if (value >= 10000000)
        return (value / 10000000).toFixed(1) + 'Cr';
    if (value >= 100000)
        return (value / 100000).toFixed(1) + 'L';
    if (value >= 1000)
        return (value / 1000).toFixed(1) + 'K';
    return value.toString();
}
exports.aiService = new AIService();
//# sourceMappingURL=ai.service.js.map