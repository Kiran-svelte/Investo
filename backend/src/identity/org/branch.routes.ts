import { Router, Response } from 'express';

import { authenticate, AuthRequest } from '../../middleware/auth';
import { hasRole } from '../../middleware/rbac';
import { branchService } from '../org/branch.service';
import { countBranchMembers } from '../org/branchScope.service';

const router = Router();

router.use(authenticate);
router.use(hasRole('company_admin'));

router.get('/', async (req: AuthRequest, res: Response) => {
  const companyId = req.user!.company_id;
  const branches = await branchService.list(companyId);
  const branchIds = branches.map((branch) => branch.id);
  const memberCounts = await countBranchMembers(companyId, branchIds);
  const tree = branchService.buildTree(branches);
  res.json({ data: branchService.attachMemberCounts(tree, memberCounts) });
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const branch = await branchService.create(req.user!.company_id, {
      name: req.body?.name,
      parent_id: req.body?.parent_id || null,
      settings: req.body?.settings,
    });
    res.status(201).json({ data: branch });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create branch' });
  }
});

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const branch = await branchService.update(req.user!.company_id, req.params.id, {
      name: req.body?.name,
      parent_id: req.body?.parent_id,
      settings: req.body?.settings,
    });
    res.json({ data: branch });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to update branch' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await branchService.remove(req.user!.company_id, req.params.id);
    res.status(204).send();
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to delete branch' });
  }
});

export default router;
