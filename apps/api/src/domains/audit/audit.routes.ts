import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import * as auditService from './audit.service.js';

const router = Router();

router.get('/:id/audit', authMiddleware, requireOrg, requirePermission('audit:read'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const list = await auditService.listAudit(req.context!, req.params.id, limit, offset);
    return res.json(list);
  } catch (e) {
    next(e);
  }
});

export const auditRoutes = router;
