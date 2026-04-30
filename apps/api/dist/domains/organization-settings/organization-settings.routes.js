import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import * as settingsService from './organization-settings.service.js';
import * as fileAccessService from '../file-access/file-access.service.js';
import { buildOrganizationCountrySettingsAggregate } from '../country-pack/country-pack-read-models.service.js';
const router = Router();
const withSettingsRead = [authMiddleware, requireOrg, requirePermission('settings:read', 'access_settings', 'subscriptions:read')];
const withSettingsWrite = [authMiddleware, requireOrg, requirePermission('settings:write', 'access_settings')];
const withSettingsFileRead = [authMiddleware, requireOrg, requirePermission('settings:read', 'access_settings')];
/** GET /api/v1/organizations/:id/files/:fileAssetId/open — secure signed URL; must be settings-linked (logo/signature). */
router.get('/:id/files/:fileAssetId/open', ...withSettingsFileRead, async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId) {
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        }
        const result = await fileAccessService.getSecureOpenUrlForOrgFile(req.context, req.params.id, req.params.fileAssetId, 'settings');
        return res.json(result);
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id/settings/files/:fileAssetId/open', ...withSettingsFileRead, async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId) {
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        }
        const { url } = await settingsService.getSettingsFileOpenUrl(req.context, req.params.id, req.params.fileAssetId);
        return res.json({ url });
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id/settings', ...withSettingsRead, async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId) {
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        }
        const settings = await settingsService.getOrganizationSettings(req.context, req.params.id);
        return res.json(settings);
    }
    catch (e) {
        next(e);
    }
});
// Tenant-safe read-only country configuration view for Organization Settings.
router.get('/:id/country-settings', ...withSettingsRead, async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId) {
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        }
        const aggregate = await buildOrganizationCountrySettingsAggregate(req.context, req.params.id);
        const view = {
            aggregate_key: 'organization_country_settings_aggregate',
            mode: 'read_only',
            managed_by: 'platform_owner',
            organization: aggregate.organization ?? null,
            settings_status: aggregate.settings_status ?? 'not_configured',
            eligible_packs: Array.isArray(aggregate.eligible_packs) ? aggregate.eligible_packs : [],
            active_pack: aggregate.active_pack ?? null,
            active_ruleset: aggregate.active_ruleset ?? null,
            diagnostics: Array.isArray(aggregate.diagnostics) ? aggregate.diagnostics : [],
            warnings: Array.isArray(aggregate.warnings) ? aggregate.warnings : [],
            note: 'Country configuration is managed by platform owner.',
        };
        return res.json(view);
    }
    catch (e) {
        next(e);
    }
});
router.patch('/:id/settings', ...withSettingsWrite, async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId) {
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        }
        const settings = await settingsService.patchOrganizationSettings(req.context, req.params.id, req.body ?? {});
        return res.json(settings);
    }
    catch (e) {
        next(e);
    }
});
export const organizationSettingsRoutes = router;
