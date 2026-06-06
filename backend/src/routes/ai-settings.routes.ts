import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import { tenantIsolation, getCompanyId } from '../middleware/tenant';
import { auditLog } from '../middleware/audit';
import { validate } from '../middleware/validate';
import { requireFeature } from '../middleware/featureGate';
import { aiSettingsSchema } from '../models/validation';
import config from '../config';
import prisma from '../config/prisma';
import logger from '../config/logger';
import {
  loadFaqKnowledgeFromSupabase,
  syncFaqKnowledgeToSupabase,
} from '../services/aiKnowledgeStorage.service';

const router = Router();

async function markWhatsAppVerified(companyId: string): Promise<void> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  if (!company) {
    return;
  }

  const settings = (company.settings && typeof company.settings === 'object')
    ? { ...(company.settings as Record<string, unknown>) }
    : {};
  const whatsapp = (settings.whatsapp && typeof settings.whatsapp === 'object')
    ? { ...(settings.whatsapp as Record<string, unknown>) }
    : {};

  whatsapp.verifiedAt = new Date().toISOString();
  settings.whatsapp = whatsapp;

  await prisma.company.update({
    where: { id: companyId },
    data: { settings: settings as Parameters<typeof prisma.company.update>[0]['data']['settings'] },
  });
}

router.use(authenticate);
router.use(tenantIsolation);
router.use(requireFeature('ai_bot'));

/**
 * GET /api/ai-settings
 * Get AI configuration for the company.
 */
router.get(
  '/',
  authorize('ai_settings', 'read'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      let settings = await prisma.aiSetting.findUnique({ where: { companyId } });

      if (!settings) {
        settings = await prisma.aiSetting.create({
          data: {
            companyId,
            responseTone: 'friendly',
            persuasionLevel: 7,
            autoDetectLanguage: true,
            defaultLanguage: 'en',
          },
        });
      }

      const supabaseFaqs = await loadFaqKnowledgeFromSupabase(companyId);
      if (supabaseFaqs !== null) {
        settings = { ...settings, faqKnowledge: supabaseFaqs as typeof settings.faqKnowledge };
      }

      res.json({ data: settings });
    } catch (err: any) {
      logger.error('Failed to fetch AI settings', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch AI settings' });
    }
  }
);

/**
 * PUT /api/ai-settings
 * Update AI configuration.
 */
router.put(
  '/',
  authorize('ai_settings', 'update'),
  validate(aiSettingsSchema),
  auditLog('update', 'ai_settings'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const data = req.body;

      const updateFields: any = {};
      if (data.business_name !== undefined) updateFields.businessName = data.business_name;
      if (data.business_description !== undefined) updateFields.businessDescription = data.business_description;
      if (data.operating_locations !== undefined) updateFields.operatingLocations = data.operating_locations;
      if (data.budget_ranges !== undefined) updateFields.budgetRanges = data.budget_ranges;
      if (data.response_tone !== undefined) updateFields.responseTone = data.response_tone;
      if (data.working_hours !== undefined) updateFields.workingHours = data.working_hours;
      if (data.faq_knowledge !== undefined) updateFields.faqKnowledge = data.faq_knowledge;
      if (data.greeting_template !== undefined) updateFields.greetingTemplate = data.greeting_template;
      if (data.persuasion_level !== undefined) updateFields.persuasionLevel = data.persuasion_level;
      if (data.auto_detect_language !== undefined) updateFields.autoDetectLanguage = data.auto_detect_language;
      if (data.default_language !== undefined) updateFields.defaultLanguage = data.default_language;

      const settings = await prisma.aiSetting.upsert({
        where: { companyId },
        update: updateFields,
        create: {
          companyId,
          ...updateFields,
        },
      });

      if (data.faq_knowledge !== undefined) {
        void syncFaqKnowledgeToSupabase(companyId, data.faq_knowledge).catch((syncErr: Error) => {
          logger.warn('FAQ knowledge Supabase sync failed', { companyId, error: syncErr.message });
        });
      }

      res.json({ data: settings });
    } catch (err: any) {
      logger.error('Failed to update AI settings', { error: err.message });
      res.status(500).json({ error: 'Failed to update AI settings' });
    }
  }
);

/**
 * POST /api/ai-settings/whatsapp/test
 * Test WhatsApp connection with the provided config.
 */
router.post(
  '/whatsapp/test',
  authorize('ai_settings', 'update'),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = getCompanyId(req);

      const { phone_number_id, access_token } = req.body;

      if (!phone_number_id || !access_token) {
        res.status(400).json({ success: false, error: 'phone_number_id and access_token are required' });
        return;
      }

      const { whatsappService } = await import('../services/whatsapp.service');
      const result = await whatsappService.testConnection({
        provider: 'meta',
        phoneNumberId: phone_number_id,
        accessToken: access_token,
        verifyToken: '',
      });

      if (result.success) {
        await markWhatsAppVerified(companyId);
        res.json({ success: true, provider: 'meta', message: 'WhatsApp connection successful' });
      } else {
        res.status(400).json({ success: false, provider: 'meta', error: result.error });
      }
    } catch (err: any) {
      logger.error('WhatsApp test failed', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

export default router;
