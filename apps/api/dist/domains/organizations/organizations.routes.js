import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import * as organizationsService from './organizations.service.js';
const router = Router();
const lastCreateByUser = new Map();
const CREATE_COOLDOWN_MS = 2500;
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        const ctx = req.context;
        const now = Date.now();
        const last = lastCreateByUser.get(ctx.user.id);
        if (last != null && now - last < CREATE_COOLDOWN_MS) {
            return res.status(429).json({ code: 'TOO_MANY_REQUESTS', message: 'Please wait a moment before creating another organization.' });
        }
        const { name, legalName, countryCode, timezone } = req.body ?? {};
        if (!name || !countryCode)
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'name and countryCode required' });
        const org = await organizationsService.createOrganization(ctx, { name, legalName, countryCode, timezone });
        lastCreateByUser.set(ctx.user.id, now);
        return res.status(201).json(org);
    }
    catch (e) {
        next(e);
    }
});
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const list = await organizationsService.listMyOrganizations(req.context.user.id);
        return res.json(list);
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id', authMiddleware, async (req, res, next) => {
    try {
        const org = await organizationsService.getOrganization(req.context, req.params.id);
        return res.json(org);
    }
    catch (e) {
        next(e);
    }
});
export const organizationsRoutes = router;
