/**
 * Work Engine HTTP routes.
 *
 * Mounted at /api/v1/work-engine.
 *
 * Endpoints (single command surface — no per-command routes):
 *   - GET  /aggregates/foundation   -> work_engine_foundation_aggregate
 *   - GET  /aggregates/queue        -> work_engine_queue_aggregate (Stage 3D);
 *                                      backend-ready queue table with rows,
 *                                      summary_cards, filters, pagination,
 *                                      pending_mapping_section. Supports
 *                                      filter query params:
 *                                        state, module_key, assigned_user_id,
 *                                        reviewer_user_id, client_id,
 *                                        period_key, limit, offset.
 *   - POST /commands                -> generic command endpoint; body shape:
 *                                      { command: <WorkEngineCommandType>,
 *                                        payload: <command-specific payload> }
 *                                      Optional on payload: `refresh_aggregate`
 *                                      (`work_engine_foundation_aggregate` default,
 *                                      or `work_engine_queue_aggregate` for full
 *                                      queue refresh) and `aggregate_filters` (same
 *                                      shape as GET /aggregates/queue query params)
 *                                      when returning the queue aggregate.
 *                                      Stage 3A event intake uses this endpoint with
 *                                      `command: "intake_work_event"`.
 *   - POST /events/intake           -> Stage 2 raw envelope intake (audit-only;
 *                                      no work_item creation). Emitters should prefer
 *                                      POST /commands with command="intake_work_event".
 *
 * Routes only validate body shape and dispatch. NO workflow decisions live here.
 * No PATCH/PUT. Aggregate GET returns full ready-to-render truth. Every command
 * returns a refreshed aggregate.
 */
import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { badRequest } from '../../shared/errors.js';
import { executeWorkEngineCommand } from './work-engine.commands.service.js';
import { acceptWorkEngineEvent } from './work-engine.event-intake.service.js';
import { buildWorkEngineFoundationAggregate, buildWorkEngineQueueAggregate, } from './work-engine.read-models.service.js';
const router = Router();
router.use(authMiddleware, requireOrg);
router.get('/aggregates/foundation', async (req, res, next) => {
    try {
        const ctx = req.context;
        const orgId = ctx.organizationId;
        const aggregate = await buildWorkEngineFoundationAggregate({ orgId });
        return res.json(aggregate);
    }
    catch (e) {
        next(e);
    }
});
// Stage 3D — backend-ready queue aggregate. Query params are read here so the
// route owns parsing; the read-models service owns validation/clamping of
// values (limit caps, unknown state values, etc.).
router.get('/aggregates/queue', async (req, res, next) => {
    try {
        const ctx = req.context;
        const orgId = ctx.organizationId;
        const q = req.query;
        const filters = {
            state: typeof q.state === 'string' ? q.state : null,
            module_key: typeof q.module_key === 'string' ? q.module_key : null,
            assigned_user_id: typeof q.assigned_user_id === 'string' ? q.assigned_user_id : null,
            reviewer_user_id: typeof q.reviewer_user_id === 'string' ? q.reviewer_user_id : null,
            client_id: typeof q.client_id === 'string' ? q.client_id : null,
            period_key: typeof q.period_key === 'string' ? q.period_key : null,
            queue_bucket: typeof q.queue_bucket === 'string' ? q.queue_bucket : null,
            limit: typeof q.limit === 'string' && q.limit.trim() !== ''
                ? Number(q.limit)
                : null,
            offset: typeof q.offset === 'string' && q.offset.trim() !== ''
                ? Number(q.offset)
                : null,
        };
        const aggregate = await buildWorkEngineQueueAggregate({
            orgId,
            filters,
            viewer: ctx.membership && ctx.user
                ? {
                    userId: ctx.user.id,
                    permissions: ctx.membership.permissions ?? [],
                    roleCode: ctx.membership.roleCode,
                }
                : undefined,
        });
        return res.json(aggregate);
    }
    catch (e) {
        next(e);
    }
});
const ALLOWED_COMMANDS = new Set([
    'create_work_item',
    'assign_work_item',
    'pick_up_unassigned',
    'transfer_work_item',
    'claim_work_item',
    'release_claim',
    'request_review',
    'approve_work_item',
    'reject_work_item',
    'generate_reminder_candidate',
    'edit_reminder_candidate',
    'approve_send_reminder_candidate',
    'cancel_reminder_candidate',
    'snooze_reminder_candidate',
    'escalate_work_item',
    'acknowledge_escalation',
    'resolve_escalation',
    'reassign_escalation_owner',
    'change_work_state',
    'set_work_deadline',
    'append_work_event',
    'apply_work_override',
    'intake_work_event',
]);
router.post('/commands', async (req, res, next) => {
    try {
        const ctx = req.context;
        const command = String(req.body?.command ?? '').trim();
        if (!command)
            throw badRequest('command is required');
        if (!ALLOWED_COMMANDS.has(command)) {
            throw badRequest(`Unknown work engine command: ${command}`);
        }
        const payload = req.body?.payload ?? req.body ?? {};
        const out = await executeWorkEngineCommand(ctx, command, payload);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
router.post('/events/intake', async (req, res, next) => {
    try {
        const ctx = req.context;
        const env = (req.body ?? {});
        if (!env || typeof env !== 'object') {
            throw badRequest('event envelope is required');
        }
        // Authenticated org context must match the envelope's org_id.
        if (env.org_id !== ctx.organizationId) {
            throw badRequest('event.org_id must match the authenticated organization', 'event_org_mismatch');
        }
        const out = await acceptWorkEngineEvent(env);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
export const workEngineRoutes = router;
