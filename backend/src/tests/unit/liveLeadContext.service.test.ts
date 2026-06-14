jest.mock('../../config/prisma', () => ({
  __esModule: true,
  default: {
    lead: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
    property: { findUnique: jest.fn() },
  },
}));

jest.mock('../../services/visitPendingApproval.service', () => ({
  findPendingVisitApprovalForLead: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../services/callRequest.service', () => ({
  findActiveCallRequest: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import prisma from '../../config/prisma';
import config from '../../config';
import {
  getLiveLeadContext,
  selectPrimaryVisit,
  type ActiveVisitContext,
} from '../../services/liveLeadContext.service';
import { findPendingVisitApprovalForLead } from '../../services/visitPendingApproval.service';

const leadId = 'lead-1';
const companyId = 'company-1';

function visitRow(overrides: Partial<{
  id: string;
  status: string;
  scheduledAt: Date;
  propertyName: string;
  propertyId: string;
  projectId: string;
}> = {}) {
  return {
    id: overrides.id ?? 'visit-1',
    status: overrides.status ?? 'scheduled',
    scheduledAt: overrides.scheduledAt ?? new Date('2026-06-14T10:30:00.000Z'),
    propertyId: overrides.propertyId ?? 'prop-1',
    notes: null,
    property: {
      id: overrides.propertyId ?? 'prop-1',
      name: overrides.propertyName ?? 'Sunset Heights 1102',
      projectId: overrides.projectId ?? 'proj-1',
    },
    agent: null,
  };
}

describe('liveLeadContext.service', () => {
  const originalMultiVisit = config.features.multiVisitContext;

  beforeEach(() => {
    jest.clearAllMocks();
    config.features.multiVisitContext = originalMultiVisit;
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    config.features.multiVisitContext = originalMultiVisit;
  });

  describe('selectPrimaryVisit', () => {
    test('returns null for empty array', () => {
      expect(selectPrimaryVisit([])).toBeNull();
    });

    test('confirmed beats scheduled at same scheduledAt', () => {
      const at = new Date('2026-06-14T10:30:00.000Z');
      const scheduled: ActiveVisitContext = {
        visitId: 'v-scheduled',
        propertyId: 'p1',
        propertyName: 'Lake Vista',
        projectId: 'proj-b',
        status: 'scheduled',
        scheduledAt: at,
        agentName: null,
        agentPhone: null,
        notes: null,
      };
      const confirmed: ActiveVisitContext = {
        ...scheduled,
        visitId: 'v-confirmed',
        propertyName: 'Sunset Heights',
        status: 'confirmed',
      };
      const primary = selectPrimaryVisit([scheduled, confirmed]);
      expect(primary?.visitId).toBe('v-confirmed');
    });

    test('confirmed beats scheduled on same day within 4 hours', () => {
      const scheduled: ActiveVisitContext = {
        visitId: 'v-scheduled',
        propertyId: 'p1',
        propertyName: 'Lake Vista',
        projectId: 'proj-b',
        status: 'scheduled',
        scheduledAt: new Date('2026-06-14T10:30:00.000Z'),
        agentName: null,
        agentPhone: null,
        notes: null,
      };
      const confirmed: ActiveVisitContext = {
        ...scheduled,
        visitId: 'v-confirmed',
        propertyName: 'Sunset Heights',
        status: 'confirmed',
        scheduledAt: new Date('2026-06-14T12:30:00.000Z'),
      };
      const primary = selectPrimaryVisit([scheduled, confirmed]);
      expect(primary?.visitId).toBe('v-confirmed');
    });

    test('soonest scheduledAt wins across visits', () => {
      const earlier: ActiveVisitContext = {
        visitId: 'v-early',
        propertyId: 'p1',
        propertyName: 'Sunset Heights',
        projectId: 'proj-a',
        status: 'scheduled',
        scheduledAt: new Date('2026-06-14T10:30:00.000Z'),
        agentName: null,
        agentPhone: null,
        notes: null,
      };
      const later: ActiveVisitContext = {
        ...earlier,
        visitId: 'v-late',
        propertyName: 'Lake Vista',
        scheduledAt: new Date('2026-06-14T12:30:00.000Z'),
      };
      expect(selectPrimaryVisit([later, earlier])?.visitId).toBe('v-early');
    });
  });

  describe('getLiveLeadContext', () => {
    const fixedNow = new Date('2026-06-14T09:00:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(fixedNow);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('flag OFF with 2 visits returns legacy first only and empty upcomingVisits', async () => {
      config.features.multiVisitContext = false;

      (prisma.lead.findFirst as jest.Mock).mockResolvedValue({
        status: 'visit_scheduled',
        customerName: 'Ravi',
        assignedAgentId: null,
        visits: [
          visitRow({ id: 'v1', propertyName: 'Sunset Heights 1102', scheduledAt: new Date('2026-06-14T10:30:00.000Z') }),
          visitRow({ id: 'v2', propertyName: 'Lake Vista 304', scheduledAt: new Date('2026-06-14T12:30:00.000Z') }),
        ],
      });

      const ctx = await getLiveLeadContext(leadId, companyId);

      expect(ctx.upcomingVisits).toEqual([]);
      expect(ctx.activeVisit?.visitId).toBe('v1');
      expect(ctx.activeVisit?.propertyName).toBe('Sunset Heights 1102');
    });

    test('flag ON with 0 visits returns null activeVisit', async () => {
      config.features.multiVisitContext = true;
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue({
        status: 'new',
        customerName: 'Ravi',
        assignedAgentId: null,
        visits: [],
      });

      const ctx = await getLiveLeadContext(leadId, companyId);
      expect(ctx.activeVisit).toBeNull();
      expect(ctx.upcomingVisits).toEqual([]);
    });

    test('flag ON with 1 confirmed visit populates both arrays with same id', async () => {
      config.features.multiVisitContext = true;
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue({
        status: 'visit_scheduled',
        customerName: 'Ravi',
        assignedAgentId: null,
        visits: [
          visitRow({ id: 'v1', status: 'confirmed', propertyName: 'Sunset Heights 1102' }),
        ],
      });

      const ctx = await getLiveLeadContext(leadId, companyId);
      expect(ctx.upcomingVisits).toHaveLength(1);
      expect(ctx.activeVisit?.visitId).toBe('v1');
      expect(ctx.upcomingVisits[0].visitId).toBe('v1');
    });

    test('flag ON with 2 same-day visits lists both in prompt', async () => {
      config.features.multiVisitContext = true;
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue({
        status: 'visit_scheduled',
        customerName: 'Ravi',
        assignedAgentId: null,
        visits: [
          visitRow({
            id: 'v1',
            status: 'confirmed',
            propertyName: 'Sunset Heights 1102',
            scheduledAt: new Date('2026-06-14T10:30:00.000Z'),
          }),
          visitRow({
            id: 'v2',
            status: 'scheduled',
            propertyName: 'Lake Vista 304',
            scheduledAt: new Date('2026-06-14T12:30:00.000Z'),
          }),
        ],
      });

      const ctx = await getLiveLeadContext(leadId, companyId);
      expect(ctx.upcomingVisits).toHaveLength(2);
      expect(ctx.promptBlock).toContain('Upcoming Site Visits (2)');
      expect(ctx.promptBlock).toContain('Sunset Heights 1102');
      expect(ctx.promptBlock).toContain('Lake Vista 304');
      expect(ctx.promptBlock).toContain('MULTIPLE upcoming visits');
    });

    test('flag ON pending_approval becomes activeVisit when no upcoming visits', async () => {
      config.features.multiVisitContext = true;
      (prisma.lead.findFirst as jest.Mock).mockResolvedValue({
        status: 'visit_scheduled',
        customerName: 'Ravi',
        assignedAgentId: null,
        visits: [
          visitRow({ id: 'v-past', status: 'completed', propertyName: 'Old Visit', scheduledAt: new Date('2026-01-01T10:30:00.000Z') }),
        ],
      });
      (findPendingVisitApprovalForLead as jest.Mock).mockResolvedValue({
        approvalId: 'pending-1',
        propertyId: 'prop-pending',
        propertyName: 'Pending Tower 501',
        scheduledAt: '2026-06-15T10:30:00.000Z',
      });
      (prisma.property.findUnique as jest.Mock).mockResolvedValue({ projectId: 'proj-p' });

      const ctx = await getLiveLeadContext(leadId, companyId);
      expect(ctx.activeVisit?.visitId).toBe('pending-1');
      expect(ctx.activeVisit?.status).toBe('pending_approval');
      expect(ctx.activeVisit?.propertyName).toBe('Pending Tower 501');
      expect(ctx.upcomingVisits).toEqual([]);
    });
  });
});
