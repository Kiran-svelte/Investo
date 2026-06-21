/**
 * Zero-UI copy compliance: supported WhatsApp actions must not dead-end to the web dashboard.
 */
import { buildRoleBlockedIntentReply } from '../../services/agent/agent-intent-orchestrator.service';
import { containsStaffOnlyBuyerCopy, sanitizeStaffInstructionsForBuyer } from '../../utils/buyerStaffCopyGuard.util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FORBIDDEN_DASHBOARD_RE = /\b(use|open) the investo dashboard\b/i;

const STAFF_COPILOT_SOURCES = [
  'services/agent/agent-router.service.ts',
  'services/agent/agent-intent-orchestrator.service.ts',
  'services/agent/agent-crm-query.service.ts',
  'services/agent/tools/lead-tools.ts',
  'services/agent/tools/brochure-tools.ts',
  'services/agent/staffShiftBriefing.service.ts',
];

const BUYER_OUTBOUND_SOURCES = [
  'utils/buyerI18n.util.ts',
  'utils/safeBuyerFallback.util.ts',
  'services/buyer/postVisitFeedback.service.ts',
];

function readSrc(relPath: string): string {
  return readFileSync(join(__dirname, '..', '..', relPath), 'utf8');
}

describe('zero-ui copy compliance', () => {
  test('buyerStaffCopyGuard strips dashboard instructions from LLM leakage', () => {
    const dirty = 'Please upload one in the Investo dashboard and then I can send it to the customer.';
    expect(containsStaffOnlyBuyerCopy(dirty)).toBe(true);
    expect(sanitizeStaffInstructionsForBuyer(dirty)).not.toMatch(FORBIDDEN_DASHBOARD_RE);
  });

  test('role-blocked staff replies do not mention dashboard', () => {
    expect(buildRoleBlockedIntentReply('viewer', 'update_lead_status')).not.toMatch(FORBIDDEN_DASHBOARD_RE);
    expect(buildRoleBlockedIntentReply('agent', 'update_lead_status')).not.toMatch(FORBIDDEN_DASHBOARD_RE);
  });

  test('staff copilot hot paths contain no dashboard dead-ends', () => {
    for (const rel of STAFF_COPILOT_SOURCES) {
      const src = readSrc(rel);
      expect(src).not.toMatch(FORBIDDEN_DASHBOARD_RE);
    }
  });

  test('buyer outbound copy sources contain no dashboard references', () => {
    for (const rel of BUYER_OUTBOUND_SOURCES) {
      const src = readSrc(rel);
      expect(src).not.toMatch(/investo dashboard/i);
    }
  });
});
