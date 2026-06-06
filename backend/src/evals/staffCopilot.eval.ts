import type { EvalCase } from './evalTypes';
import {
  resolveCopilotInboundCommand,
  resolveStaffCopilotQuickActions,
  type CopilotReplyKind,
} from '../utils/copilotShortcut.util';

export type StaffCopilotInput =
  | {
      mode: 'inbound-command';
      interactiveId?: string;
      messageText?: string;
    }
  | {
      mode: 'quick-actions';
      replyKind: CopilotReplyKind;
      outboundText: string;
    };

export type StaffCopilotExpected = {
  command?: string;
  buttonIds?: string[];
  noButtons?: boolean;
};

export type StaffCopilotActual = {
  command?: string;
  buttonIds?: string[];
};

export const staffCopilotEvalCases: Array<EvalCase<StaffCopilotInput, StaffCopilotExpected>> = [
  {
    id: 'staff-command-visits-today-button',
    category: 'staff-copilot',
    description: 'Stable button ID maps to canonical CRM command.',
    severity: 'high',
    input: { mode: 'inbound-command', interactiveId: 'copilot-visits-today' },
    expected: { command: 'visits today' },
  },
  {
    id: 'staff-command-title-fallback',
    category: 'staff-copilot',
    description: 'Visible button title fallback maps to canonical CRM command.',
    severity: 'medium',
    input: { mode: 'inbound-command', messageText: 'New leads today' },
    expected: { command: 'new leads today' },
  },
  {
    id: 'staff-buttons-welcome',
    category: 'staff-copilot',
    description: 'Welcome/help replies get the base CRM shortcut menu.',
    severity: 'medium',
    input: {
      mode: 'quick-actions',
      replyKind: 'welcome',
      outboundText: 'Investo Copilot. How can I help?',
    },
    expected: {
      buttonIds: ['copilot-visits-today', 'copilot-new-leads', 'copilot-visits-tomorrow'],
    },
  },
  {
    id: 'staff-buttons-after-success-suppressed',
    category: 'staff-copilot',
    description: 'Successful workflow mutation should not get repeated shortcut spam.',
    severity: 'high',
    input: {
      mode: 'quick-actions',
      replyKind: 'workflow',
      outboundText: 'Lead Scenario Buyer status updated to visited.',
    },
    expected: { noButtons: true },
  },
  {
    id: 'staff-buttons-visit-choice',
    category: 'staff-copilot',
    description: 'Visit ambiguity prompts get visit-specific actions.',
    severity: 'medium',
    input: {
      mode: 'quick-actions',
      replyKind: 'workflow',
      outboundText: 'Which visit should I update?',
    },
    expected: {
      buttonIds: ['copilot-confirm-visit', 'copilot-reschedule-visit', 'copilot-complete-visit'],
    },
  },
];

export function evaluateStaffCopilot(input: StaffCopilotInput): StaffCopilotActual {
  if (input.mode === 'inbound-command') {
    return {
      command: resolveCopilotInboundCommand({
        interactiveId: input.interactiveId,
        messageText: input.messageText,
      }),
    };
  }

  const buttons = resolveStaffCopilotQuickActions({
    replyKind: input.replyKind,
    outboundText: input.outboundText,
  });

  return {
    buttonIds: buttons?.map((button) => button.id) ?? [],
  };
}
