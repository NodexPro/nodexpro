import { supabaseAdmin } from '../../db/client.js';
import { buildDocflowFloatingWidgetAggregate } from './docflow-floating-widget.service.js';
import { getUnreadForOffice, threadStatusLabel, threadTypeLabel } from './docflow-read-models.service.js';
import { asOptionalString } from './docflow.guards.js';
function clampPage(n) {
    if (!Number.isFinite(n) || n < 1)
        return 1;
    return Math.floor(n);
}
function clampPageSize(n) {
    if (!Number.isFinite(n) || n < 1)
        return 25;
    return Math.min(100, Math.floor(n));
}
function startOfUtcDay(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function formatDueLabel(deadlineAt) {
    if (!deadlineAt)
        return '—';
    const t = new Date(deadlineAt).getTime();
    if (!Number.isFinite(t))
        return '—';
    const deadline = new Date(t);
    const now = new Date();
    const d0 = startOfUtcDay(deadline).getTime();
    const d1 = startOfUtcDay(now).getTime();
    const diffDays = Math.round((d0 - d1) / (24 * 60 * 60 * 1000));
    if (diffDays === 0)
        return 'Today';
    if (diffDays === 1)
        return 'Tomorrow';
    if (diffDays === -1)
        return 'Yesterday';
    if (diffDays < -1)
        return `${-diffDays} days ago`;
    if (diffDays > 1)
        return `in ${diffDays} days`;
    return deadline.toISOString().slice(0, 10);
}
function formatLastActivityLabel(iso) {
    if (!iso)
        return '—';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t))
        return '—';
    const ms = Date.now() - t;
    if (ms < 60_000)
        return 'Just now';
    const mins = Math.floor(ms / 60_000);
    if (mins < 60)
        return `${mins}m ago`;
    const hours = Math.floor(ms / 3_600_000);
    if (hours < 48)
        return `${hours}h ago`;
    const days = Math.floor(ms / 86_400_000);
    return `${days}d ago`;
}
function taskCenterRowAllowedActions(threadStatus) {
    const archived = threadStatus === 'archived';
    const resolved = threadStatus === 'resolved';
    return [
        { command: 'open_docflow_thread', enabled: true, reason: null },
        {
            command: 'send_docflow_reminder',
            enabled: !archived && !resolved,
            reason: archived || resolved ? 'Thread is closed' : null,
        },
        {
            command: 'assign_docflow_thread',
            enabled: !archived && !resolved,
            reason: archived || resolved ? 'Thread is closed' : null,
        },
        {
            command: 'resolve_docflow_thread',
            enabled: !archived && !resolved,
            reason: archived || resolved ? 'Thread is closed' : null,
        },
        {
            command: 'archive_docflow_thread',
            enabled: resolved,
            reason: resolved ? null : 'Resolve the thread before archive',
        },
    ];
}
function taskCenterBulkActions() {
    return [
        { bulk_action: 'reminder', enabled: true, reason: null },
        { bulk_action: 'assign', enabled: true, reason: null },
        { bulk_action: 'resolve', enabled: true, reason: null },
        { bulk_action: 'archive', enabled: true, reason: null },
    ];
}
function normalizeAllowedAction(a) {
    const x = a;
    return {
        command: String(x.command ?? ''),
        enabled: Boolean(x.enabled),
        reason: x.reason == null || x.reason === undefined ? null : String(x.reason),
    };
}
/**
 * Single contract for aggregate JSON: `rows` is always a plain array of plain objects
 * (no BigInt, no sparse holes, JSON-serializable).
 */
function finalizeOfficeDocflowTaskCenterRows(rows) {
    const mapped = rows.map((r) => {
        const rawActions = Array.isArray(r.allowed_actions) ? r.allowed_actions : [];
        return {
            thread_id: String(r.thread_id ?? ''),
            client_id: String(r.client_id ?? ''),
            client_name: String(r.client_name ?? ''),
            module_label: String(r.module_label ?? ''),
            thread_type_label: String(r.thread_type_label ?? ''),
            status_label: String(r.status_label ?? ''),
            due_label: String(r.due_label ?? ''),
            assigned_label: String(r.assigned_label ?? ''),
            unread_count: Number(r.unread_count) || 0,
            last_activity_label: String(r.last_activity_label ?? ''),
            allowed_actions: rawActions.map(normalizeAllowedAction),
        };
    });
    return JSON.parse(JSON.stringify(mapped));
}
export function parseTaskCenterOptsFromPayload(orgId, userId, payload) {
    return {
        page: clampPage(Number(payload.task_center_page ?? payload.page ?? 1)),
        page_size: clampPageSize(Number(payload.task_center_page_size ?? payload.page_size ?? 25)),
        search: asOptionalString(payload.task_center_search ?? payload.search),
        module: asOptionalString(payload.task_center_module ?? payload.module),
        thread_type: asOptionalString(payload.task_center_thread_type ?? payload.thread_type),
        thread_status: asOptionalString(payload.task_center_thread_status ?? payload.thread_status),
        assigned_filter: asOptionalString(payload.task_center_assigned_filter ?? payload.assigned_filter),
        unread_only: payload.task_center_unread_only === true || payload.unread_only === true,
        overdue_only: payload.task_center_overdue_only === true || payload.overdue_only === true,
        due_from: asOptionalString(payload.task_center_due_from ?? payload.due_from),
        due_to: asOptionalString(payload.task_center_due_to ?? payload.due_to),
        draft_rule_filter: asOptionalString(payload.task_center_draft_rule_filter ?? payload.draft_rule_filter),
    };
}
export function parseTaskCenterOptsFromQuery(q) {
    const raw = q;
    const first = (k) => {
        const v = raw[k];
        if (Array.isArray(v))
            return v[0];
        return v;
    };
    return {
        page: clampPage(Number(first('page') ?? 1)),
        page_size: clampPageSize(Number(first('page_size') ?? 25)),
        search: first('search')?.trim() || null,
        module: first('module')?.trim() || null,
        thread_type: first('thread_type')?.trim() || null,
        thread_status: first('thread_status')?.trim() || null,
        assigned_filter: first('assigned_filter')?.trim() || null,
        unread_only: first('unread_only') === '1' || first('unread_only') === 'true',
        overdue_only: first('overdue_only') === '1' || first('overdue_only') === 'true',
        due_from: first('due_from')?.trim() || null,
        due_to: first('due_to')?.trim() || null,
        draft_rule_filter: first('draft_rule_filter')?.trim() || null,
    };
}
export async function buildOfficeDocflowTaskCenterAggregate(opts) {
    const page = clampPage(opts.page ?? 1);
    const pageSize = clampPageSize(opts.page_size ?? 25);
    const canUse = opts.can_use_communication_commands !== false;
    const base = await buildDocflowFloatingWidgetAggregate(opts.orgId, {
        can_use_communication_commands: canUse,
    });
    const widgetAccess = String(base.widget_access ?? '');
    if (widgetAccess === 'hidden' || widgetAccess === 'locked') {
        return {
            ...base,
            aggregate_key: 'office_docflow_task_center_aggregate',
            summary: {
                overdue_count: 0,
                waiting_client_count: 0,
                needs_review_count: 0,
                pending_drafts_count: 0,
                unread_replies_count: 0,
                assigned_to_me_count: 0,
            },
            filters: { modules: [], thread_types: [], statuses: [], accountants: [] },
            rows: finalizeOfficeDocflowTaskCenterRows([]),
            pagination: { page: 1, total_pages: 0, total_rows: 0 },
            bulk_allowed_actions: [],
            task_center: {
                draft_rule_filter: opts.draft_rule_filter ?? 'all',
                draft_rule_options: [],
            },
        };
    }
    const { data: metricsRows, error: mErr } = await supabaseAdmin.rpc('docflow_task_center_metrics', {
        p_org_id: opts.orgId,
        p_user_id: opts.userId,
    });
    if (mErr)
        throw mErr;
    const m0 = metricsRows?.[0] ?? {};
    const rpcArgs = {
        p_org_id: opts.orgId,
        p_user_id: opts.userId,
        p_search: opts.search ?? '',
        p_module: opts.module ?? '',
        p_thread_type: opts.thread_type ?? '',
        p_thread_status: opts.thread_status ?? '',
        p_assigned_filter: opts.assigned_filter ?? '',
        p_unread_only: !!opts.unread_only,
        p_overdue_only: !!opts.overdue_only,
        p_due_from: opts.due_from && /^\d{4}-\d{2}-\d{2}$/.test(opts.due_from) ? opts.due_from : null,
        p_due_to: opts.due_to && /^\d{4}-\d{2}-\d{2}$/.test(opts.due_to) ? opts.due_to : null,
    };
    const fetchThreadsPage = async (p, ps) => {
        const { data, error } = await supabaseAdmin.rpc('docflow_task_center_threads_page', {
            ...rpcArgs,
            p_page: p,
            p_page_size: ps,
        });
        if (error)
            throw error;
        return (data ?? []);
    };
    let effectivePage = page;
    let rowsRaw = await fetchThreadsPage(effectivePage, pageSize);
    let totalRows = rowsRaw.length ? Number(rowsRaw[0].total_count) || 0 : 0;
    if (!rowsRaw.length) {
        const peek = await fetchThreadsPage(1, 1);
        totalRows = peek.length ? Number(peek[0].total_count) || 0 : 0;
    }
    let totalPages = totalRows > 0 ? Math.max(1, Math.ceil(totalRows / pageSize)) : 0;
    if (totalPages > 0 && effectivePage > totalPages) {
        effectivePage = totalPages;
        rowsRaw = await fetchThreadsPage(effectivePage, pageSize);
    }
    else if (totalPages === 0) {
        effectivePage = 1;
    }
    const rows = [];
    for (const r of rowsRaw) {
        const unread = await getUnreadForOffice(opts.orgId, r.client_id, r.thread_id);
        const overdue = r.deadline_at &&
            r.thread_status !== 'archived' &&
            r.thread_status !== 'resolved' &&
            new Date(r.deadline_at).getTime() < Date.now();
        rows.push({
            thread_id: r.thread_id,
            client_id: r.client_id,
            client_name: r.client_name,
            module_label: r.module_name || r.module_key,
            thread_type_label: threadTypeLabel(r.thread_type),
            status_label: threadStatusLabel(r.thread_status),
            due_label: overdue ? `Overdue · ${formatDueLabel(r.deadline_at)}` : formatDueLabel(r.deadline_at),
            assigned_label: r.assigned_display_name ?? '—',
            unread_count: unread,
            last_activity_label: formatLastActivityLabel(r.updated_at),
            allowed_actions: taskCenterRowAllowedActions(r.thread_status),
        });
    }
    const { data: modKeys } = await supabaseAdmin
        .from('client_message_threads')
        .select('module_key')
        .eq('org_id', opts.orgId)
        .neq('thread_status', 'archived');
    const moduleSet = new Set();
    for (const row of modKeys ?? []) {
        const k = String(row.module_key ?? '').trim();
        if (k)
            moduleSet.add(k);
    }
    const moduleCodes = [...moduleSet];
    const moduleNameByCode = new Map();
    if (moduleCodes.length) {
        const { data: mods } = await supabaseAdmin.from('modules').select('code, name').in('code', moduleCodes);
        for (const mo of mods ?? []) {
            moduleNameByCode.set(String(mo.code), String(mo.name ?? ''));
        }
    }
    const modules = moduleCodes
        .sort()
        .map((code) => ({ value: code, label: moduleNameByCode.get(code) || code }));
    const threadTypes = ['document_request', 'question', 'reminder', 'task_followup'].map((code) => ({
        value: code,
        label: threadTypeLabel(code),
    }));
    const statuses = ['open', 'waiting_client', 'waiting_office', 'resolved'].map((code) => ({
        value: code,
        label: threadStatusLabel(code),
    }));
    const { data: assigneeRows, error: assigneeErr } = await supabaseAdmin
        .from('client_message_threads')
        .select('assigned_user_id')
        .eq('org_id', opts.orgId)
        .not('assigned_user_id', 'is', null)
        .limit(2000);
    if (assigneeErr)
        throw assigneeErr;
    const assigneeIds = [...new Set((assigneeRows ?? []).map((r) => String(r.assigned_user_id)))];
    const accountantMap = new Map();
    if (assigneeIds.length) {
        const { data: userRows, error: uErr } = await supabaseAdmin
            .from('users')
            .select('id, full_name, email')
            .in('id', assigneeIds);
        if (uErr)
            throw uErr;
        for (const u of userRows ?? []) {
            const id = String(u.id);
            const label = String(u.full_name ?? '').trim() ||
                String(u.email ?? '').trim() ||
                'User';
            accountantMap.set(id, label);
        }
    }
    const accountants = [
        { value: 'me', label: 'Assigned to me' },
        { value: 'unassigned', label: 'Unassigned' },
        ...[...accountantMap.entries()]
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([value, label]) => ({ value, label })),
    ];
    const draftsRaw = Array.isArray(base.pending_drafts) ? base.pending_drafts : [];
    const draftRuleSet = new Set();
    for (const d of draftsRaw) {
        const label = String(d.rule_name ?? d.rule_value_key ?? '').trim();
        if (label)
            draftRuleSet.add(label);
    }
    const draftRuleOptions = [{ value: 'all', label: 'All rules' }, ...[...draftRuleSet].sort().map((v) => ({ value: v, label: v }))];
    let pendingDraftsOut = draftsRaw;
    const ruleFilter = (opts.draft_rule_filter ?? 'all').trim();
    if (ruleFilter && ruleFilter !== 'all') {
        pendingDraftsOut = draftsRaw.filter((d) => {
            const label = String(d.rule_name ?? d.rule_value_key ?? '').trim();
            return label === ruleFilter;
        });
    }
    return {
        ...base,
        aggregate_key: 'office_docflow_task_center_aggregate',
        pending_drafts: pendingDraftsOut,
        pending_draft_count: base.pending_draft_count,
        summary: {
            overdue_count: Number(m0.overdue_count) || 0,
            waiting_client_count: Number(m0.waiting_client_count) || 0,
            needs_review_count: Number(m0.needs_review_count) || 0,
            pending_drafts_count: Number(m0.pending_drafts_count) || 0,
            unread_replies_count: Number(m0.unread_replies_count) || 0,
            assigned_to_me_count: Number(m0.assigned_to_me_count) || 0,
        },
        filters: {
            modules,
            thread_types: threadTypes,
            statuses,
            accountants,
        },
        rows: finalizeOfficeDocflowTaskCenterRows(rows),
        pagination: {
            page: effectivePage,
            total_pages: totalPages,
            total_rows: totalRows,
        },
        bulk_allowed_actions: taskCenterBulkActions(),
        task_center: {
            draft_rule_filter: ruleFilter || 'all',
            draft_rule_options: draftRuleOptions,
        },
    };
}
