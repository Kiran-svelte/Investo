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

import logger from '../config/logger';

// ─── Stage Definitions ─────────────────────────────────────────────────

export type ConversationStage = 
  | 'rapport'           // Initial greeting, build trust
  | 'qualify'           // Understand needs: budget, location, type, timeline
  | 'shortlist'         // Present 2-3 best matching properties
  | 'objection_handling'// Handle concerns: price, location, timing
  | 'commitment'        // Get verbal commitment to visit
  | 'visit_booking'     // Confirm date/time/property
  | 'confirmation'      // Final confirmation, set expectations
  | 'human_escalated'   // Handed off to human agent
  | 'closed_won'        // Visit booked successfully
  | 'closed_lost';      // Lead disqualified or lost

export type MessageIntent = 
  | 'on_path'           // Helps progress toward booking
  | 'adjacent'          // Related but not moving forward
  | 'off_path'          // Distraction, unrelated
  | 'objection'         // Explicit pushback
  | 'commitment'        // Positive signal
  | 'escalation_request'; // Wants human

export type ObjectionType =
  | 'price_too_high'
  | 'need_family_discussion'
  | 'just_exploring'
  | 'send_details_only'
  | 'bad_location'
  | 'bad_timing'
  | 'competitor_preference'
  | 'trust_issue'
  | 'unknown';

// ─── Micro-Commitments ─────────────────────────────────────────────────

export interface MicroCommitments {
  budgetConfirmed: boolean;
  locationConfirmed: boolean;
  propertyTypeConfirmed: boolean;
  timelineConfirmed: boolean;
  propertyInterestShown: boolean;  // Showed interest in specific property
  visitSlotDiscussed: boolean;
  visitSlotConfirmed: boolean;
  contactInfoShared: boolean;
}

// ─── Conversation State ────────────────────────────────────────────────

export interface ConversationState {
  stage: ConversationStage;
  previousStage: ConversationStage | null;
  stageEnteredAt: Date;
  messageCount: number;
  commitments: MicroCommitments;
  objectionCount: number;
  lastObjectionType: ObjectionType | null;
  consecutiveObjections: number;
  urgencyScore: number;          // 1-10, based on timeline + engagement
  valueScore: number;            // 1-10, based on budget + seriousness
  escalationReason: string | null;
  recommendedProperties: string[]; // Property IDs shown
  selectedPropertyId: string | null;
  proposedVisitTime: Date | null;
}

// ─── Policy Brain Output ───────────────────────────────────────────────

export interface NextBestAction {
  action: 'continue' | 'advance_stage' | 'handle_objection' | 'bridge_back' | 'escalate' | 'close';
  targetStage?: ConversationStage;
  strategy?: string;
  objectionPlaybook?: ObjectionPlaybook;
  bridgeMessage?: string;
  escalationReason?: string;
  promptModifiers: string[];  // Instructions to add to LLM prompt
}

export interface ObjectionPlaybook {
  objectionType: ObjectionType;
  strategies: string[];
  empathyFirst: string;
  reframe: string;
  bridgeToValue: string;
  fallbackOffer: string;
}

// ─── Stage Configuration ───────────────────────────────────────────────

interface StageConfig {
  name: ConversationStage;
  goal: string;
  requiredCommitments: (keyof MicroCommitments)[];
  exitConditions: string[];
  maxMessages: number;  // Auto-advance or escalate if exceeded
  promptFocus: string;
  successIndicators: string[];
  failureIndicators: string[];
}

const STAGE_CONFIG: Record<ConversationStage, StageConfig> = {
  rapport: {
    name: 'rapport',
    goal: 'Build trust and understand initial interest',
    requiredCommitments: [],
    exitConditions: ['Customer shares what they are looking for'],
    maxMessages: 4,
    promptFocus: 'Be warm, introduce yourself, ask ONE open question about their property search',
    successIndicators: ['shares requirement', 'asks question', 'shows interest'],
    failureIndicators: ['hostile', 'spam', 'wrong number'],
  },
  qualify: {
    name: 'qualify',
    goal: 'Collect budget, location, property type, timeline',
    requiredCommitments: ['budgetConfirmed', 'locationConfirmed', 'propertyTypeConfirmed'],
    exitConditions: ['3 of 4 key requirements confirmed'],
    maxMessages: 8,
    promptFocus: 'Ask natural questions to understand: budget range, preferred areas, property type (apartment/villa/plot), timeline. One topic per message.',
    successIndicators: ['shares budget', 'mentions area', 'specifies type', 'gives timeline'],
    failureIndicators: ['refuses to share', 'vague after 5+ messages'],
  },
  shortlist: {
    name: 'shortlist',
    goal: 'Present 2-3 best matching properties, get interest',
    requiredCommitments: ['propertyInterestShown'],
    exitConditions: ['Customer shows interest in at least one property'],
    maxMessages: 6,
    promptFocus: 'Present top 2-3 properties matching their criteria. Highlight VALUE (location advantages, price appreciation, amenities). Ask which one interests them most.',
    successIndicators: ['asks about property', 'wants more details', 'likes option'],
    failureIndicators: ['none match', 'not interested in any'],
  },
  objection_handling: {
    name: 'objection_handling',
    goal: 'Address concerns without being pushy',
    requiredCommitments: [],
    exitConditions: ['Objection resolved OR escalated'],
    maxMessages: 4,
    promptFocus: 'Empathize FIRST, then address the concern. Never dismiss. Offer alternatives or reframe value. Always end with soft next step.',
    successIndicators: ['concern addressed', 'willing to continue', 'asks new question'],
    failureIndicators: ['repeated same objection 3x', 'hostile', 'explicit no'],
  },
  commitment: {
    name: 'commitment',
    goal: 'Get verbal agreement to visit',
    requiredCommitments: ['visitSlotDiscussed'],
    exitConditions: ['Customer agrees to visit in principle'],
    maxMessages: 4,
    promptFocus: 'Ask for the visit commitment. Emphasize: FREE, NO OBLIGATION, just 30 mins to see in person. Offer specific time slots.',
    successIndicators: ['agrees to visit', 'asks about timing', 'wants to bring family'],
    failureIndicators: ['explicit no', 'maybe later (3x)', 'send details only'],
  },
  visit_booking: {
    name: 'visit_booking',
    goal: 'Confirm specific date, time, property',
    requiredCommitments: ['visitSlotConfirmed'],
    exitConditions: ['Date, time, and property confirmed'],
    maxMessages: 4,
    promptFocus: 'Lock in the specifics: Which day? Morning or afternoon? Which property first? Confirm address will be shared.',
    successIndicators: ['confirms date', 'confirms time', 'confirms property'],
    failureIndicators: ['keeps postponing', 'ghosts'],
  },
  confirmation: {
    name: 'confirmation',
    goal: 'Final confirmation, set expectations',
    requiredCommitments: [],
    exitConditions: ['Confirmation acknowledged'],
    maxMessages: 2,
    promptFocus: 'Summarize: property, date, time. Set expectation: agent will call 1 hour before. Thank them warmly.',
    successIndicators: ['acknowledges', 'thanks'],
    failureIndicators: [],
  },
  human_escalated: {
    name: 'human_escalated',
    goal: 'Human agent takes over',
    requiredCommitments: [],
    exitConditions: [],
    maxMessages: 0,
    promptFocus: 'Inform customer that a human specialist will continue. DO NOT try to handle further.',
    successIndicators: [],
    failureIndicators: [],
  },
  closed_won: {
    name: 'closed_won',
    goal: 'Visit successfully booked',
    requiredCommitments: [],
    exitConditions: [],
    maxMessages: 0,
    promptFocus: 'Conversation complete. Visit is booked.',
    successIndicators: [],
    failureIndicators: [],
  },
  closed_lost: {
    name: 'closed_lost',
    goal: 'Lead disqualified or lost',
    requiredCommitments: [],
    exitConditions: [],
    maxMessages: 0,
    promptFocus: 'Conversation ended. Lead did not convert.',
    successIndicators: [],
    failureIndicators: [],
  },
};

// ─── Objection Playbooks ───────────────────────────────────────────────

const OBJECTION_PLAYBOOKS: Record<ObjectionType, ObjectionPlaybook> = {
  price_too_high: {
    objectionType: 'price_too_high',
    strategies: ['show_value', 'offer_alternatives', 'emi_breakdown', 'appreciation_data'],
    empathyFirst: "I completely understand - budget is important and you want to make sure you're getting value for your investment.",
    reframe: "What many of our clients found is that the per-sqft price here is actually lower than comparable properties, plus the location premium will only increase.",
    bridgeToValue: "Would it help if I show you similar options in a slightly lower range, or break down the EMI to see monthly commitment?",
    fallbackOffer: "Let me check if there are any ongoing offers or payment plans that could help.",
  },
  need_family_discussion: {
    objectionType: 'need_family_discussion',
    strategies: ['include_family', 'offer_family_visit', 'send_info_pack'],
    empathyFirst: "That's absolutely the right approach - such an important decision should involve everyone.",
    reframe: "Many families actually prefer to visit together, so everyone can see the property and ask questions directly.",
    bridgeToValue: "Would it help if I send you a detailed info pack to share with your family, and we schedule a visit where everyone can come?",
    fallbackOffer: "When do you think you'd be able to discuss? I can call back or set up a convenient time.",
  },
  just_exploring: {
    objectionType: 'just_exploring',
    strategies: ['acknowledge_stage', 'offer_no_pressure_visit', 'position_as_research'],
    empathyFirst: "That's smart! Taking time to explore options is the best way to make a confident decision.",
    reframe: "Our site visits are actually designed for people in the research phase - no pressure, just information gathering.",
    bridgeToValue: "Since you're exploring, would a quick 20-minute visit help you understand the actual experience vs. just looking online?",
    fallbackOffer: "I can send you our comparison guide of properties in this area - it might help with your research.",
  },
  send_details_only: {
    objectionType: 'send_details_only',
    strategies: ['send_then_followup', 'highlight_visit_value', 'offer_virtual_tour'],
    empathyFirst: "Of course, I'll share all the details right away.",
    reframe: "Just so you know, photos don't capture the actual feeling of the space and the neighborhood vibe.",
    bridgeToValue: "I'll send the brochure now. Can I also schedule a quick visit for this weekend so you can experience it firsthand?",
    fallbackOffer: "Would a virtual tour video work as a first step?",
  },
  bad_location: {
    objectionType: 'bad_location',
    strategies: ['highlight_connectivity', 'show_alternatives', 'infrastructure_roadmap'],
    empathyFirst: "Location is definitely crucial - you want somewhere that fits your lifestyle.",
    reframe: "This area is actually developing rapidly. The new metro line opening next year will cut commute time significantly.",
    bridgeToValue: "Would you like to see properties closer to your preferred area, or would you be open to visiting this one to see the actual connectivity?",
    fallbackOffer: "Let me find options in your preferred area that match your other requirements.",
  },
  bad_timing: {
    objectionType: 'bad_timing',
    strategies: ['understand_timeline', 'offer_future_booking', 'market_timing_info'],
    empathyFirst: "I understand - timing has to be right for such a big decision.",
    reframe: "Interestingly, many of our clients started visiting 6-12 months before they planned to buy, just to understand the market.",
    bridgeToValue: "When are you thinking of making the move? I can keep you updated on new launches and offers closer to your timeline.",
    fallbackOffer: "Would it help if I add you to our early-access list for upcoming projects?",
  },
  competitor_preference: {
    objectionType: 'competitor_preference',
    strategies: ['acknowledge_competitor', 'differentiate', 'suggest_comparison'],
    empathyFirst: "It's good that you're comparing options - that's the best way to find the right fit.",
    reframe: "Each project has its strengths. We'd love for you to compare ours directly - many clients who visited both preferred our value proposition.",
    bridgeToValue: "Would you like to visit ours as well, so you can make a direct comparison?",
    fallbackOffer: "What specifically do you like about the other project? I might be able to match or better it.",
  },
  trust_issue: {
    objectionType: 'trust_issue',
    strategies: ['share_credentials', 'offer_references', 'rera_verification'],
    empathyFirst: "Trust is absolutely essential when making such a significant investment. I appreciate your caution.",
    reframe: "We're RERA registered, and I can share references from existing homeowners if that would help.",
    bridgeToValue: "Would you like me to share our RERA number for verification, or connect you with a current resident?",
    fallbackOffer: "I can arrange a visit where you meet our project manager and see the construction quality firsthand.",
  },
  unknown: {
    objectionType: 'unknown',
    strategies: ['probe_deeper', 'offer_general_help'],
    empathyFirst: "I want to make sure I understand your concern correctly.",
    reframe: "Could you tell me more about what's holding you back? I want to help address it.",
    bridgeToValue: "What would need to be true for you to feel comfortable taking the next step?",
    fallbackOffer: "If there's anything specific I can help clarify, please let me know.",
  },
};

// ─── Intent Classification ─────────────────────────────────────────────

export function classifyMessageIntent(
  message: string,
  currentStage: ConversationStage,
  context: { consecutiveObjections: number }
): { intent: MessageIntent; objectionType?: ObjectionType; confidence: number } {
  const lowerMessage = message.toLowerCase();
  
  // Check for escalation request
  if (
    lowerMessage.includes('talk to human') ||
    lowerMessage.includes('real person') ||
    lowerMessage.includes('manager') ||
    lowerMessage.includes('supervisor') ||
    lowerMessage.includes('speak to someone')
  ) {
    return { intent: 'escalation_request', confidence: 0.95 };
  }

  // Check for commitment signals
  const commitmentPatterns = [
    /yes|ok|sure|fine|alright|let'?s do it|i'?m interested|book|schedule|when can/i,
    /this weekend|tomorrow|saturday|sunday|morning|afternoon|evening/i,
    /i'?ll come|we'?ll visit|can visit/i,
  ];
  for (const pattern of commitmentPatterns) {
    if (pattern.test(message)) {
      return { intent: 'commitment', confidence: 0.8 };
    }
  }

  // Check for objections
  const objectionPatterns: Array<{ pattern: RegExp; type: ObjectionType }> = [
    { pattern: /too expensive|can'?t afford|out of budget|costly|high price/i, type: 'price_too_high' },
    { pattern: /family|spouse|wife|husband|parents|discuss with/i, type: 'need_family_discussion' },
    { pattern: /just looking|exploring|browsing|not sure|researching|checking/i, type: 'just_exploring' },
    { pattern: /send.*(details|brochure|info)|whatsapp.*(details|info)|email.*details/i, type: 'send_details_only' },
    { pattern: /too far|location.*(bad|not good)|commute|traffic/i, type: 'bad_location' },
    { pattern: /not now|later|next year|few months|not ready/i, type: 'bad_timing' },
    { pattern: /other (project|builder|property)|competitor|comparing/i, type: 'competitor_preference' },
    { pattern: /trust|fraud|scam|genuine|real|authentic/i, type: 'trust_issue' },
  ];
  for (const { pattern, type } of objectionPatterns) {
    if (pattern.test(message)) {
      return { intent: 'objection', objectionType: type, confidence: 0.85 };
    }
  }

  // Check for on-path signals based on stage
  const stageConfig = STAGE_CONFIG[currentStage];
  for (const indicator of stageConfig.successIndicators) {
    if (lowerMessage.includes(indicator)) {
      return { intent: 'on_path', confidence: 0.75 };
    }
  }

  // Check for off-path (distraction)
  const offPathPatterns = [
    /weather|cricket|movie|politics|news|joke/i,
    /how are you|what'?s up|hello+|hi+$/i,
  ];
  for (const pattern of offPathPatterns) {
    if (pattern.test(message) && message.length < 30) {
      return { intent: 'off_path', confidence: 0.7 };
    }
  }

  // Check for adjacent (related but not moving)
  const adjacentPatterns = [
    /tell me more|what about|how is|which is better/i,
    /amenities|facilities|parking|gym|pool|school|hospital/i,
  ];
  for (const pattern of adjacentPatterns) {
    if (pattern.test(message)) {
      return { intent: 'adjacent', confidence: 0.7 };
    }
  }

  // Default: assume on-path if nothing else matches
  return { intent: 'on_path', confidence: 0.5 };
}

// ─── Policy Brain ──────────────────────────────────────────────────────

export class PolicyBrain {
  /**
   * Decides the Next Best Action based on current state and message intent.
   * This is the "policy brain" that separates decision-making from language generation.
   */
  decideNextAction(
    state: ConversationState,
    messageIntent: MessageIntent,
    objectionType?: ObjectionType
  ): NextBestAction {
    const stageConfig = STAGE_CONFIG[state.stage];

    // 1. Check for escalation triggers
    if (this.shouldEscalate(state, messageIntent)) {
      return {
        action: 'escalate',
        targetStage: 'human_escalated',
        escalationReason: this.getEscalationReason(state, messageIntent),
        promptModifiers: [
          'ESCALATION: Inform customer that a specialist will take over.',
          'DO NOT try to handle further. Be warm and reassuring.',
        ],
      };
    }

    // 2. Handle explicit escalation request
    if (messageIntent === 'escalation_request') {
      return {
        action: 'escalate',
        targetStage: 'human_escalated',
        escalationReason: 'Customer requested human agent',
        promptModifiers: [
          'Customer wants to speak with a human.',
          'Acknowledge warmly, assure them a specialist will call within 10 minutes.',
        ],
      };
    }

    // 3. Handle objection
    if (messageIntent === 'objection' && objectionType) {
      const playbook = OBJECTION_PLAYBOOKS[objectionType];
      return {
        action: 'handle_objection',
        objectionPlaybook: playbook,
        promptModifiers: [
          `OBJECTION DETECTED: ${objectionType}`,
          `EMPATHY FIRST: ${playbook.empathyFirst}`,
          `REFRAME: ${playbook.reframe}`,
          `BRIDGE: ${playbook.bridgeToValue}`,
          'After addressing, try to gently move back toward the visit.',
        ],
      };
    }

    // 4. Handle off-path (distraction)
    if (messageIntent === 'off_path') {
      return {
        action: 'bridge_back',
        bridgeMessage: this.getBridgeMessage(state),
        promptModifiers: [
          'Customer sent off-topic message.',
          'Acknowledge briefly (1 sentence max), then BRIDGE BACK to property discussion.',
          `Current focus: ${stageConfig.promptFocus}`,
        ],
      };
    }

    // 5. Handle adjacent (related but not advancing)
    if (messageIntent === 'adjacent') {
      return {
        action: 'continue',
        promptModifiers: [
          'Customer asking related question.',
          'Answer helpfully but ALWAYS end with a question that advances toward booking.',
          `Stage goal: ${stageConfig.goal}`,
        ],
      };
    }

    // 6. Check if ready to advance stage
    if (this.canAdvanceStage(state)) {
      const nextStage = this.getNextStage(state.stage);
      if (nextStage) {
        return {
          action: 'advance_stage',
          targetStage: nextStage,
          promptModifiers: [
            `ADVANCING to ${nextStage} stage.`,
            `New goal: ${STAGE_CONFIG[nextStage].goal}`,
            `Focus: ${STAGE_CONFIG[nextStage].promptFocus}`,
          ],
        };
      }
    }

    // 7. Check for commitment signal leading to visit booking
    if (messageIntent === 'commitment' && state.stage === 'commitment') {
      return {
        action: 'advance_stage',
        targetStage: 'visit_booking',
        promptModifiers: [
          'COMMITMENT RECEIVED! Move to booking specifics.',
          'Lock in: date, time, property.',
          'Be enthusiastic but not over the top.',
        ],
      };
    }

    // 8. Default: continue in current stage
    return {
      action: 'continue',
      promptModifiers: [
        `Continue in ${state.stage} stage.`,
        `Goal: ${stageConfig.goal}`,
        `Focus: ${stageConfig.promptFocus}`,
        `Messages in stage: ${state.messageCount}/${stageConfig.maxMessages}`,
      ],
    };
  }

  private shouldEscalate(state: ConversationState, intent: MessageIntent): boolean {
    // High-value lead + repeated objections
    if (state.valueScore >= 7 && state.consecutiveObjections >= 3) {
      return true;
    }

    // Too many messages in objection handling
    if (state.stage === 'objection_handling' && state.messageCount > 6) {
      return true;
    }

    // Explicit no after commitment stage
    if (state.stage === 'commitment' && state.consecutiveObjections >= 2) {
      return true;
    }

    return false;
  }

  private getEscalationReason(state: ConversationState, intent: MessageIntent): string {
    if (state.valueScore >= 7 && state.consecutiveObjections >= 3) {
      return 'High-value lead with repeated objections';
    }
    if (state.stage === 'objection_handling' && state.messageCount > 6) {
      return 'Extended objection handling without resolution';
    }
    if (intent === 'escalation_request') {
      return 'Customer requested human agent';
    }
    return 'Escalation triggered by policy rules';
  }

  private canAdvanceStage(state: ConversationState): boolean {
    const stageConfig = STAGE_CONFIG[state.stage];
    
    // Check if required commitments are met
    const requiredMet = stageConfig.requiredCommitments.every(
      (c) => state.commitments[c]
    );

    return requiredMet;
  }

  private getNextStage(currentStage: ConversationStage): ConversationStage | null {
    const progression: Record<ConversationStage, ConversationStage | null> = {
      rapport: 'qualify',
      qualify: 'shortlist',
      shortlist: 'commitment',  // Skip objection_handling unless objection detected
      objection_handling: 'commitment',
      commitment: 'visit_booking',
      visit_booking: 'confirmation',
      confirmation: 'closed_won',
      human_escalated: null,
      closed_won: null,
      closed_lost: null,
    };
    return progression[currentStage];
  }

  private getBridgeMessage(state: ConversationState): string {
    const bridges: Record<ConversationStage, string> = {
      rapport: "By the way, what kind of property are you looking for?",
      qualify: "Coming back to your property search - have you finalized a budget range?",
      shortlist: "Let me show you the properties that match your requirements.",
      objection_handling: "I understand your concern. What would help address it?",
      commitment: "Would you like to visit this weekend to see the property in person?",
      visit_booking: "What time works best for you to visit?",
      confirmation: "Just to confirm - we're set for the visit, right?",
      human_escalated: "A specialist will be with you shortly.",
      closed_won: "Thank you for booking the visit!",
      closed_lost: "Thank you for your time.",
    };
    return bridges[state.stage];
  }
}

// ─── State Manager ─────────────────────────────────────────────────────

export class ConversationStateManager {
  private policyBrain = new PolicyBrain();

  /**
   * Initialize state for a new conversation
   */
  createInitialState(): ConversationState {
    return {
      stage: 'rapport',
      previousStage: null,
      stageEnteredAt: new Date(),
      messageCount: 0,
      commitments: {
        budgetConfirmed: false,
        locationConfirmed: false,
        propertyTypeConfirmed: false,
        timelineConfirmed: false,
        propertyInterestShown: false,
        visitSlotDiscussed: false,
        visitSlotConfirmed: false,
        contactInfoShared: false,
      },
      objectionCount: 0,
      lastObjectionType: null,
      consecutiveObjections: 0,
      urgencyScore: 5,
      valueScore: 5,
      escalationReason: null,
      recommendedProperties: [],
      selectedPropertyId: null,
      proposedVisitTime: null,
    };
  }

  /**
   * Process an incoming message and return the next best action
   */
  processMessage(
    currentState: ConversationState,
    message: string,
    extractedInfo?: {
      budget_min?: number;
      budget_max?: number;
      location_preference?: string;
      property_type?: string;
    }
  ): { newState: ConversationState; nextAction: NextBestAction } {
    // Classify the message intent
    const { intent, objectionType, confidence } = classifyMessageIntent(
      message,
      currentState.stage,
      { consecutiveObjections: currentState.consecutiveObjections }
    );

    logger.info('Message classified', {
      intent,
      objectionType,
      confidence,
      stage: currentState.stage,
    });

    // Update state based on intent
    const newState = this.updateState(currentState, intent, objectionType, extractedInfo);

    // Get next action from policy brain
    const nextAction = this.policyBrain.decideNextAction(newState, intent, objectionType);

    // Apply stage transition if needed
    if (nextAction.action === 'advance_stage' && nextAction.targetStage) {
      newState.previousStage = newState.stage;
      newState.stage = nextAction.targetStage;
      newState.stageEnteredAt = new Date();
      newState.messageCount = 0;
    }

    if (nextAction.action === 'escalate' && nextAction.targetStage) {
      newState.previousStage = newState.stage;
      newState.stage = nextAction.targetStage;
      newState.escalationReason = nextAction.escalationReason || null;
    }

    return { newState, nextAction };
  }

  private updateState(
    state: ConversationState,
    intent: MessageIntent,
    objectionType?: ObjectionType,
    extractedInfo?: {
      budget_min?: number;
      budget_max?: number;
      location_preference?: string;
      property_type?: string;
    }
  ): ConversationState {
    const newState = { ...state, commitments: { ...state.commitments } };
    newState.messageCount++;

    // Update objection tracking
    if (intent === 'objection') {
      newState.objectionCount++;
      newState.consecutiveObjections++;
      newState.lastObjectionType = objectionType || null;
    } else {
      newState.consecutiveObjections = 0;
    }

    // Update commitment signals
    if (intent === 'commitment') {
      if (state.stage === 'commitment') {
        newState.commitments.visitSlotDiscussed = true;
      }
      if (state.stage === 'visit_booking') {
        newState.commitments.visitSlotConfirmed = true;
      }
    }

    // Update from extracted info
    if (extractedInfo) {
      if (extractedInfo.budget_min || extractedInfo.budget_max) {
        newState.commitments.budgetConfirmed = true;
        // Update value score based on budget
        if (extractedInfo.budget_max && extractedInfo.budget_max > 10000000) {
          newState.valueScore = Math.min(10, newState.valueScore + 2);
        }
      }
      if (extractedInfo.location_preference) {
        newState.commitments.locationConfirmed = true;
      }
      if (extractedInfo.property_type) {
        newState.commitments.propertyTypeConfirmed = true;
      }
    }

    return newState;
  }

  /**
   * Calculate urgency score based on various factors
   */
  calculateUrgencyScore(state: ConversationState, timeline?: string): number {
    let score = 5;

    // Timeline mentions
    if (timeline) {
      const lowerTimeline = timeline.toLowerCase();
      if (lowerTimeline.includes('immediate') || lowerTimeline.includes('asap') || lowerTimeline.includes('this month')) {
        score += 3;
      } else if (lowerTimeline.includes('next month') || lowerTimeline.includes('soon')) {
        score += 2;
      } else if (lowerTimeline.includes('year') || lowerTimeline.includes('exploring')) {
        score -= 2;
      }
    }

    // High engagement
    if (state.commitments.propertyInterestShown) score += 1;
    if (state.commitments.visitSlotDiscussed) score += 2;

    return Math.max(1, Math.min(10, score));
  }
}

// ─── Export singleton ──────────────────────────────────────────────────

export const conversationStateManager = new ConversationStateManager();
export const policyBrain = new PolicyBrain();

export function getStageConfig(stage: ConversationStage): StageConfig {
  return STAGE_CONFIG[stage];
}

export function getObjectionPlaybook(type: ObjectionType): ObjectionPlaybook {
  return OBJECTION_PLAYBOOKS[type];
}
