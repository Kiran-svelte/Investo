import { Router, Response } from 'express';

import { scimAuthMiddleware, ScimRequest } from '../scim/scimAuth.middleware';
import { scimService } from '../scim/scim.service';

const router = Router();

router.use(scimAuthMiddleware);

router.get('/Users', async (req: ScimRequest, res: Response) => {
  const startIndex = Number(req.query.startIndex || 1);
  const count = Number(req.query.count || 100);
  const payload = await scimService.listUsers(req.scimCompanyId!, startIndex, count);
  res.json(payload);
});

router.post('/Users', async (req: ScimRequest, res: Response) => {
  try {
    const user = await scimService.createUser(req.scimCompanyId!, req.body);
    res.status(201).json(user);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      detail: err.message,
      status: String(err.statusCode || 500),
    });
  }
});

router.patch('/Users/:id', async (req: ScimRequest, res: Response) => {
  try {
    const user = await scimService.patchUser(req.scimCompanyId!, req.params.id, req.body);
    res.json(user);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      detail: err.message,
      status: String(err.statusCode || 500),
    });
  }
});

router.delete('/Users/:id', async (req: ScimRequest, res: Response) => {
  try {
    await scimService.deleteUser(req.scimCompanyId!, req.params.id);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      detail: err.message,
      status: String(err.statusCode || 500),
    });
  }
});

export default router;
