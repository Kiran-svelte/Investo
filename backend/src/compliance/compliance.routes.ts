import { Router, Response } from 'express';

import config from '../config';
import { authenticate, AuthRequest } from '../middleware/auth';
import { hasRole } from '../middleware/rbac';
import { getCompanyId, strictTenantIsolation } from '../middleware/tenant';
import { dsrService } from './dsr.service';
import { retentionService } from './retention.service';
import { legalHoldService } from './legalHold.service';
import { dpaService } from './dpa.service';

const router = Router();

router.use(authenticate);
router.use(hasRole('company_admin', 'super_admin'));
router.use(strictTenantIsolation);

function featureDisabled(res: Response): boolean {
  if (
    !config.features.dsr
    && !config.features.complianceRetention
    && !config.features.complianceLegalHold
    && !config.features.complianceDpa
  ) {
    res.status(503).json({ error: 'Compliance features are disabled' });
    return true;
  }
  return false;
}

function normalizeRetentionBody(body: Record<string, unknown>) {
  const leadDays = body.leadDays ?? body.leadInactiveDays ?? body.lead_inactive_days;
  const messageDays = body.messageDays ?? body.message_days;
  const auditDays = body.auditDays ?? body.audit_days;
  const inactiveCompanyDays = body.inactiveCompanyDays ?? body.inactive_company_days;
  return {
    ...(leadDays !== undefined ? { leadDays: Number(leadDays) } : {}),
    ...(messageDays !== undefined ? { messageDays: Number(messageDays) } : {}),
    ...(auditDays !== undefined ? { auditDays: Number(auditDays) } : {}),
    ...(inactiveCompanyDays !== undefined ? { inactiveCompanyDays: Number(inactiveCompanyDays) } : {}),
  };
}

function serializeRetentionPolicy(policy: Record<string, unknown>) {
  return {
    ...policy,
    leadInactiveDays: policy.leadDays,
  };
}

router.get('/status', (_req: AuthRequest, res: Response) => {
  res.json({
    dsr: config.features.dsr === true,
    retention: config.features.complianceRetention === true,
    legal_hold: config.features.complianceLegalHold === true,
    dpa: config.features.complianceDpa === true,
  });
});

router.get('/dsr', async (req: AuthRequest, res: Response) => {
  if (!config.features.dsr) {
    res.status(503).json({ error: 'FEATURE_DSR is disabled' });
    return;
  }
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const requests = await dsrService.listRequests(companyId);
  res.json({ requests });
});

router.post('/dsr', async (req: AuthRequest, res: Response) => {
  if (!config.features.dsr) {
    res.status(503).json({ error: 'FEATURE_DSR is disabled' });
    return;
  }
  const companyId = getCompanyId(req);
  const userId = req.user?.id;
  if (!companyId || !userId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }

  const { request_type, subject_phone, subject_email } = req.body || {};
  if (!request_type || !['export', 'delete', 'access'].includes(request_type)) {
    res.status(400).json({ error: 'request_type must be export, delete, or access' });
    return;
  }

  try {
    const created = await dsrService.createRequest({
      companyId,
      requestType: request_type,
      subjectPhone: subject_phone,
      subjectEmail: subject_email,
      requestedBy: userId,
    });
    res.status(201).json({ request: created });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/dsr/:id/process', async (req: AuthRequest, res: Response) => {
  if (!config.features.dsr) {
    res.status(503).json({ error: 'FEATURE_DSR is disabled' });
    return;
  }
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }

  const request = await dsrService.listRequests(companyId).then(
    (rows: any[]) => rows.find((r) => r.id === req.params.id),
  );
  if (!request) {
    res.status(404).json({ error: 'Request not found' });
    return;
  }

  try {
    if (request.requestType === 'export' || request.requestType === 'access') {
      const artifactPath = await dsrService.processExport(req.params.id, companyId);
      res.json({ status: 'completed', artifact_path: artifactPath });
      return;
    }
    if (request.requestType === 'delete') {
      await dsrService.processDelete(req.params.id, companyId);
      res.json({ status: 'completed' });
      return;
    }
    res.status(400).json({ error: 'Unsupported request type' });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/retention', async (req: AuthRequest, res: Response) => {
  if (featureDisabled(res)) return;
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const policy = await retentionService.getPolicy(companyId);
  res.json({ policy: serializeRetentionPolicy(policy as Record<string, unknown>) });
});

router.put('/retention', async (req: AuthRequest, res: Response) => {
  if (!config.features.complianceRetention) {
    res.status(503).json({ error: 'FEATURE_COMPLIANCE_RETENTION is disabled' });
    return;
  }
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const policy = await retentionService.upsertPolicy(companyId, normalizeRetentionBody(req.body || {}));
  res.json({ policy: serializeRetentionPolicy(policy as Record<string, unknown>) });
});

router.get('/legal-holds', async (req: AuthRequest, res: Response) => {
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const holds = await legalHoldService.listActiveHolds(companyId);
  res.json({ holds });
});

router.post('/legal-holds', async (req: AuthRequest, res: Response) => {
  if (!config.features.complianceLegalHold) {
    res.status(503).json({ error: 'FEATURE_COMPLIANCE_LEGAL_HOLD is disabled' });
    return;
  }
  const companyId = getCompanyId(req);
  const userId = req.user?.id;
  if (!companyId || !userId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const { entity_type, entity_id, reason } = req.body || {};
  if (!entity_type || !entity_id || !reason) {
    res.status(400).json({ error: 'entity_type, entity_id, and reason are required' });
    return;
  }
  const hold = await legalHoldService.placeHold({
    companyId,
    entityType: entity_type,
    entityId: entity_id,
    reason,
    placedBy: userId,
  });
  res.status(201).json({ hold });
});

router.post('/legal-holds/:id/release', async (req: AuthRequest, res: Response) => {
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  await legalHoldService.releaseHold(companyId, req.params.id);
  res.json({ released: true });
});

router.post('/dpa/accept', async (req: AuthRequest, res: Response) => {
  if (!config.features.complianceDpa) {
    res.status(503).json({ error: 'FEATURE_COMPLIANCE_DPA is disabled' });
    return;
  }
  const companyId = getCompanyId(req);
  const userId = req.user?.id;
  if (!companyId || !userId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const acceptance = await dpaService.acceptDpa(companyId, userId, req.body?.version);
  res.status(201).json({ acceptance });
});

router.get('/dpa/status', async (req: AuthRequest, res: Response) => {
  const companyId = getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'Company context required' });
    return;
  }
  const latest = await dpaService.getLatestAcceptance(companyId);
  const current = await dpaService.hasAcceptedCurrentVersion(companyId);
  res.json({ latest, current_version_accepted: current });
});

export default router;
