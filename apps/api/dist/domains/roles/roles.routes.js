import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import * as rolesService from './roles.service.js';
const router = Router();
router.get('/:id/roles', authMiddleware, requireOrg, requirePermission('roles:read', 'view_users'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId)
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        const list = await rolesService.listRoles();
        return res.json(list);
    }
    catch (e) {
        next(e);
    }
});
export const rolesRoutes = router;
