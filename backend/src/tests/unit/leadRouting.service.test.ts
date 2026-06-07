import { parseRoutingSettings, type LeadRoutingSettings } from '../../services/leadRouting.service';

describe('parseRoutingSettings', () => {
  test('returns default when settings are null', () => {
    const result = parseRoutingSettings(null);
    expect(result.method).toBe('least_loaded');
  });

  test('returns default when settings are a string', () => {
    const result = parseRoutingSettings('not-an-object');
    expect(result.method).toBe('least_loaded');
  });

  test('returns default when lead_routing key is missing', () => {
    const result = parseRoutingSettings({ other: true });
    expect(result.method).toBe('least_loaded');
  });

  test('returns default when method is unknown', () => {
    const result = parseRoutingSettings({ lead_routing: { method: 'random_unknown' } });
    expect(result.method).toBe('least_loaded');
  });

  test('parses round_robin method', () => {
    const result = parseRoutingSettings({ lead_routing: { method: 'round_robin' } });
    expect(result.method).toBe('round_robin');
  });

  test('parses by_location with location_agent_map', () => {
    const result = parseRoutingSettings({
      lead_routing: {
        method: 'by_location',
        location_agent_map: { pune: 'agent-1', mumbai: 'agent-2' },
      },
    });
    expect(result.method).toBe('by_location');
    expect(result.location_agent_map).toEqual({ pune: 'agent-1', mumbai: 'agent-2' });
  });

  test('parses by_project with project_agent_map', () => {
    const result = parseRoutingSettings({
      lead_routing: {
        method: 'by_project',
        project_agent_map: { 'project-x': 'agent-3' },
      },
    });
    expect(result.method).toBe('by_project');
    expect(result.project_agent_map).toEqual({ 'project-x': 'agent-3' });
  });

  test('parses hot_agent_ids and prefer_hot_agents_for_score', () => {
    const result = parseRoutingSettings({
      lead_routing: {
        method: 'least_loaded',
        hot_agent_ids: ['agent-1', 'agent-2'],
        prefer_hot_agents_for_score: true,
      },
    });
    expect(result.hot_agent_ids).toEqual(['agent-1', 'agent-2']);
    expect(result.prefer_hot_agents_for_score).toBe(true);
  });

  test('filters non-string values from hot_agent_ids', () => {
    const result = parseRoutingSettings({
      lead_routing: {
        method: 'least_loaded',
        hot_agent_ids: ['agent-1', 42, null, 'agent-2'],
      },
    });
    expect(result.hot_agent_ids).toEqual(['agent-1', 'agent-2']);
  });

  test('defaults location_agent_map to empty object when not provided', () => {
    const result = parseRoutingSettings({ lead_routing: { method: 'by_location' } });
    expect(result.location_agent_map).toEqual({});
  });

  test('all four valid methods are accepted', () => {
    const methods: LeadRoutingSettings['method'][] = [
      'least_loaded',
      'round_robin',
      'by_location',
      'by_project',
    ];
    for (const method of methods) {
      const result = parseRoutingSettings({ lead_routing: { method } });
      expect(result.method).toBe(method);
    }
  });
});
