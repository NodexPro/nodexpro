import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { supabaseAdmin } from '../../db/client.js';
import * as trialService from './trial.service.js';
import * as legalIdentityService from './legal-identity.service.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
const router = Router();
router.get('/:id/trial', authMiddleware, requireOrg, requirePermission('subscriptions:read'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId) {
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        }
        const state = await trialService.getTrialState(req.params.id);
        return res.json(state);
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id/owner-identity', authMiddleware, requireOrg, requirePermission('subscriptions:read'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId) {
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        }
        const owner = await legalIdentityService.getOwnerIdentityForSettings(req.params.id);
        return res.json(owner ?? {});
    }
    catch (e) {
        next(e);
    }
});
/** Company legal identity summary (alias for Settings UI). */
router.get('/:id/settings/company/legal-identity', authMiddleware, requireOrg, requirePermission('subscriptions:read'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId) {
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        }
        const owner = await legalIdentityService.getOwnerIdentityForSettings(req.params.id);
        const trial = await trialService.getTrialState(req.params.id);
        return res.json({
            ...(owner ?? {}),
            trialStatus: trial.trialStatus,
            trialEndsAt: trial.endsAt,
            daysRemaining: trial.daysRemaining ?? null,
        });
    }
    catch (e) {
        next(e);
    }
});
router.post('/:id/legal-identity', authMiddleware, requireOrg, requirePermission('modules:write'), async (req, res, next) => {
    try {
        if (req.params.id !== req.context.organizationId) {
            return res.status(403).json({ code: 'FORBIDDEN', message: 'Organization context required' });
        }
        const { countryCode, legalIdentityType, value } = req.body;
        if (!countryCode || !legalIdentityType || value == null || value === '') {
            return res.status(400).json({ code: 'BAD_REQUEST', message: 'countryCode, legalIdentityType, and value required' });
        }
        await writeAudit({
            organizationId: req.params.id,
            actorUserId: req.context.user.id,
            entityType: 'trial',
            action: AUDIT_ACTIONS.TRIAL_START_REQUESTED,
            payload: { countryCode, legalIdentityType },
        });
        let normalized;
        let hash;
        let masked;
        try {
            const out = legalIdentityService.normalizeAndHash(countryCode, legalIdentityType, value);
            normalized = out.normalized;
            hash = out.hash;
            masked = out.masked;
        }
        catch (e) {
            await writeAudit({
                organizationId: req.params.id,
                actorUserId: req.context.user.id,
                entityType: 'trial',
                action: AUDIT_ACTIONS.TRIAL_DENIED_INVALID_IDENTITY,
                payload: { reason: e instanceof Error ? e.message : 'Invalid identity format' },
            });
            return res.status(400).json({
                code: 'BAD_REQUEST',
                message: e instanceof Error ? e.message : 'Invalid legal identity format',
            });
        }
        const alreadyUsed = await legalIdentityService.isTrialAlreadyUsed(hash);
        if (alreadyUsed) {
            const { data: thisOrgTrial } = await supabaseAdmin
                .from('organization_trials')
                .select('id, status, ends_at, legal_identity_hash')
                .eq('organization_id', req.params.id)
                .eq('trial_scope', 'full_platform')
                .maybeSingle();
            if (thisOrgTrial && thisOrgTrial.legal_identity_hash === hash && thisOrgTrial.status === 'trialing') {
                return res.status(200).json({
                    success: true,
                    trialStarted: true,
                    trialEndsAt: thisOrgTrial.ends_at ?? undefined,
                    blocked: false,
                });
            }
            await writeAudit({
                organizationId: req.params.id,
                actorUserId: req.context.user.id,
                entityType: 'trial',
                action: AUDIT_ACTIONS.TRIAL_DENIED_ALREADY_USED,
                payload: { reason: 'duplicate_legal_entity' },
            });
            return res.status(400).json({
                code: 'TRIAL_DENIED',
                message: 'A full-platform trial has already been used for this legal identity.',
            });
        }
        await legalIdentityService.setLegalIdentity(req.params.id, countryCode, legalIdentityType, value.trim());
        await writeAudit({
            organizationId: req.params.id,
            actorUserId: req.context.user.id,
            entityType: 'legal_identity',
            action: AUDIT_ACTIONS.ORGANIZATION_LEGAL_IDENTITY_SET,
            payload: { countryCode, legalIdentityType },
        });
        const result = await trialService.startTrial(req.context, req.params.id, hash);
        if (result.started) {
            await legalIdentityService.lockAndSetMasked(req.params.id, masked);
            await writeAudit({
                organizationId: req.params.id,
                actorUserId: req.context.user.id,
                entityType: 'legal_identity',
                action: AUDIT_ACTIONS.LEGAL_IDENTITY_LOCKED,
                payload: {},
            });
        }
        return res.status(200).json({
            success: true,
            trialStarted: result.started,
            trialEndsAt: result.endsAt ?? undefined,
            blocked: result.blocked,
            message: result.message,
        });
    }
    catch (e) {
        next(e);
    }
});
export const trialRoutes = router;
