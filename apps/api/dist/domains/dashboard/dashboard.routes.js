import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import * as dashboardService from './dashboard.service.js';
const router = Router();
router.get('/summary', authMiddleware, requireOrg, async (req, res, next) => {
    try {
        const summary = await dashboardService.getDashboardSummary(req.context);
        return res.json(summary);
    }
    catch (e) {
        next(e);
    }
});
router.get('/overview', authMiddleware, requireOrg, async (req, res, next) => {
    try {
        const overview = await dashboardService.getDashboardOverview(req.context);
        return res.json(overview);
    }
    catch (e) {
        next(e);
    }
});
export const dashboardRoutes = router;
