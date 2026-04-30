import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import * as subscriptionsService from './subscriptions.service.js';

const router = Router();

router.get('/:id/subscription', authMiddleware, requireOrg, requirePermission('subscriptions:read'), async (req, res, next) => {
  try {
    if (req.params.id !== req.context!.organizationId) return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
    const sub = await subscriptionsService.getCurrentSubscription(req.context!, req.params.id);
    return res.json(sub ?? null);
  } catch (e) {
    next(e);
  }
});

export const subscriptionsRoutes = router;
