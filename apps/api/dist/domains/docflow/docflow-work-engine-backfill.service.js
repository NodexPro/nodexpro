/**
 * Stage 6 — Backfill existing DocFlow task-center threads into Work Engine via
 * `emitDocflowThreadNeedsAttentionWithIntakeResult` (same intake path as Stage 5).
 *
 * Read-only on DocFlow tables from this module except Work Engine intake side effects.
 * No frontend. No direct work_items INSERT.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AppError } from '../../shared/errors.js';
import { loadOrgMembershipForUser } from '../auth/active-organization.service.js';
import { emitDocflowThreadNeedsAttentionWithIntakeResult, } from './docflow-work-engine-bridge.js';
async function threadIdsWithUnreadClientReply(orgId, threadIds) {
    if (!threadIds.length)
        return new Set();
    const { data: events, error: evErr } = await supabaseAdmin
        .from('client_message_events')
        .select('thread_id, created_at')
        .eq('org_id', orgId)
        .eq('event_type', 'thread_read_marked_office')
        .in('thread_id', threadIds)
        .order('created_at', { ascending: false });
    if (evErr)
        throw evErr;
    const lastReadMs = new Map();
    for (const e of events ?? []) {
        const tid = String(e.thread_id);
        if (!lastReadMs.has(tid))
            lastReadMs.set(tid, new Date(String(e.created_at)).getTime());
    }
    const { data: msgs, error: mErr } = await supabaseAdmin
        .from('client_messages')
        .select('thread_id, created_at')
        .eq('org_id', orgId)
        .eq('message_status', 'published')
        .neq('created_by_type', 'office')
        .in('thread_id', threadIds);
    if (mErr)
        throw mErr;
    const maxMsgMs = new Map();
    for (const m of msgs ?? []) {
        const tid = String(m.thread_id);
        const ts = new Date(String(m.created_at)).getTime();
        const cur = maxMsgMs.get(tid) ?? 0;
        if (ts > cur)
            maxMsgMs.set(tid, ts);
    }
    const out = new Set();
    for (const tid of threadIds) {
        const msgMax = maxMsgMs.get(tid);
        if (msgMax === undefined)
            continue;
        const readTs = lastReadMs.get(tid) ?? Number.NEGATIVE_INFINITY;
        if (msgMax > readTs)
            out.add(tid);
    }
    return out;
}
function mapThreadRow(raw) {
    const id = String(raw.id ?? '').trim();
    const org_id = String(raw.org_id ?? '').trim();
    const client_id = String(raw.client_id ?? '').trim();
    if (!id || !org_id || !client_id)
        return null;
    return {
        id,
        org_id,
        client_id,
        thread_status: String(raw.thread_status ?? ''),
        thread_type: String(raw.thread_type ?? ''),
        module_key: raw.module_key != null ? String(raw.module_key) : null,
        updated_at: String(raw.updated_at ?? ''),
    };
}
async function filterThreadsClientInOrg(orgId, rows) {
    const clientIds = [...new Set(rows.map((r) => String(r.client_id ?? '').trim()).filter(Boolean))];
    if (!clientIds.length)
        return [];
    const { data: clients, error: cErr } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('organization_id', orgId)
        .in('id', clientIds);
    if (cErr)
        throw cErr;
    const allowed = new Set((clients ?? []).map((c) => String(c.id)));
    const out = [];
    for (const r of rows) {
        const m = mapThreadRow(r);
        if (!m || !allowed.has(m.client_id))
            continue;
        out.push(m);
    }
    return out;
}
/**
 * Eligibility (task-center aligned, backend-only):
 * - Non-archived `client_message_threads` for ORG_ID
 * - Client belongs to org (`clients.organization_id` = org) via inner join
 * - Include: thread_status in open | waiting_office | waiting_client
 * - Include: thread_status = resolved AND unread client reply (same rule as
 *   docflow_task_center_metrics.unread_replies_count: published non-office message
 *   after last thread_read_marked_office or never marked)
 * - Exclude: archived; resolved without unread; malformed ids
 */
export async function fetchEligibleDocflowThreadsForWorkEngineBackfill(orgId, limit) {
    const activeStatuses = ['open', 'waiting_office', 'waiting_client'];
    const cap = Math.max(1, Math.min(limit, 5000));
    const { data: activeRaw, error: aErr } = await supabaseAdmin
        .from('client_message_threads')
        .select('id, org_id, client_id, thread_status, thread_type, module_key, updated_at')
        .eq('org_id', orgId)
        .in('thread_status', activeStatuses)
        .order('updated_at', { ascending: false })
        .limit(cap);
    if (aErr)
        throw aErr;
    let scanned = (activeRaw ?? []).length;
    const activeThreads = await filterThreadsClientInOrg(orgId, (activeRaw ?? []));
    const resolvedEligible = [];
    const page = 200;
    let offset = 0;
    const maxResolvedScan = Math.max(cap * 20, 2000);
    while (resolvedEligible.length < cap && offset < maxResolvedScan) {
        const { data: resBatch, error: rErr } = await supabaseAdmin
            .from('client_message_threads')
            .select('id, org_id, client_id, thread_status, thread_type, module_key, updated_at')
            .eq('org_id', orgId)
            .eq('thread_status', 'resolved')
            .order('updated_at', { ascending: false })
            .range(offset, offset + page - 1);
        if (rErr)
            throw rErr;
        const batch = resBatch ?? [];
        scanned += batch.length;
        if (!batch.length)
            break;
        const inOrg = await filterThreadsClientInOrg(orgId, batch);
        const ids = inOrg.map((t) => t.id);
        const unread = await threadIdsWithUnreadClientReply(orgId, ids);
        for (const row of inOrg) {
            if (!unread.has(row.id))
                continue;
            resolvedEligible.push(row);
            if (resolvedEligible.length >= cap)
                break;
        }
        if (resolvedEligible.length >= cap)
            break;
        if (!batch.length || batch.length < page)
            break;
        offset += page;
    }
    const seen = new Set();
    const merged = [];
    const pushUnique = (t) => {
        if (seen.has(t.id))
            return;
        seen.add(t.id);
        merged.push(t);
    };
    for (const t of activeThreads)
        pushUnique(t);
    for (const t of resolvedEligible)
        pushUnique(t);
    merged.sort((a, b) => {
        const ta = new Date(a.updated_at).getTime();
        const tb = new Date(b.updated_at).getTime();
        return tb - ta;
    });
    const threads = merged.slice(0, cap);
    return { threads, scanned };
}
export async function buildBackfillRequestContext(actorUserId, orgId) {
    const { data: userRow, error: uErr } = await supabaseAdmin
        .from('users')
        .select('id, auth_user_id, email, full_name, status')
        .eq('id', actorUserId)
        .maybeSingle();
    if (uErr)
        throw uErr;
    if (!userRow)
        throw new AppError(400, 'BACKFILL_ACTOR_USER_ID not found in users', 'BACKFILL_ACTOR_INVALID');
    const membership = await loadOrgMembershipForUser(actorUserId, orgId);
    if (!membership) {
        throw new AppError(400, 'Actor is not an active member of ORG_ID', 'BACKFILL_ACTOR_NOT_IN_ORG');
    }
    return {
        user: {
            id: String(userRow.id),
            authUserId: String(userRow.auth_user_id),
            email: String(userRow.email ?? '').trim(),
            fullName: userRow.full_name ?? null,
            status: String(userRow.status ?? 'active'),
        },
        membership,
        organizationId: orgId,
    };
}
export async function runDocflowWorkEngineBackfill(opts) {
    const { threads, scanned } = await fetchEligibleDocflowThreadsForWorkEngineBackfill(opts.orgId, opts.limit);
    const eligible = threads.length;
    let emitted = 0;
    let skipped = 0;
    let errors = 0;
    const details = [];
    if (opts.dryRun) {
        for (const t of threads) {
            details.push({ threadId: t.id, outcome: 'dry_run_would_emit' });
        }
        return { scanned, eligible, emitted: 0, skipped: 0, errors: 0, details };
    }
    if (!opts.actorUserId) {
        throw new AppError(400, 'BACKFILL_ACTOR_USER_ID is required when DRY_RUN=false', 'BACKFILL_ACTOR_REQUIRED');
    }
    const ctx = await buildBackfillRequestContext(opts.actorUserId, opts.orgId);
    for (const t of threads) {
        const r = await emitDocflowThreadNeedsAttentionWithIntakeResult({
            intakeCaller: { kind: 'office_request', ctx },
            clientId: t.client_id,
            threadId: t.id,
            threadStatus: t.thread_status,
            threadType: t.thread_type,
            moduleKey: t.module_key,
        });
        if (!r.ok) {
            errors += 1;
            details.push({ threadId: t.id, outcome: `error:${r.error}` });
            continue;
        }
        const intake = r.intake;
        if (intake.intake_result === 'duplicate_event') {
            skipped += 1;
            details.push({ threadId: t.id, outcome: 'duplicate_event' });
        }
        else if (intake.intake_result === 'pending_mapping') {
            errors += 1;
            details.push({ threadId: t.id, outcome: `pending_mapping:${intake.pending_reason ?? ''}` });
        }
        else if (intake.intake_result === 'created' || intake.intake_result === 'reused_existing') {
            emitted += 1;
            details.push({ threadId: t.id, outcome: intake.intake_result });
        }
        else {
            errors += 1;
            details.push({ threadId: t.id, outcome: `unexpected:${intake.intake_result}` });
        }
    }
    return { scanned, eligible, emitted, skipped, errors, details };
}
