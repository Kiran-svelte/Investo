import { ConversationState, NextBestAction } from './conversationStateMachine';
interface AIRequest {
    customerMessage: string;
    conversationHistory: any[];
    lead: any;
    properties: any[];
    aiSettings: any;
    companyName: string;
    conversationState?: ConversationState;
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
    newState?: ConversationState;
    nextAction?: NextBestAction;
}
export declare class AIService {
    /**
     * Generate an AI response using the goal-directed state machine.
     *
     * DUAL BRAIN ARCHITECTURE:
     * 1. Policy Brain: Decides WHAT to do (stage transitions, objection handling, etc.)
     * 2. Language Brain (LLM): Generates HOW to say it (natural language)
     */
    generateResponse(request: AIRequest): Promise<AIResponse>;
    /**
     * Build a goal-directed prompt using Policy Brain decisions.
     * This is the LANGUAGE BRAIN - it crafts the actual message.
     */
    private buildGoalDirectedPrompt;
    private getProviderOrder;
    private hasProviderCredentials;
    private callProvider;
    /**
     * Build the system prompt that wires the AI exclusively for real estate.
     */
    private buildSystemPrompt;
    private buildMessages;
    /**
     * Call Claude API.
     */
    private callClaude;
    /**
     * Call Kimi API as the primary provider.
     */
    private callKimi;
    /**
     * Call OpenAI API as fallback.
     */
    private callOpenAI;
    private buildChatCompletionsUrl;
    /**
     * Smart mock response for testing without API keys.
     * Generates contextual responses based on the customer message.
     */
    private mockResponse;
    /**
     * Parse AI response and extract structured info.
     */
    private parseAIResponse;
}
export declare const aiService: AIService;
export {};
//# sourceMappingURL=ai.service.d.ts.map