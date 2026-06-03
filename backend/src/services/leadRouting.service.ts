import prisma from '../config/prisma';
import { assignLeadRoundRobin, notifyAgentOfNewLead } from './leadAssignment.service';
import type { Lead } from '@prisma/client';
import { parseLeadMetadata } from './leadMetadata.service';

export type RoutingMethod = 'least_loaded' | 'round_robin' | 'by_location' | 'by_project';

export interface LeadRoutingSettings {
  method: RoutingMethod;
  location_agent_map?: Record<string, string>;
  project_agent_map?: Record<string, string>;
  hot_agent_ids?: string[];
  prefer_hot_agents_for_score?: boolean;
}

const DEFAULT_ROUTING: LeadRoutingSettings = { method: 'least_loaded' };

export function parseRoutingSettings(companySettings: unknown): LeadRoutingSettings {
  if (!companySettings || typeof companySettings !== 'object') return DEFAULT_ROUTING;
  const s = companySettings as Record<string, unknown>;
  const raw = s.lead_routing;
  if (!raw || typeof raw !== 'object') return DEFAULT_ROUTING;
  const r = raw as Record<string, unknown>;
  const method = r.method as RoutingMethod;
  const valid: RoutingMethod[] = ['least_loaded', 'round_robin', 'by_location', 'by_project'];
  return {
    method: valid.includes(method) ? method : 'least_loaded',
    location_agent_map:
      r.location_agent_map && typeof r.location_agent_map === 'object'
        ? (r.location_agent_map as Record<string, string>)
        : {},
    project_agent_map:
      r.project_agent_map && typeof r.project_agent_map === 'object'
        ? (r.project_agent_map as Record<string, string>)
        : {},
    hot_agent_ids: Array.isArray(r.hot_agent_ids)
      ? r.hot_agent_ids.filter((id): id is string => typeof id === 'string')
      : [],
    prefer_hot_agents_for_score: r.prefer_hot_agents_for_score === true,
  };
}

async function pickFromMap(
  map: Record<string, string> | undefined,
  key: string | null | undefined,
  companyId: string,
): Promise<string | null> {
  if (!key || !map) return null;
  const normalized = key.trim().toLowerCase();
  const agentId = map[normalized] || map[key];
  if (!agentId) return null;
  const agent = await prisma.user.findFirst({
    where: { id: agentId, companyId, role: 'sales_agent', status: 'active' },
    select: { id: true },
  });
  return agent?.id ?? null;
}

/**
 * Assign lead using company routing settings (falls back to least-loaded round-robin).
 */
export async function assignLeadWithRouting(
  companyId: string,
  lead?: Pick<Lead, 'locationPreference' | 'metadata'> | null,
  leadId?: string,
): Promise<string | null> {
  const notify = (agentId: string | null) => {
    if (agentId && leadId) void notifyAgentOfNewLead(agentId, leadId, companyId);
    return agentId;
  };
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  const routing = parseRoutingSettings(company?.settings);
  const meta = parseLeadMetadata(lead?.metadata);
  const sourceDetail = meta.source_detail || '';

  if (routing.prefer_hot_agents_for_score && meta.lead_score === 'hot' && routing.hot_agent_ids?.length) {
    const hotPool = routing.hot_agent_ids;
    const counts = await prisma.lead.groupBy({
      by: ['assignedAgentId'],
      where: {
        companyId,
        assignedAgentId: { in: hotPool },
        status: { notIn: ['closed_won', 'closed_lost'] },
      },
      _count: { id: true },
    });
    const countMap = new Map(counts.map((c) => [c.assignedAgentId, c._count.id]));
    let minId = hotPool[0];
    let min = countMap.get(hotPool[0]) ?? 0;
    for (const id of hotPool) {
      const c = countMap.get(id) ?? 0;
      if (c < min) {
        min = c;
        minId = id;
      }
    }
    const valid = await prisma.user.findFirst({
      where: { id: minId, companyId, status: 'active', role: 'sales_agent' },
    });
    if (valid) return notify(minId);
  }

  if (routing.method === 'by_location' && lead?.locationPreference) {
    const byLoc = await pickFromMap(routing.location_agent_map, lead.locationPreference, companyId);
    if (byLoc) return notify(byLoc);
  }

  if (routing.method === 'by_project' && sourceDetail) {
    const byProj = await pickFromMap(routing.project_agent_map, sourceDetail, companyId);
    if (byProj) return notify(byProj);
  }

  return assignLeadRoundRobin(companyId, leadId);
}
