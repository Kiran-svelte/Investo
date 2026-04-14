/**
 * Conversation State Machine - Goal-Directed AI System
 *
 * This is NOT a generic chatbot. It's a sales funnel with clear stages:
 * rapport -> qualify -> shortlist -> objection_handling -> commitment -> visit_booking -> confirmation
 *
 * Each stage has:
 * - Entry conditions
 * - Required micro-commitments to collect
 * - Exit conditions to advance
 * - Objection playbooks
 * - Escalation triggers
 */
export type ConversationStage = 'rapport' | 'qualify' | 'shortlist' | 'objection_handling' | 'commitment' | 'visit_booking' | 'confirmation' | 'human_escalated' | 'closed_won' | 'closed_lost';
export type MessageIntent = 'on_path' | 'adjacent' | 'off_path' | 'objection' | 'commitment' | 'escalation_request';
export type ObjectionType = 'price_too_high' | 'need_family_discussion' | 'just_exploring' | 'send_details_only' | 'bad_location' | 'bad_timing' | 'competitor_preference' | 'trust_issue' | 'unknown';
export interface MicroCommitments {
    budgetConfirmed: boolean;
    locationConfirmed: boolean;
    propertyTypeConfirmed: boolean;
    timelineConfirmed: boolean;
    propertyInterestShown: boolean;
    visitSlotDiscussed: boolean;
    visitSlotConfirmed: boolean;
    contactInfoShared: boolean;
}
export interface ConversationState {
    stage: ConversationStage;
    previousStage: ConversationStage | null;
    stageEnteredAt: Date;
    messageCount: number;
    commitments: MicroCommitments;
    objectionCount: number;
    lastObjectionType: ObjectionType | null;
    consecutiveObjections: number;
    urgencyScore: number;
    valueScore: number;
    escalationReason: string | null;
    recommendedProperties: string[];
    selectedPropertyId: string | null;
    proposedVisitTime: Date | null;
}
export interface NextBestAction {
    action: 'continue' | 'advance_stage' | 'handle_objection' | 'bridge_back' | 'escalate' | 'close';
    targetStage?: ConversationStage;
    strategy?: string;
    objectionPlaybook?: ObjectionPlaybook;
    bridgeMessage?: string;
    escalationReason?: string;
    promptModifiers: string[];
}
export interface ObjectionPlaybook {
    objectionType: ObjectionType;
    strategies: string[];
    empathyFirst: string;
    reframe: string;
    bridgeToValue: string;
    fallbackOffer: string;
}
interface StageConfig {
    name: ConversationStage;
    goal: string;
    requiredCommitments: (keyof MicroCommitments)[];
    exitConditions: string[];
    maxMessages: number;
    promptFocus: string;
    successIndicators: string[];
    failureIndicators: string[];
}
export declare function classifyMessageIntent(message: string, currentStage: ConversationStage, context: {
    consecutiveObjections: number;
}): {
    intent: MessageIntent;
    objectionType?: ObjectionType;
    confidence: number;
};
export declare class PolicyBrain {
    /**
     * Decides the Next Best Action based on current state and message intent.
     * This is the "policy brain" that separates decision-making from language generation.
     */
    decideNextAction(state: ConversationState, messageIntent: MessageIntent, objectionType?: ObjectionType): NextBestAction;
    private shouldEscalate;
    private getEscalationReason;
    private canAdvanceStage;
    private getNextStage;
    private getBridgeMessage;
}
export declare class ConversationStateManager {
    private policyBrain;
    /**
     * Initialize state for a new conversation
     */
    createInitialState(): ConversationState;
    /**
     * Process an incoming message and return the next best action
     */
    processMessage(currentState: ConversationState, message: string, extractedInfo?: {
        budget_min?: number;
        budget_max?: number;
        location_preference?: string;
        property_type?: string;
    }): {
        newState: ConversationState;
        nextAction: NextBestAction;
    };
    private updateState;
    /**
     * Calculate urgency score based on various factors
     */
    calculateUrgencyScore(state: ConversationState, timeline?: string): number;
}
export declare const conversationStateManager: ConversationStateManager;
export declare const policyBrain: PolicyBrain;
export declare function getStageConfig(stage: ConversationStage): StageConfig;
export declare function getObjectionPlaybook(type: ObjectionType): ObjectionPlaybook;
export {};
//# sourceMappingURL=conversationStateMachine.d.ts.map