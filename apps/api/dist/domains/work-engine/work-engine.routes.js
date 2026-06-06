/**
 * Work Engine HTTP routes.
 *
 * Mounted at /api/v1/work-engine.
 *
 * Endpoints (single command surface — no per-command routes):
 *   - GET  /aggregates/foundation   -> work_engine_foundation_aggregate
 *   - GET  /aggregates/queue        -> work_engine_queue_aggregate (Stage 3D);
 *   - GET  /aggregates/invoices-tab -> work_engine_invoices_tab_aggregate (INC-8);
 *   - GET  /aggregates/invoices-client-documents-by-type
 *            -> work_engine_invoices_client_documents_by_type_aggregate;
 *   - GET  /aggregates/clients-tab  -> work_engine_clients_tab_aggregate (embedded CO registry);
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
import { config } from '../../config.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireOrg } from '../../middleware/requireOrg.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { badRequest, forbidden } from '../../shared/errors.js';
import { runWorkEngineScheduler } from './work-engine.scheduler.service.js';
import { executeWorkEngineCommand } from './work-engine.commands.service.js';
import { acceptWorkEngineEvent } from './work-engine.event-intake.service.js';
import { buildWorkEngineFoundationAggregate, buildWorkEngineQueueAggregate, } from './work-engine.read-models.service.js';
import { buildWorkEngineInvoicesTabAggregate } from './work-engine-invoices-tab.read-model.service.js';
import { buildWorkEngineInvoicesClientDocumentsByTypeAggregate } from './work-engine-invoices-client-documents-by-type.read-model.service.js';
import { buildWorkEngineInvoiceRetainerSetupAggregate } from './work-engine-invoice-retainer.read-model.service.js';
import { executeWorkEngineInvoiceRetainerCommand } from './work-engine-invoice-retainer.commands.service.js';
import { buildWorkEngineClientsTabAggregate } from './work-engine-clients-tab.read-model.service.js';
const router = Router();
function requireInternalCronSecret(req) {
    const secret = String(req.headers['x-internal-cron-secret'] ?? '').trim();
    if (!config.internalCronSecret || !secret || secret !== config.internalCronSecret) {
        throw forbidden('Invalid internal cron secret');
    }
}
/** Internal cron trigger (Render Cron Job) — Work Engine background runner. */
router.post('/internal/scheduler/run', async (req, res, next) => {
    try {
        requireInternalCronSecret(req);
        const body = (req.body ?? {});
        const summary = await runWorkEngineScheduler({
            org_id: typeof body.org_id === 'string' ? body.org_id.trim() : undefined,
            batch_size: typeof body.batch_size === 'number' ? body.batch_size : undefined,
            max_work_items_per_run: typeof body.max_work_items_per_run === 'number' ? body.max_work_items_per_run : undefined,
            max_pending_events_per_org: typeof body.max_pending_events_per_org === 'number'
                ? body.max_pending_events_per_org
                : undefined,
            run_context_key: typeof body.run_context_key === 'string' ? body.run_context_key.trim() : undefined,
            dry_run: body.dry_run === true,
        });
        return res.json({
            ok: summary.ok,
            skipped: summary.skipped,
            scanned_work_items: summary.scanned_work_items,
            recomputed_sla: summary.recomputed_sla,
            reminders_created: summary.reminders_created,
            escalations_created: summary.escalations_created,
            snoozed_woken: summary.snoozed_woken,
            errors: summary.errors,
            result: summary,
        });
    }
    catch (e) {
        console.error('[work-engine] POST /internal/scheduler/run failed', e);
        next(e);
    }
});
const officeRouter = Router();
officeRouter.use(authMiddleware, requireOrg);
officeRouter.get('/aggregates/foundation', async (req, res, next) => {
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
officeRouter.get('/aggregates/queue', async (req, res, next) => {
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
officeRouter.get('/aggregates/invoices-tab', async (req, res, next) => {
    try {
        const ctx = req.context;
        const aggregate = await buildWorkEngineInvoicesTabAggregate({ ctx });
        return res.json(aggregate);
    }
    catch (e) {
        next(e);
    }
});
officeRouter.get('/aggregates/invoices-client-documents-by-type', async (req, res, next) => {
    try {
        const ctx = req.context;
        const representedClientId = String(req.query.represented_client_id ?? '').trim();
        const documentTypeKey = String(req.query.document_type_key ?? '').trim();
        const yearRaw = req.query.year;
        const year = yearRaw != null && String(yearRaw).trim() !== '' ? Number(yearRaw) : null;
        if (year != null && !Number.isFinite(year)) {
            throw badRequest('year must be a number');
        }
        const aggregate = await buildWorkEngineInvoicesClientDocumentsByTypeAggregate({
            ctx,
            representedClientId,
            documentTypeKey,
            year,
        });
        return res.json(aggregate);
    }
    catch (e) {
        next(e);
    }
});
officeRouter.get('/aggregates/invoice-retainer-setup', async (req, res, next) => {
    try {
        const ctx = req.context;
        const representedClientId = String(req.query.represented_client_id ?? '').trim();
        const endCustomerId = String(req.query.end_customer_id ?? '').trim() || null;
        const aggregate = await buildWorkEngineInvoiceRetainerSetupAggregate({
            ctx,
            representedClientId,
            endCustomerId,
        });
        return res.json(aggregate);
    }
    catch (e) {
        next(e);
    }
});
officeRouter.post('/commands/invoice-retainer', async (req, res, next) => {
    try {
        const ctx = req.context;
        const command = String(req.body?.command ?? '').trim();
        const payload = (req.body?.payload ?? req.body ?? {});
        const out = await executeWorkEngineInvoiceRetainerCommand(ctx, command, payload);
        return res.json(out);
    }
    catch (e) {
        next(e);
    }
});
officeRouter.get('/aggregates/clients-tab', requirePermission('client_operations.view'), async (req, res, next) => {
    try {
        const ctx = req.context;
        const aggregate = await buildWorkEngineClientsTabAggregate({ ctx });
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
officeRouter.post('/commands', async (req, res, next) => {
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
officeRouter.post('/events/intake', async (req, res, next) => {
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
router.use(officeRouter);
export const workEngineRoutes = router;
