import config from '../config';
import logger from '../config/logger';

type AIProviderName = 'kimi' | 'openai' | 'claude';

interface AIRequest {
  customerMessage: string;
  conversationHistory: any[];
  lead: any;
  properties: any[];
  aiSettings: any;
  companyName: string;
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
   * Generate an AI response for a customer conversation.
   * Uses Kimi API as primary, with OpenAI and Claude fallbacks when configured.
   */
  async generateResponse(request: AIRequest): Promise<AIResponse> {
    const systemPrompt = this.buildSystemPrompt(request);
    const messages = this.buildMessages(request);
    const providers = this.getProviderOrder();
    let lastError: Error | null = null;

    for (const provider of providers) {
      if (!this.hasProviderCredentials(provider)) {
        continue;
      }

      try {
        return await this.callProvider(provider, systemPrompt, messages);
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn('AI provider failed', {
          provider,
          error: lastError.message,
        });
      }
    }

    if (lastError) {
      throw lastError;
    }

    logger.warn('No AI provider configured, using smart mock response');
    return this.mockResponse(request);
  }

  private getProviderOrder(): AIProviderName[] {
    const primaryProvider = (config.ai.provider || 'kimi').toLowerCase() as AIProviderName;
    const providers: AIProviderName[] = ['kimi', 'openai', 'claude'];

    return [primaryProvider, ...providers.filter((provider) => provider !== primaryProvider)];
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
        return `- ${p.name} | ${p.locationArea}, ${p.locationCity} | ₹${formatPrice(p.priceMin)}-${formatPrice(p.priceMax)} | ${p.bedrooms}BHK ${p.propertyType} | Amenities: ${amenities.join(', ')} | RERA: ${p.reraNumber || 'N/A'}`;
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

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.ai.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.openaiModel,
        messages: allMessages,
        max_tokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data = await response.json() as any;
    const text = data.choices?.[0]?.message?.content || '';

    return this.parseAIResponse(text);
  }

  private buildChatCompletionsUrl(baseUrl: string): string {
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    return new URL('chat/completions', normalizedBaseUrl).toString();
  }

  /**
   * Smart mock response for testing without API keys.
   * Generates contextual responses based on the customer message.
   */
  private mockResponse(request: AIRequest): AIResponse {
    const msg = request.customerMessage.toLowerCase();
    const name = request.lead.customerName || 'there';
    const properties = request.properties.filter((p: any) => p.status === 'available').slice(0, 3);
    const company = request.companyName;

    let text: string;

    const isGreeting = /\b(hello|hey|namaste)\b/.test(msg) || /^hi\b/.test(msg) || msg === 'hi';
    if (isGreeting && !msg.includes('budget') && !msg.includes('visit') && !msg.includes('schedule') && !msg.includes('price')) {
      text = `*Namaste ${name}!* 🙏\n\nWelcome to ${company}! I'm your AI real estate assistant.\n\nI can help you find your dream property. Could you tell me:\n• Your *budget range*?\n• Preferred *location*?\n• Property type (apartment/villa/plot)?\n\nLet's find the perfect match for you! 🏡`;
    } else if (msg.includes('budget') || msg.includes('price') || msg.includes('lakh') || msg.includes('crore') || msg.includes('cost')) {
      const propList = properties.map((p: any) => `🏠 *${p.name}* - ${p.locationArea}, ${p.locationCity} | ₹${formatPrice(p.priceMin)}-${formatPrice(p.priceMax)}`).join('\n');
      text = `Great! Based on your interest, here are some options:\n\n${propList || 'We are updating our listings. Let me note your budget and get back to you!'}\n\nWould you like to *schedule a free site visit* for any of these? 📅`;
    } else if (msg.includes('visit') || msg.includes('see') || msg.includes('schedule') || msg.includes('appointment')) {
      text = `Wonderful! 🎉 I'd love to arrange a *FREE site visit* for you.\n\nPlease share:\n• Your *preferred date* (weekday/weekend)\n• *Time slot* (morning/afternoon/evening)\n\nOur team will confirm and send you the location details. No commitment required! 😊`;
    } else if (msg.includes('location') || msg.includes('area') || msg.includes('where')) {
      const locations = request.aiSettings?.operatingLocations || ['Major cities'];
      text = `We have premium properties across: *${Array.isArray(locations) ? locations.join(', ') : locations}*\n\nWhich area interests you most? I can show you the best options there! 📍`;
    } else {
      const propList = properties.slice(0, 2).map((p: any) => `🏠 *${p.name}* - ${p.locationArea} | ₹${formatPrice(p.priceMin)}-${formatPrice(p.priceMax)}`).join('\n');
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

    return { text, detectedLanguage, extractedInfo };
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
