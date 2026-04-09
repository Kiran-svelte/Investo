import { describe, expect, it } from 'vitest';
import { buildOnboardingAiPayload, buildSafeOnboardingRolesPayload, getApiErrorMessage } from './OnboardingPage';

describe('OnboardingPage helpers', () => {
  it('builds AI payload with nested budget_ranges and working_hours', () => {
    const payload = buildOnboardingAiPayload(
      {
        business_name: 'Investo',
        business_description: 'Real estate',
        operating_locations: [],
        budget_range_min: 1000000,
        budget_range_max: 5000000,
        response_tone: 'friendly',
        persuasion_level: 7,
        default_language: 'en',
        working_hours_start: '09:00',
        working_hours_end: '18:00',
        greeting_template: 'Hello',
      },
      'Bangalore, Pune',
    );

    expect(payload).toEqual({
      business_name: 'Investo',
      business_description: 'Real estate',
      operating_locations: ['Bangalore', 'Pune'],
      budget_ranges: {
        min: 1000000,
        max: 5000000,
      },
      response_tone: 'friendly',
      persuasion_level: 7,
      working_hours: {
        start: '09:00',
        end: '18:00',
      },
      greeting_template: 'Hello',
      default_language: 'en',
    });
  });

  it('prefers backend error key and falls back to message', () => {
    expect(getApiErrorMessage({ response: { data: { error: 'Validation failed' } } }, 'Fallback')).toBe('Validation failed');
    expect(getApiErrorMessage({ response: { data: { message: 'Bad request' } } }, 'Fallback')).toBe('Bad request');
    expect(getApiErrorMessage({}, 'Fallback')).toBe('Fallback');
  });

  it('builds a safe role payload and excludes reserved/invalid role objects', () => {
    const payload = buildSafeOnboardingRolesPayload([
      {
        role_name: 'sales_agent',
        display_name: 'Sales Agent',
        permissions: {},
        enabled: true,
      },
      {
        role_name: 'company_admin',
        display_name: 'Company Admin',
        permissions: { leads: ['create', 'read'] },
        enabled: true,
        isCustom: true,
      },
      {
        role_name: 'marketing_head',
        display_name: 'Marketing Head',
        permissions: { leads: ['read', 'share' as any], analytics: ['read'], settings: ['update'] },
        enabled: true,
        isCustom: true,
      },
      {
        role_name: 'invalid role',
        display_name: 'Invalid',
        permissions: { leads: ['read'], billing: ['read'] },
        enabled: true,
        isCustom: true,
      },
    ] as any);

    expect(payload).toEqual([
      'sales_agent',
      {
        role_name: 'marketing_head',
        display_name: 'Marketing Head',
        permissions: {
          leads: ['read'],
          analytics: ['read'],
          platform_settings: ['update'],
        },
      },
    ]);
  });

  it('drops unsupported custom role permission resources while preserving supported resources', () => {
    const payload = buildSafeOnboardingRolesPayload([
      {
        role_name: 'ops_specialist',
        display_name: 'Ops Specialist',
        permissions: {
          properties: ['read', 'update'],
          unknown_resource: ['read'],
        },
        enabled: true,
        isCustom: true,
      },
    ] as any);

    expect(payload).toEqual([
      {
        role_name: 'ops_specialist',
        display_name: 'Ops Specialist',
        permissions: {
          properties: ['read', 'update'],
        },
      },
    ]);
  });
});
