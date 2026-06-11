import type { EvalCase } from './evalTypes';
import {
  resolveCopilotInboundCommand,
  resolveStaffCopilotQuickActions,
  type CopilotReplyKind,
} from '../utils/copilotShortcut.util';
import { buildRoleBlockedIntentReply } from '../services/agent/agent-intent-orchestrator.service';

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
    }
  | {
      mode: 'viewer-read-only-intent';
      intent: 'update_lead_status';
    };

export type StaffCopilotExpected = {
  command?: string;
  buttonIds?: string[];
  noButtons?: boolean;
  replyContains?: string;
};

export type StaffCopilotActual = {
  command?: string;
  buttonIds?: string[];
  replyText?: string;
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
    description: 'Welcome/help replies get the base CRM shortcut menu (deterministic, no LLM).',
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
    id: 'staff-buttons-confirmation-suppressed',
    category: 'staff-copilot',
    description: 'Pending-confirmation turns should never emit shortcut buttons.',
    severity: 'high',
    input: {
      mode: 'quick-actions',
      replyKind: 'confirmation',
      outboundText: 'Reply "yes" to confirm or "no" to cancel.',
    },
    expected: { noButtons: true },
  },
  {
    id: 'staff-viewer-update-lead-read-only',
    category: 'staff-copilot',
    description: 'Viewer role attempting update_lead_status gets read-only notice before execution.',
    severity: 'high',
    input: { mode: 'viewer-read-only-intent', intent: 'update_lead_status' },
    expected: { replyContains: 'read-only' },
  },
];

/**
 * Evaluate a single staff copilot case.
 * Quick-actions evaluation is async because button resolution may call an LLM.
 * Inbound-command evaluation remains synchronous (deterministic mapping).
 *
 * @param input - The eval case input.
 * @returns Resolved actual output for comparison against expected.
 */
export async function evaluateStaffCopilot(input: StaffCopilotInput): Promise<StaffCopilotActual> {
  if (input.mode === 'inbound-command') {
    return {
      command: resolveCopilotInboundCommand({
        interactiveId: input.interactiveId,
        messageText: input.messageText,
      }),
    };
  }

  if (input.mode === 'viewer-read-only-intent') {
    return {
      replyText: buildRoleBlockedIntentReply('viewer', input.intent),
    };
  }

  const buttons = await resolveStaffCopilotQuickActions({
    replyKind: input.replyKind,
    outboundText: input.outboundText,
  });

  return {
    buttonIds: buttons?.map((button) => button.id) ?? [],
  };
}
