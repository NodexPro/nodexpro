/**
 * Work Engine background scheduler (Stage 10 Phase 3D).
 * Processes Work Engine truth only — never scrapes other modules.
 *
 * Modules connect by emitting work_events via intake; this runner:
 *   A) reprocesses pending-mapped events
 *   B–E) SLA recompute + reminder + escalation evaluation per active work_item
 *   F) wakes expired snoozed reminder candidates
 *
 * No auto-send, no approve, no financial/legal computation.
 */
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../../db/client.js';
import { config } from '../../config.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError } from '../../shared/errors.js';
import { reprocessPendingWorkEventsForOrg } from './work-engine.event-intake.service.js';
import { wakeExpiredSnoozedReminderCandidates } from './work-engine.reminder-review.service.js';
import { recomputeWorkItemSlaStatus } from './work-engine.sla.service.js';
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_WORK_ITEMS_PER_RUN = 500;
const DEFAULT_MAX_PENDING_EVENTS_PER_ORG = 50;
let activeSchedulerRun = null;
async function listSchedulerOrgIds(singleOrgId) {
    if (singleOrgId?.trim())
        return [singleOrgId.trim()];
    const seen = new Set();
    const { data: itemRows, error: itemErr } = await supabaseAdmin
        .from('work_items')
        .select('org_id')
        .not('work_state', 'in', '(done,archived)')
        .limit(5000);
    if (itemErr)
        throw itemErr;
    for (const r of itemRows ?? []) {
        const id = String(r.org_id ?? '').trim();
        if (id)
            seen.add(id);
    }
    const { data: eventRows, error: eventErr } = await supabaseAdmin
        .from('work_events')
        .select('org_id')
        .is('work_item_id', null)
        .limit(2000);
    if (eventErr)
        throw eventErr;
    for (const r of eventRows ?? []) {
        const id = String(r.org_id ?? '').trim();
        if (id)
            seen.add(id);
    }
    return [...seen].sort();
}
async function listActiveWorkItemIdsForOrg(orgId, limit) {
    const { data, error } = await supabaseAdmin
        .from('work_items')
        .select('id')
        .eq('org_id', orgId)
        .not('work_state', 'in', '(done,archived)')
        .order('updated_at', { ascending: true })
        .limit(limit);
    if (error)
        throw error;
    return (data ?? []).map((r) => String(r.id));
}
/**
 * Internal cron entry — guarded by X-Internal-Cron-Secret at the route layer.
 */
export async function runWorkEngineScheduler(params) {
    if (!config.internalCronSecret) {
        throw new AppError(503, 'INTERNAL_CRON_SECRET is not configured', 'CRON_MISCONFIGURED');
    }
    if (activeSchedulerRun) {
        return emptySummary({
            skipped: true,
            skipped_reason: 'run_in_progress',
            run_context_key: params?.run_context_key ?? 'scheduler:work_engine',
            dry_run: params?.dry_run === true,
        });
    }
    const runId = randomUUID();
    const runContextKey = String(params?.run_context_key ?? 'scheduler:work_engine').trim();
    const dryRun = params?.dry_run === true;
    const batchSize = Math.min(Math.max(Number(params?.batch_size ?? DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE, 1), 500);
    const maxWorkItems = Math.min(Math.max(Number(params?.max_work_items_per_run ?? DEFAULT_MAX_WORK_ITEMS_PER_RUN) ||
        DEFAULT_MAX_WORK_ITEMS_PER_RUN, 1), 5000);
    const maxPendingEvents = Math.min(Math.max(Number(params?.max_pending_events_per_org ?? DEFAULT_MAX_PENDING_EVENTS_PER_ORG) ||
        DEFAULT_MAX_PENDING_EVENTS_PER_ORG, 1), 500);
    activeSchedulerRun = { runId, startedAt: Date.now() };
    const summary = {
        ok: true,
        run_id: runId,
        run_context_key: runContextKey,
        dry_run: dryRun,
        skipped: false,
        skipped_reason: null,
        scanned_orgs: 0,
        scanned_work_items: 0,
        work_events_reprocessed: 0,
        work_events_resolved: 0,
        recomputed_sla: 0,
        reminders_created: 0,
        escalations_created: 0,
        snoozed_woken: 0,
        errors: [],
    };
    try {
        const orgIds = await listSchedulerOrgIds(params?.org_id);
        summary.scanned_orgs = orgIds.length;
        let remainingWorkItemBudget = maxWorkItems;
        for (const orgId of orgIds) {
            if (remainingWorkItemBudget <= 0)
                break;
            try {
                const pending = await reprocessPendingWorkEventsForOrg({
                    orgId,
                    limit: maxPendingEvents,
                    dryRun,
                });
                summary.work_events_reprocessed += pending.scanned;
                summary.work_events_resolved += pending.resolved;
                if (pending.errors > 0) {
                    summary.errors.push({
                        org_id: orgId,
                        error: `pending_event_reprocess_errors:${pending.errors}`,
                    });
                }
                const orgWorkItemLimit = Math.min(batchSize, remainingWorkItemBudget);
                const workItemIds = await listActiveWorkItemIdsForOrg(orgId, orgWorkItemLimit);
                summary.scanned_work_items += workItemIds.length;
                remainingWorkItemBudget -= workItemIds.length;
                for (const workItemId of workItemIds) {
                    if (dryRun)
                        continue;
                    try {
                        const outcome = await recomputeWorkItemSlaStatus(orgId, workItemId, {
                            actorUserId: null,
                            auditOnStatusChange: true,
                        });
                        summary.recomputed_sla += 1;
                        summary.reminders_created += outcome.reminders.created_candidate_ids.length;
                        if (outcome.escalation.created)
                            summary.escalations_created += 1;
                    }
                    catch (e) {
                        const msg = e instanceof Error ? e.message : String(e ?? 'unknown_error');
                        summary.errors.push({ org_id: orgId, work_item_id: workItemId, error: msg });
                    }
                }
                const wake = await wakeExpiredSnoozedReminderCandidates({
                    orgId,
                    limit: batchSize,
                    dryRun,
                });
                summary.snoozed_woken += wake.woken;
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e ?? 'unknown_error');
                summary.errors.push({ org_id: orgId, error: msg });
            }
        }
        if (!dryRun) {
            await writeAudit({
                organizationId: params?.org_id ?? null,
                actorUserId: null,
                moduleCode: 'work_engine',
                entityType: 'scheduler_run',
                entityId: runId,
                action: AUDIT_ACTIONS.WORK_ENGINE_SCHEDULER_RUN,
                payload: { ...summary },
            });
        }
        return summary;
    }
    finally {
        activeSchedulerRun = null;
    }
}
function emptySummary(opts) {
    return {
        ok: true,
        run_id: randomUUID(),
        run_context_key: opts.run_context_key,
        dry_run: opts.dry_run,
        skipped: opts.skipped,
        skipped_reason: opts.skipped_reason,
        scanned_orgs: 0,
        scanned_work_items: 0,
        work_events_reprocessed: 0,
        work_events_resolved: 0,
        recomputed_sla: 0,
        reminders_created: 0,
        escalations_created: 0,
        snoozed_woken: 0,
        errors: [],
    };
}
