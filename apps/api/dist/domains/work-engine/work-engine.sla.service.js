/**
 * Stage 10 Phase 3A — operational SLA obligations + sla_status recompute.
 * No reminders, escalation, scheduler, or legal deadlines.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { DEFAULT_SLA_POLICY, resolveWorkTypeSlaPolicy, } from './work-engine.policy.service.js';
export const SLA_OBLIGATION_KINDS = ['response', 'waiting_client', 'review'];
export const SLA_OBLIGATION_STATUSES = ['active', 'met', 'breached', 'cancelled'];
function addMinutes(iso, minutes) {
    return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
function obligationKindLabel(kind) {
    switch (kind) {
        case 'response':
            return 'Response';
        case 'waiting_client':
            return 'Client wait';
        case 'review':
            return 'Review';
        default:
            return kind;
    }
}
function obligationBadgeTone(status, dueAt, nowMs, dueSoonThresholdMinutes) {
    if (status === 'breached')
        return 'danger';
    if (status !== 'active')
        return 'neutral';
    const dueMs = new Date(dueAt).getTime();
    if (dueMs < nowMs)
        return 'danger';
    if (dueMs <= nowMs + dueSoonThresholdMinutes * 60_000)
        return 'warn';
    return 'neutral';
}
async function auditSla(orgId, actorUserId, workItemId, action, payload) {
    await writeAudit({
        organizationId: orgId,
        actorUserId,
        moduleCode: 'work_engine',
        entityType: 'work_item',
        entityId: workItemId,
        action,
        payload,
    });
}
async function cancelActiveObligation(orgId, workItemId, kind, reason) {
    const { error } = await supabaseAdmin
        .from('work_sla_obligations')
        .update({
        status: 'cancelled',
        paused_at: null,
        pause_reason: null,
    })
        .eq('org_id', orgId)
        .eq('work_item_id', workItemId)
        .eq('kind', kind)
        .eq('status', 'active');
    if (error)
        throw error;
    void reason;
}
async function markActiveObligationMet(orgId, workItemId, kind) {
    const { data, error } = await supabaseAdmin
        .from('work_sla_obligations')
        .update({
        status: 'met',
        paused_at: null,
        pause_reason: null,
    })
        .eq('org_id', orgId)
        .eq('work_item_id', workItemId)
        .eq('kind', kind)
        .eq('status', 'active')
        .select('id');
    if (error)
        throw error;
    return (data?.length ?? 0) > 0;
}
export async function hasActiveObligation(orgId, workItemId, kind) {
    const { count, error } = await supabaseAdmin
        .from('work_sla_obligations')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('work_item_id', workItemId)
        .eq('kind', kind)
        .eq('status', 'active');
    if (error)
        throw error;
    return (count ?? 0) > 0;
}
/** Start response SLA only when none is active (idempotent for Start work / claim). */
export async function startResponseObligationIfAbsent(args) {
    if (await hasActiveObligation(args.orgId, args.workItemId, 'response')) {
        return false;
    }
    const policy = await resolveWorkTypeSlaPolicy(args.orgId, args.workType);
    await startObligation({
        orgId: args.orgId,
        workItemId: args.workItemId,
        kind: 'response',
        durationMinutes: policy.response_sla_minutes,
        sourceTransitionId: args.sourceTransitionId,
        actorUserId: args.actorUserId,
        policy,
    });
    return true;
}
async function startObligation(args) {
    await cancelActiveObligation(args.orgId, args.workItemId, args.kind, 'superseded');
    const startsAt = new Date().toISOString();
    const dueAt = addMinutes(startsAt, args.durationMinutes);
    const { data, error } = await supabaseAdmin
        .from('work_sla_obligations')
        .insert({
        org_id: args.orgId,
        work_item_id: args.workItemId,
        kind: args.kind,
        policy_version_id: null,
        starts_at: startsAt,
        due_at: dueAt,
        paused_at: null,
        pause_reason: null,
        status: 'active',
        breached_at: null,
        source_transition_id: args.sourceTransitionId,
    })
        .select('id')
        .single();
    if (error)
        throw error;
    await auditSla(args.orgId, args.actorUserId, args.workItemId, AUDIT_ACTIONS.WORK_ITEM_SLA_OBLIGATION_STARTED, {
        obligation_id: data.id,
        kind: args.kind,
        starts_at: startsAt,
        due_at: dueAt,
        duration_minutes: args.durationMinutes,
        response_sla_minutes: args.policy.response_sla_minutes,
        review_sla_minutes: args.policy.review_sla_minutes,
        waiting_client_timeout_minutes: args.policy.waiting_client_timeout_minutes,
    });
}
export async function loadActiveSlaObligationsForItems(orgId, workItemIds) {
    const map = new Map();
    if (workItemIds.length === 0)
        return map;
    const { data, error } = await supabaseAdmin
        .from('work_sla_obligations')
        .select('*')
        .eq('org_id', orgId)
        .in('work_item_id', workItemIds)
        .in('status', ['active', 'breached']);
    if (error)
        throw error;
    for (const row of (data ?? [])) {
        const list = map.get(row.work_item_id) ?? [];
        list.push(row);
        map.set(row.work_item_id, list);
    }
    return map;
}
/** Ready-to-render DUE column text (status line + optional relative due hint). */
export function buildDueQueueCellText(slaStatus, slaStatusLabel, primaryDueAtIso) {
    if (slaStatus === 'none')
        return null;
    const relative = formatOperationalDueRelative(primaryDueAtIso);
    if (relative)
        return `${slaStatusLabel}\n${relative}`;
    return slaStatusLabel;
}
/** Backend-only relative due hint for queue DUE column (no frontend date math). */
export function formatOperationalDueRelative(iso) {
    if (!iso)
        return null;
    const dueMs = new Date(iso).getTime();
    if (Number.isNaN(dueMs))
        return null;
    const deltaMs = dueMs - Date.now();
    const absHours = Math.max(1, Math.round(Math.abs(deltaMs) / 3_600_000));
    if (deltaMs > 0) {
        if (absHours < 24)
            return `Due in ${absHours}h`;
        const days = Math.round(absHours / 24);
        if (days === 1)
            return 'Due tomorrow';
        return `Due in ${days}d`;
    }
    if (absHours < 24)
        return `${absHours}h past due`;
    return 'Past due';
}
export function buildQueueSlaPresentation(obligations, slaStatus, workItemDueAt, policy = DEFAULT_SLA_POLICY) {
    const nowMs = Date.now();
    const activeOrBreached = obligations.filter((o) => o.status === 'active' || o.status === 'breached');
    const sla_badges = activeOrBreached.map((o) => ({
        kind: o.kind,
        label: `${obligationKindLabel(o.kind)} · ${formatSlaDueLabel(o.due_at)}`,
        tone: obligationBadgeTone(o.status, o.due_at, nowMs, policy.due_soon_threshold_minutes),
    }));
    const primary = activeOrBreached.find((o) => o.kind === 'response') ??
        activeOrBreached.find((o) => o.kind === 'review') ??
        activeOrBreached[0];
    const primaryIso = primary?.due_at ?? workItemDueAt;
    const primary_due_at_label = primaryIso && slaStatus !== 'none' ? formatSlaDueLabel(primaryIso) : null;
    return { sla_badges, primary_due_at_label };
}
function formatSlaDueLabel(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime()))
        return iso;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
async function markDueActiveObligationsBreached(orgId, workItemId, actorUserId) {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabaseAdmin
        .from('work_sla_obligations')
        .select('id, kind, due_at, paused_at')
        .eq('org_id', orgId)
        .eq('work_item_id', workItemId)
        .eq('status', 'active')
        .lt('due_at', nowIso);
    if (error)
        throw error;
    for (const row of data ?? []) {
        if (row.paused_at)
            continue;
        const id = String(row.id);
        const kind = String(row.kind);
        const { error: updErr } = await supabaseAdmin
            .from('work_sla_obligations')
            .update({
            status: 'breached',
            breached_at: nowIso,
        })
            .eq('id', id)
            .eq('org_id', orgId)
            .eq('status', 'active');
        if (updErr)
            throw updErr;
        await auditSla(orgId, actorUserId, workItemId, AUDIT_ACTIONS.WORK_ITEM_SLA_OBLIGATION_BREACHED, {
            obligation_id: id,
            kind,
            breached_at: nowIso,
        });
    }
}
function computeSlaStatusFromObligations(obligations, policy) {
    const nowMs = Date.now();
    const active = obligations.filter((o) => o.status === 'active' && !o.paused_at);
    const breached = obligations.filter((o) => o.status === 'breached');
    if (active.length === 0 && breached.length === 0)
        return 'none';
    if (breached.length > 0)
        return 'breached';
    if (active.some((o) => new Date(o.due_at).getTime() < nowMs))
        return 'overdue';
    const thresholdMs = policy.due_soon_threshold_minutes * 60_000;
    if (active.some((o) => {
        const dueMs = new Date(o.due_at).getTime();
        return dueMs >= nowMs && dueMs <= nowMs + thresholdMs;
    })) {
        return 'due_soon';
    }
    return 'on_track';
}
export async function recomputeWorkItemSlaStatus(orgId, workItemId, opts) {
    const { data: item, error: itemErr } = await supabaseAdmin
        .from('work_items')
        .select('id, org_id, work_type, sla_status, due_at, version')
        .eq('id', workItemId)
        .eq('org_id', orgId)
        .maybeSingle();
    if (itemErr)
        throw itemErr;
    if (!item)
        return 'none';
    const workType = String(item.work_type);
    const policy = await resolveWorkTypeSlaPolicy(orgId, workType);
    const previousStatus = String(item.sla_status);
    await markDueActiveObligationsBreached(orgId, workItemId, opts?.actorUserId ?? null);
    const { data: rows, error: obErr } = await supabaseAdmin
        .from('work_sla_obligations')
        .select('*')
        .eq('org_id', orgId)
        .eq('work_item_id', workItemId)
        .in('status', ['active', 'breached']);
    if (obErr)
        throw obErr;
    const obligations = (rows ?? []);
    const nextStatus = computeSlaStatusFromObligations(obligations, policy);
    const primaryDue = obligations.find((o) => o.status === 'active' && o.kind === 'response')?.due_at ??
        obligations.find((o) => o.status === 'active' && o.kind === 'review')?.due_at ??
        obligations.find((o) => o.status === 'active')?.due_at ??
        null;
    const patch = { sla_status: nextStatus };
    if (primaryDue != null)
        patch.due_at = primaryDue;
    const { error: updErr } = await supabaseAdmin
        .from('work_items')
        .update(patch)
        .eq('id', workItemId)
        .eq('org_id', orgId);
    if (updErr)
        throw updErr;
    if (opts?.auditOnStatusChange && nextStatus !== previousStatus) {
        await auditSla(orgId, opts.actorUserId ?? null, workItemId, AUDIT_ACTIONS.WORK_ITEM_SLA_STATUS_RECOMPUTED, {
            from_sla_status: previousStatus,
            to_sla_status: nextStatus,
        });
    }
    return nextStatus;
}
/** Command-time SLA obligation hooks (Phase 3A). */
export async function applySlaHooksForCommand(args) {
    const policy = await resolveWorkTypeSlaPolicy(args.orgId, args.workType);
    switch (args.command) {
        case 'pick_up_unassigned':
        case 'assign_work_item': {
            await startObligation({
                orgId: args.orgId,
                workItemId: args.workItemId,
                kind: 'response',
                durationMinutes: policy.response_sla_minutes,
                sourceTransitionId: args.transitionId,
                actorUserId: args.actorUserId,
                policy,
            });
            break;
        }
        case 'claim_work_item': {
            await startResponseObligationIfAbsent({
                orgId: args.orgId,
                workItemId: args.workItemId,
                sourceTransitionId: args.transitionId,
                actorUserId: args.actorUserId,
                workType: args.workType,
            });
            break;
        }
        case 'request_review': {
            await cancelActiveObligation(args.orgId, args.workItemId, 'response', 'review_requested');
            await startObligation({
                orgId: args.orgId,
                workItemId: args.workItemId,
                kind: 'review',
                durationMinutes: policy.review_sla_minutes,
                sourceTransitionId: args.transitionId,
                actorUserId: args.actorUserId,
                policy,
            });
            break;
        }
        case 'approve_work_item':
        case 'reject_work_item': {
            const met = await markActiveObligationMet(args.orgId, args.workItemId, 'review');
            if (met) {
                await auditSla(args.orgId, args.actorUserId, args.workItemId, AUDIT_ACTIONS.WORK_ITEM_SLA_OBLIGATION_MET, { kind: 'review', command: args.command });
            }
            await startObligation({
                orgId: args.orgId,
                workItemId: args.workItemId,
                kind: 'response',
                durationMinutes: policy.response_sla_minutes,
                sourceTransitionId: args.transitionId,
                actorUserId: args.actorUserId,
                policy,
            });
            break;
        }
        case 'change_work_state': {
            if (args.toState === 'waiting_client') {
                await cancelActiveObligation(args.orgId, args.workItemId, 'response', 'waiting_client');
                await startObligation({
                    orgId: args.orgId,
                    workItemId: args.workItemId,
                    kind: 'waiting_client',
                    durationMinutes: policy.waiting_client_timeout_minutes,
                    sourceTransitionId: args.transitionId,
                    actorUserId: args.actorUserId,
                    policy,
                });
            }
            break;
        }
        default:
            break;
    }
    await recomputeWorkItemSlaStatus(args.orgId, args.workItemId, {
        actorUserId: args.actorUserId,
        auditOnStatusChange: true,
    });
}
