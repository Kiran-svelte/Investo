import type { EvalCase } from './evalTypes';
import { resolveBuyerComponents } from '../services/buyer/buyerButtonPolicy.service';

export type ButtonPolicyInput = Parameters<typeof resolveBuyerComponents>[0];

export type ButtonPolicyExpected = {
  buttonIds?: string[];
  noButtons?: boolean;
  forbiddenButtonIds?: string[];
};

export type ButtonPolicyActual = {
  buttonIds: string[];
};

export const buttonPolicyEvalCases: Array<EvalCase<ButtonPolicyInput, ButtonPolicyExpected>> = [
  {
    id: 'buttons-new-buyer-rapport',
    category: 'button-policy',
    description: 'New buyer greeting can get property filter buttons.',
    severity: 'medium',
    input: {
      stage: 'rapport',
      outboundText: 'Hello! Welcome to Palm Realty.',
    },
    expected: {
      buttonIds: ['filter-apartment', 'filter-villa', 'call-me'],
    },
  },
  {
    id: 'buttons-returning-greeting-suppressed',
    category: 'button-policy',
    description: 'Returning buyer greeting must not get noisy repeated buttons.',
    severity: 'high',
    input: {
      stage: 'rapport',
      outboundText: 'Welcome back! Still looking at Whitefield, or something new?',
      isReturningGreeting: true,
    },
    expected: {
      noButtons: true,
    },
  },
  {
    id: 'buttons-confirm-prompt-suppressed',
    category: 'button-policy',
    description: 'Hard confirmation prompts should not attach unrelated quick replies.',
    severity: 'high',
    input: {
      stage: 'visit_booking',
      outboundText: 'Just to confirm, would you like to book for Saturday 4pm?',
    },
    expected: {
      noButtons: true,
    },
  },
  {
    id: 'buttons-active-visit-management',
    category: 'button-policy',
    description: 'Active visit should show visit-management actions, not Book Visit again.',
    severity: 'critical',
    input: {
      stage: 'confirmation',
      outboundText: 'Your visit for Lake Vista is scheduled tomorrow at 4pm.',
      hasActiveVisit: true,
      visitStatus: 'scheduled',
      propertyId: 'property-1',
      visitProperty: 'Lake Vista',
    },
    expected: {
      buttonIds: ['visit-confirm', 'visit-reschedule', 'call-me'],
      forbiddenButtonIds: ['book-visit', 'book-visit-property-1'],
    },
  },
  {
    id: 'buttons-after-completed-action-suppressed',
    category: 'button-policy',
    description: 'Completed mutation replies should not be followed by shortcut noise.',
    severity: 'high',
    input: {
      stage: 'confirmation',
      outboundText: 'Your visit has been rescheduled successfully.',
      recentAction: 'rescheduled',
    },
    expected: {
      noButtons: true,
    },
  },
  {
    id: 'buttons-post-visit-no-book-visit',
    category: 'button-policy',
    description: 'Post-visit buyers get feedback/agent/options buttons, not Book Free Visit.',
    severity: 'high',
    input: {
      stage: 'rapport',
      outboundText: 'How did you find the property after your visit?',
      hasCompletedVisit: true,
    },
    expected: {
      buttonIds: ['share-visit-feedback', 'call-me', 'filter-apartment'],
      forbiddenButtonIds: ['book-visit'],
    },
  },
];

export function evaluateButtonPolicy(input: ButtonPolicyInput): ButtonPolicyActual {
  const components = resolveBuyerComponents(input);
  const buttons = components.flatMap((component) =>
    component.kind === 'buttons' ? component.buttons : [],
  );
  return { buttonIds: buttons.map((button) => button.id) };
}
