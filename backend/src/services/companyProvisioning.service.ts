import prisma from '../config/prisma';

const DEFAULT_ONBOARDING_FEATURES = [
  'ai_bot',
  'lead_automation',
  'visit_scheduling',
  'notifications',
  'agent_management',
  'conversation_center',
  'property_management',
  'analytics',
  'audit_logs',
  'csv_export',
] as const;

const DEFAULT_ONBOARDING_ROLES: Array<{
  roleName: string;
  displayName: string;
  permissions: Record<string, string[]>;
}> = [
  { roleName: 'sales_agent', displayName: 'Sales Agent', permissions: {} },
  { roleName: 'operations', displayName: 'Operations', permissions: {} },
  { roleName: 'viewer', displayName: 'Viewer', permissions: {} },
];

/**
 * Seed tenant defaults when super admin creates a company (mirrors self-service signup).
 */
export async function provisionNewCompany(companyId: string, companyName: string): Promise<void> {
  const existing = await prisma.companyOnboarding.findUnique({ where: { companyId } });
  if (existing) return;

  await prisma.$transaction(async (tx) => {
    for (const featureKey of DEFAULT_ONBOARDING_FEATURES) {
      await tx.companyFeature.upsert({
        where: { companyId_featureKey: { companyId, featureKey } },
        create: { companyId, featureKey, enabled: true },
        update: { enabled: true },
      });
    }

    for (const role of DEFAULT_ONBOARDING_ROLES) {
      await tx.companyRole.upsert({
        where: { companyId_roleName: { companyId, roleName: role.roleName } },
        create: {
          companyId,
          roleName: role.roleName,
          displayName: role.displayName,
          permissions: role.permissions,
          isDefault: true,
        },
        update: {},
      });
    }

    await tx.aiSetting.upsert({
      where: { companyId },
      create: {
        companyId,
        businessName: companyName,
        responseTone: 'friendly',
        persuasionLevel: 5,
        workingHours: { start: '09:00', end: '21:00' },
        greetingTemplate: `Hello! Welcome to ${companyName}. How can I help you find your dream property today?`,
        defaultLanguage: 'en',
        operatingLocations: [],
        budgetRanges: {},
        faqKnowledge: [],
      },
      update: {},
    });

    await tx.companyOnboarding.create({
      data: { companyId, stepCompleted: 0 },
    });
  });
}
