import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import prisma from '../config/prisma';
import logger from '../config/logger';
import { ROLES, normalizeIndianPhoneNumber, isIndianE164Phone } from '../models/validation';
import { authService, normalizeAuthEmail } from '../services/auth.service';

const router = Router();

router.use(authenticate);
router.use(tenantIsolation);

const DEFAULT_FEATURES = [
  'ai_bot', 'analytics', 'visit_scheduling', 'notifications',
  'agent_management', 'conversation_center', 'lead_automation',
  'property_management', 'audit_logs', 'csv_export',
];
const SYSTEM_ROLES = new Set<string>(ROLES as readonly string[]);

async function updateCompanySetup(companyId: string, body: any) {
  const { name, whatsapp_phone, logo_url, primary_color, description } = body;

  if (!name) {
    throw new Error('Company name is required');
  }

  let normalizedWhatsAppPhone: string | null | undefined = undefined;
  if (whatsapp_phone !== undefined) {
    const normalized = normalizeIndianPhoneNumber(whatsapp_phone);
    if (normalized === null) {
      normalizedWhatsAppPhone = null;
    } else if (typeof normalized === 'string' && isIndianE164Phone(normalized)) {
      normalizedWhatsAppPhone = normalized;
    } else {
      throw new Error('Phone must be in E.164 format: +91XXXXXXXXXX');
    }
  }

  const company = await prisma.company.update({
    where: { id: companyId },
    data: {
      name,
      ...(whatsapp_phone !== undefined && { whatsappPhone: normalizedWhatsAppPhone }),
      settings: {
        logo_url: logo_url || null,
        primary_color: primary_color || '#3B82F6',
        description: description || '',
      },
    },
  });

  await prisma.companyOnboarding.upsert({
    where: { companyId },
    create: { companyId, stepCompleted: 1, companyProfile: true },
    update: { stepCompleted: 1, companyProfile: true },
  });

  return company;
}

const DEFAULT_ROLES = [
  {
    roleName: 'sales_agent',
    displayName: 'Sales Agent',
    permissions: {
      leads: ['read', 'update'],
      properties: ['read'],
      conversations: ['read'],
      visits: ['create', 'read', 'update'],
      analytics: ['read'],
      notifications: ['read', 'update'],
    },
  },
  {
    roleName: 'operations',
    displayName: 'Operations',
    permissions: {
      leads: ['read'],
      properties: ['read'],
      conversations: ['read'],
      visits: ['read', 'update'],
      analytics: ['read'],
      notifications: ['read', 'update'],
    },
  },
  {
    roleName: 'viewer',
    displayName: 'Viewer',
    permissions: {
      leads: ['read'],
      properties: ['read'],
      visits: ['read'],
      analytics: ['read'],
      audit_logs: ['read'],
      notifications: ['read'],
    },
  },
];

/**
 * GET /api/onboarding/status
 * Get onboarding progress for current company
 */
router.get(
  '/status',
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      let onboarding = await prisma.companyOnboarding.findUnique({
        where: { companyId },
      });

      if (!onboarding) {
        // Create initial onboarding record
        onboarding = await prisma.companyOnboarding.create({
          data: { companyId, stepCompleted: 0 },
        });
      }

      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true, slug: true, whatsappPhone: true, settings: true },
      });

      res.json({
        data: {
          currentStep: onboarding.stepCompleted || 1,
          completedSteps: [
            onboarding.companyProfile ? 1 : null,
            onboarding.rolesConfigured ? 2 : null,
            onboarding.featuresSelected ? 3 : null,
            onboarding.aiConfigured ? 4 : null,
            onboarding.teamInvited ? 5 : null,
            onboarding.completedAt ? 6 : null,
          ].filter(Boolean),
          companyData: {
            name: company?.name || '',
            description: (company?.settings as any)?.description || '',
            whatsapp_phone: company?.whatsappPhone || '',
            primary_color: (company?.settings as any)?.primary_color || '#3B82F6',
          },
        },
      });
    } catch (err: any) {
      logger.error('Failed to get onboarding status', { error: err.message });
      res.status(500).json({ error: 'Failed to get onboarding status' });
    }
  }
);

/**
 * POST /api/onboarding/setup
 * Step 1: Company profile setup
 */
router.post(
  '/setup',
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const company = await updateCompanySetup(companyId, req.body);

      res.json({ data: company, step: 1, message: 'Company profile updated' });
    } catch (err: any) {
      logger.error('Failed to setup company', { error: err.message });
      if (err.message === 'Company name is required' || err.message.includes('Phone must be in E.164')) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Failed to setup company profile' });
    }
  }
);

/**
 * PUT /api/onboarding/setup
 * Alias used by settings page for company profile updates
 */
router.put(
  '/setup',
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const company = await updateCompanySetup(companyId, req.body);
      res.json({ data: company, step: 1, message: 'Company profile updated' });
    } catch (err: any) {
      logger.error('Failed to update onboarding setup', { error: err.message });
      if (err.message === 'Company name is required' || err.message.includes('Phone must be in E.164')) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Failed to update company profile' });
    }
  }
);

/**
 * GET /api/onboarding/setup
 * Used by settings page to fetch current company setup values
 */
router.get(
  '/setup',
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: {
          name: true,
          whatsappPhone: true,
          settings: true,
        },
      });

      if (!company) {
        res.status(404).json({ error: 'Company not found' });
        return;
      }

      res.json({
        data: {
          name: company.name,
          whatsapp_phone: company.whatsappPhone,
          logo_url: (company.settings as any)?.logo_url || null,
          primary_color: (company.settings as any)?.primary_color || '#3B82F6',
          description: (company.settings as any)?.description || '',
        },
      });
    } catch (err: any) {
      logger.error('Failed to fetch onboarding setup', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch company profile' });
    }
  }
);

/**
 * POST /api/onboarding/roles
 * Step 2: Configure which roles this company needs
 */
router.post(
  '/roles',
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { roles } = req.body;

      // roles: array of role names to enable, e.g. ["sales_agent", "operations"]
      // or custom: [{ role_name: "marketing_head", display_name: "Marketing Head", permissions: {...} }]
      if (!Array.isArray(roles) || roles.length === 0) {
        res.status(400).json({
          error: 'roles must be an array',
          example: '["sales_agent", "viewer"] or [{ "role_name": "custom_role", "display_name": "Custom", "permissions": {} }]',
        });
        return;
      }

      const created = [];
      for (const role of roles) {
        if (typeof role === 'string') {
          // System default role
          const def = DEFAULT_ROLES.find(r => r.roleName === role);
          if (!def) continue;
          const existing = await prisma.companyRole.findUnique({
            where: { companyId_roleName: { companyId, roleName: def.roleName } },
          });
          if (!existing) {
            const r = await prisma.companyRole.create({
              data: {
                companyId,
                roleName: def.roleName,
                displayName: def.displayName,
                permissions: def.permissions,
                isDefault: true,
              },
            });
            created.push(r);
          } else {
            created.push(existing);
          }
        } else if (typeof role === 'object' && role.role_name) {
          // Custom role
          const existing = await prisma.companyRole.findUnique({
            where: { companyId_roleName: { companyId, roleName: role.role_name } },
          });
          if (!existing) {
            const r = await prisma.companyRole.create({
              data: {
                companyId,
                roleName: role.role_name,
                displayName: role.display_name || role.role_name,
                permissions: role.permissions || {},
                isDefault: false,
              },
            });
            created.push(r);
          } else {
            created.push(existing);
          }
        }
      }

      await prisma.companyOnboarding.upsert({
        where: { companyId },
        create: { companyId, stepCompleted: 2, companyProfile: true, rolesConfigured: true },
        update: { stepCompleted: 2, rolesConfigured: true },
      });

      res.json({ data: created, step: 2, message: `${created.length} roles configured` });
    } catch (err: any) {
      logger.error('Failed to configure roles', { error: err.message });
      res.status(500).json({ error: 'Failed to configure roles' });
    }
  }
);

/**
 * POST /api/onboarding/features
 * Step 3: Select which features to enable
 */
router.post(
  '/features',
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const { features } = req.body;
      let featureEntries: Array<{ key: string; enabled: boolean }> = [];
      if (Array.isArray(features)) {
        featureEntries = features
          .filter((f) => f && typeof f.key === 'string')
          .map((f) => ({ key: f.key, enabled: f.enabled !== false }));
      } else if (features && typeof features === 'object') {
        featureEntries = Object.entries(features).map(([key, value]) => ({
          key,
          enabled: value !== false,
        }));
      }
      if (featureEntries.length === 0) {
        res.status(400).json({
          error: 'features must be an object map or array',
          example: '{ "ai_bot": true } or [{ "key": "visit_scheduling", "enabled": true }]',
          available: DEFAULT_FEATURES,
        });
        return;
      }

      const results = [];
      for (const feature of featureEntries) {
        const result = await prisma.companyFeature.upsert({
          where: { companyId_featureKey: { companyId, featureKey: feature.key } },
          create: { companyId, featureKey: feature.key, enabled: feature.enabled },
          update: { enabled: feature.enabled },
        });
        results.push(result);
      }

      await prisma.companyOnboarding.upsert({
        where: { companyId },
        create: { companyId, stepCompleted: 3, companyProfile: true, rolesConfigured: true, featuresSelected: true },
        update: { stepCompleted: 3, featuresSelected: true },
      });

      res.json({
        data: results.map(r => ({ key: r.featureKey, enabled: r.enabled })),
        step: 3,
        message: 'Features configured',
      });
    } catch (err: any) {
      logger.error('Failed to configure features', { error: err.message });
      res.status(500).json({ error: 'Failed to configure features' });
    }
  }
);

/**
 * POST /api/onboarding/ai
 * Step 4: Configure AI settings
 */
router.post(
  '/ai',
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const {
        business_name, business_description, operating_locations, budget_ranges,
        response_tone, persuasion_level, working_hours,
        faq_knowledge, greeting_template, default_language,
      } = req.body;

      if (!business_name) {
        res.status(400).json({ error: 'business_name is required' });
        return;
      }

      const aiSettings = await prisma.aiSetting.upsert({
        where: { companyId },
        create: {
          companyId,
          businessName: business_name,
          businessDescription: business_description || null,
          operatingLocations: operating_locations || [],
          budgetRanges: budget_ranges || {},
          responseTone: response_tone || 'friendly',
          persuasionLevel: persuasion_level || 5,
          workingHours: working_hours || { start: '09:00', end: '21:00' },
          faqKnowledge: faq_knowledge || [],
          greetingTemplate: greeting_template || 'Hello! Welcome to {business_name}. How can I help you today?',
          defaultLanguage: default_language || 'en',
        },
        update: {
          businessName: business_name,
          ...(business_description !== undefined && { businessDescription: business_description }),
          ...(operating_locations && { operatingLocations: operating_locations }),
          ...(budget_ranges && { budgetRanges: budget_ranges }),
          ...(response_tone && { responseTone: response_tone }),
          ...(persuasion_level && { persuasionLevel: persuasion_level }),
          ...(working_hours && { workingHours: working_hours }),
          ...(faq_knowledge && { faqKnowledge: faq_knowledge }),
          ...(greeting_template && { greetingTemplate: greeting_template }),
          ...(default_language && { defaultLanguage: default_language }),
        },
      });

      await prisma.companyOnboarding.upsert({
        where: { companyId },
        create: { companyId, stepCompleted: 4, companyProfile: true, rolesConfigured: true, featuresSelected: true, aiConfigured: true },
        update: { stepCompleted: 4, aiConfigured: true },
      });

      res.json({ data: aiSettings, step: 4, message: 'AI settings configured' });
    } catch (err: any) {
      logger.error('Failed to configure AI', { error: err.message });
      res.status(500).json({ error: 'Failed to configure AI settings' });
    }
  }
);

/**
 * POST /api/onboarding/invite
 * Step 5: Invite team members
 */
router.post(
  '/invite',
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const members = req.body.members || req.body.invites;

      // members/invites: [{ name, email, role, password }]
      if (!Array.isArray(members) || members.length === 0) {
        res.status(400).json({
          error: 'members/invites must be an array',
          example: '[{ "name": "John", "email": "john@co.com", "role": "sales_agent" }]',
        });
        return;
      }

      const created = [];
      for (const m of members) {
        if (!m.name || !m.email || !m.role) continue;
        const normalizedEmail = normalizeAuthEmail(String(m.email));
        if (!m.password || String(m.password).length < 8) {
          created.push({ email: normalizedEmail, status: 'password_required' });
          continue;
        }

        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
          created.push({ email: normalizedEmail, status: 'already_exists' });
          continue;
        }

        const selectedRole = String(m.role);
        let userRole: 'sales_agent' | 'operations' | 'viewer' | 'company_admin' | 'super_admin' =
          'viewer';
        let customRoleId: string | null = null;
        if (SYSTEM_ROLES.has(selectedRole)) {
          userRole = selectedRole as any;
        } else {
          const customRole = await prisma.companyRole.findFirst({
            where: { companyId, roleName: selectedRole },
            select: { id: true },
          });
          if (!customRole) {
            created.push({ email: m.email, role: selectedRole, status: 'invalid_role' });
            continue;
          }
          customRoleId = customRole.id;
          userRole = 'viewer';
        }
        try {
          const user = await authService.register({
            name: String(m.name),
            email: normalizedEmail,
            password: String(m.password),
            phone: m.phone || null,
            role: userRole,
            company_id: companyId,
            custom_role_id: customRoleId,
            must_change_password: true,
          });
          created.push({
            email: user.email,
            name: m.name,
            role: selectedRole,
            status: 'created',
          });
        } catch (inviteErr: any) {
          created.push({
            email: normalizedEmail,
            role: selectedRole,
            status: 'failed',
            message: inviteErr.message,
          });
        }
      }

      await prisma.companyOnboarding.upsert({
        where: { companyId },
        create: { companyId, stepCompleted: 5, companyProfile: true, rolesConfigured: true, featuresSelected: true, aiConfigured: true, teamInvited: true },
        update: { stepCompleted: 5, teamInvited: true },
      });

      res.json({ data: created, step: 5, message: `${created.filter(c => c.status === 'created').length} team members added` });
    } catch (err: any) {
      logger.error('Failed to invite team', { error: err.message });
      res.status(500).json({ error: 'Failed to invite team members' });
    }
  }
);

/**
 * POST /api/onboarding/complete
 * Step 6: Mark onboarding as complete
 */
router.post(
  '/complete',
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);

      const onboarding = await prisma.companyOnboarding.upsert({
        where: { companyId },
        create: {
          companyId,
          stepCompleted: 6,
          companyProfile: true,
          rolesConfigured: true,
          featuresSelected: true,
          aiConfigured: true,
          teamInvited: true,
          completedAt: new Date(),
        },
        update: {
          stepCompleted: 6,
          completedAt: new Date(),
        },
      });

      res.json({ data: onboarding, step: 6, message: 'Onboarding complete! Welcome to Investo.' });
    } catch (err: any) {
      logger.error('Failed to complete onboarding', { error: err.message });
      res.status(500).json({ error: 'Failed to complete onboarding' });
    }
  }
);

export default router;
