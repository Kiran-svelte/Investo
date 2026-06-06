import type { EvalCase } from './evalTypes';
import { isBuyerRapportMessage } from '../services/buyerQualification.service';
import { isBuyerMemoryRecallQuery } from '../services/buyerMemoryRecall.service';
import { isBuyerQualificationStatement } from '../services/buyerQualification.service';
import { isBuyerVisitStatusQuery } from '../services/buyerVisitQuery.service';
import {
  isVisitCancelOrRescheduleMessage,
  isVisitSchedulingMessage,
} from '../services/visitIntentFromMessage.service';

export type BuyerRoute =
  | 'rapport'
  | 'memory_recall'
  | 'qualification'
  | 'visit_status'
  | 'visit_schedule'
  | 'visit_mutation'
  | 'property_query'
  | 'unknown';

export type BuyerRoutingInput = {
  message: string;
  hasPriorOutbound?: boolean;
};

export type BuyerRoutingExpected = {
  route: BuyerRoute;
};

export const buyerRoutingEvalCases: Array<EvalCase<BuyerRoutingInput, BuyerRoutingExpected>> = [
  {
    id: 'buyer-route-new-greeting',
    category: 'buyer-routing',
    description: 'New buyer greeting stays in rapport fast path.',
    severity: 'medium',
    input: { message: 'Hi', hasPriorOutbound: false },
    expected: { route: 'rapport' },
  },
  {
    id: 'buyer-route-returning-greeting',
    category: 'buyer-routing',
    description: 'Returning buyer greeting is still rapport, but downstream reply must be short/no buttons.',
    severity: 'medium',
    input: { message: 'hello', hasPriorOutbound: true },
    expected: { route: 'rapport' },
  },
  {
    id: 'buyer-route-qualification',
    category: 'buyer-routing',
    description: 'Budget/location/BHK statement is saved as qualification, not treated as generic AI.',
    severity: 'high',
    input: { message: 'Need 3 BHK in Whitefield under 1.5 crore' },
    expected: { route: 'qualification' },
  },
  {
    id: 'buyer-route-memory-recall',
    category: 'buyer-routing',
    description: 'Buyer can ask what Investo remembers about their preferences.',
    severity: 'medium',
    input: { message: "What's my budget preference?" },
    expected: { route: 'memory_recall' },
  },
  {
    id: 'buyer-route-visit-status',
    category: 'buyer-routing',
    description: 'Visit status queries must not become mutation workflows.',
    severity: 'critical',
    input: { message: 'Any visits booked for me today?' },
    expected: { route: 'visit_status' },
  },
  {
    id: 'buyer-route-schedule-visit',
    category: 'buyer-routing',
    description: 'Concrete booking request is visit scheduling.',
    severity: 'critical',
    input: { message: 'Book Lake Vista site visit tomorrow at 4pm' },
    expected: { route: 'visit_schedule' },
  },
  {
    id: 'buyer-route-reschedule-visit',
    category: 'buyer-routing',
    description: 'Move/change visit request is visit mutation.',
    severity: 'critical',
    input: { message: 'Move my site visit to Friday 11am' },
    expected: { route: 'visit_mutation' },
  },
  {
    id: 'buyer-route-cancel-visit',
    category: 'buyer-routing',
    description: 'Cancel visit request is a mutation, never a status query.',
    severity: 'critical',
    input: { message: 'Cancel my site visit for Lake Vista' },
    expected: { route: 'visit_mutation' },
  },
  {
    id: 'buyer-route-price-query',
    category: 'buyer-routing',
    description: 'Price/property questions fall through to workflow/property query.',
    severity: 'high',
    input: { message: 'What is the price for 3 BHK at Lake Vista?' },
    expected: { route: 'property_query' },
  },
];

export function classifyBuyerRoute(input: BuyerRoutingInput): BuyerRoute {
  const message = input.message.trim();
  if (!message) return 'unknown';

  if (isBuyerRapportMessage(message, { hasPriorOutbound: Boolean(input.hasPriorOutbound) })) {
    return 'rapport';
  }

  if (isBuyerMemoryRecallQuery(message)) return 'memory_recall';
  if (isBuyerQualificationStatement(message)) return 'qualification';

  if (isVisitCancelOrRescheduleMessage(message)) return 'visit_mutation';

  const explicitScheduleIntent =
    /\b(book|schedule|arrange|fix)\b[\s\S]{0,80}\b(visit|site\s*visit|appointment)\b/i.test(message) ||
    /\b(visit|site\s*visit|appointment)\b[\s\S]{0,80}\b(book|schedule|arrange|fix)\b/i.test(message);
  if (explicitScheduleIntent && isVisitSchedulingMessage(message)) return 'visit_schedule';

  if (isBuyerVisitStatusQuery(message)) return 'visit_status';
  if (isVisitSchedulingMessage(message)) return 'visit_schedule';

  if (/\b(price|cost|brochure|pdf|amenities|available|availability|project|property|bhk)\b/i.test(message)) {
    return 'property_query';
  }

  return 'unknown';
}
