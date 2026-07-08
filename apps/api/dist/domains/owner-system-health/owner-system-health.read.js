/**
 * Platform owner — system health persisted sources (platform-wide read only).
 */
import { supabaseAdmin } from '../../db/client.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';
import { filterSessionEnabledModuleCodes, isSessionEnabledModuleEntitlementStatus, resolveEntitlement, } from '../modules/entitlement.service.js';
import { buildSystemHealthRowId, resolveSystemHealthIssue, sanitizeFailureReason, } from './owner-system-health.pure.js';
const DELIVERY_GROUP_FETCH_LIMIT = 1000;
const ENTITLEMENT_SCAN_ORG_LIMIT = 50;
const ENTITLEMENT_SCAN_MODULE_LIMIT = 300;
export async function pingDatabase() {
    const { error } = await supabaseAdmin.from('modules').select('id').limit(1);
    return { ok: !error };
}
function buildDbHealthRow() {
    const issue = resolveSystemHealthIssue('db_unreachable');
    return {
        id: buildSystemHealthRowId(['platform', 'database', 'db_unreachable']),
        module_key: 'platform',
        area: 'database',
        issue_key: issue.issue_key,
        issue_label: issue.issue_label,
        severity: issue.severity,
        status: 'open',
        count: 1,
        last_seen_at: new Date().toISOString(),
        possible_reason: issue.possible_reason,
        recommended_action: issue.recommended_action,
        source_key: 'database_ping',
        source_ref: null,
    };
}
function deliveryGroupKey(row) {
    const sanitized = sanitizeFailureReason(row.failure_reason);
    const failure_bucket = sanitized ?? 'unknown';
    return {
        module_key: row.source_module || 'delivery',
        channel: row.channel || 'unknown',
        failure_bucket,
    };
}
export async function loadPlatformDeliveryFailureRows() {
    const { data, error } = await supabaseAdmin
        .from('delivery_attempts')
        .select('source_module, channel, failure_reason, updated_at, created_at')
        .eq('result', 'failed')
        .order('updated_at', { ascending: false })
        .limit(DELIVERY_GROUP_FETCH_LIMIT);
    if (error)
        throw error;
    const groups = new Map();
    for (const raw of data ?? []) {
        const row = raw;
        const key = deliveryGroupKey(row);
        const mapKey = `${key.module_key}|${key.channel}|${key.failure_bucket}`;
        const lastSeen = row.updated_at || row.created_at || null;
        const existing = groups.get(mapKey);
        if (existing) {
            existing.count += 1;
            if (lastSeen && (!existing.last_seen_at || lastSeen > existing.last_seen_at)) {
                existing.last_seen_at = lastSeen;
            }
        }
        else {
            groups.set(mapKey, {
                key,
                count: 1,
                last_seen_at: lastSeen,
                sample_reason: sanitizeFailureReason(row.failure_reason),
            });
        }
    }
    return [...groups.values()].map((group) => {
        const derivedKey = group.sample_reason?.toLowerCase().includes('timeout')
            ? 'smtp_timeout'
            : 'delivery_failed';
        const issue = resolveSystemHealthIssue(derivedKey, group.sample_reason);
        return {
            id: buildSystemHealthRowId([
                'delivery',
                group.key.module_key,
                group.key.channel,
                group.key.failure_bucket,
            ]),
            module_key: group.key.module_key,
            area: 'delivery',
            issue_key: issue.issue_key,
            issue_label: issue.issue_label,
            severity: issue.severity,
            status: 'open',
            count: group.count,
            last_seen_at: group.last_seen_at,
            possible_reason: group.sample_reason ?? issue.possible_reason,
            recommended_action: issue.recommended_action,
            source_key: 'delivery_attempts_failed',
            source_ref: `${group.key.channel}:${group.key.failure_bucket}`,
        };
    });
}
export async function loadPlatformIncomePdfFailureRow() {
    const { count, error: countError } = await supabaseAdmin
        .from('income_documents')
        .select('id', { count: 'exact', head: true })
        .eq('pdf_render_status', 'failed');
    if (countError)
        throw countError;
    const failedCount = count ?? 0;
    if (failedCount <= 0)
        return null;
    const { data, error } = await supabaseAdmin
        .from('income_documents')
        .select('updated_at, created_at')
        .eq('pdf_render_status', 'failed')
        .order('updated_at', { ascending: false })
        .limit(1);
    if (error)
        throw error;
    const latest = (data?.[0] ?? null);
    const issue = resolveSystemHealthIssue('pdf_render_failed');
    return {
        id: buildSystemHealthRowId(['income', 'pdf', 'pdf_render_failed']),
        module_key: 'income',
        area: 'pdf',
        issue_key: issue.issue_key,
        issue_label: issue.issue_label,
        severity: issue.severity,
        status: 'open',
        count: failedCount,
        last_seen_at: latest ? latest.updated_at || latest.created_at : null,
        possible_reason: issue.possible_reason,
        recommended_action: issue.recommended_action,
        source_key: 'income_pdf_render_failed',
        source_ref: null,
    };
}
export async function loadPlatformWorkEventFailureRows() {
    const { data, error } = await supabaseAdmin
        .from('work_events')
        .select('source_module, processing_error, processing_outcome, received_at')
        .eq('processing_status', 'failed')
        .order('received_at', { ascending: false })
        .limit(DELIVERY_GROUP_FETCH_LIMIT);
    if (error)
        throw error;
    const groups = new Map();
    for (const raw of data ?? []) {
        const row = raw;
        const module_key = row.source_module || 'work_engine';
        const outcome = row.processing_outcome || 'failed';
        const mapKey = `${module_key}|${outcome}`;
        const sample_reason = sanitizeFailureReason(row.processing_error);
        const existing = groups.get(mapKey);
        if (existing) {
            existing.count += 1;
            if (row.received_at && (!existing.last_seen_at || row.received_at > existing.last_seen_at)) {
                existing.last_seen_at = row.received_at;
            }
        }
        else {
            groups.set(mapKey, {
                module_key,
                outcome,
                count: 1,
                last_seen_at: row.received_at ?? null,
                sample_reason,
            });
        }
    }
    return [...groups.values()].map((group) => {
        const derivedKey = group.sample_reason?.includes('Unsupported schema_version')
            ? 'event_schema_version_unsupported'
            : 'work_event_failed';
        const issue = resolveSystemHealthIssue(derivedKey, group.sample_reason);
        return {
            id: buildSystemHealthRowId(['work_engine', 'event_intake', group.module_key, group.outcome]),
            module_key: group.module_key === 'work_engine' ? 'work_engine' : group.module_key,
            area: 'event_intake',
            issue_key: issue.issue_key,
            issue_label: issue.issue_label,
            severity: issue.severity,
            status: 'open',
            count: group.count,
            last_seen_at: group.last_seen_at,
            possible_reason: group.sample_reason ?? issue.possible_reason,
            recommended_action: issue.recommended_action,
            source_key: 'work_event_intake_failed',
            source_ref: group.outcome,
        };
    });
}
export async function loadUnsupportedEventVersionRows() {
    const { data, error } = await supabaseAdmin
        .from('work_events')
        .select('source_module, processing_error, received_at')
        .eq('processing_status', 'failed')
        .ilike('processing_error', '%Unsupported schema_version%')
        .order('received_at', { ascending: false })
        .limit(DELIVERY_GROUP_FETCH_LIMIT);
    if (error)
        throw error;
    const groups = new Map();
    for (const raw of data ?? []) {
        const row = raw;
        const module_key = row.source_module || 'work_engine';
        const existing = groups.get(module_key);
        const sample_reason = sanitizeFailureReason(row.processing_error);
        if (existing) {
            existing.count += 1;
            if (row.received_at && (!existing.last_seen_at || row.received_at > existing.last_seen_at)) {
                existing.last_seen_at = row.received_at;
            }
        }
        else {
            groups.set(module_key, {
                module_key,
                count: 1,
                last_seen_at: row.received_at ?? null,
                sample_reason,
            });
        }
    }
    const issue = resolveSystemHealthIssue('event_schema_version_unsupported');
    return [...groups.values()].map((group) => ({
        id: buildSystemHealthRowId(['work_engine', 'event_version', group.module_key]),
        module_key: group.module_key,
        area: 'event_intake',
        issue_key: issue.issue_key,
        issue_label: issue.issue_label,
        severity: issue.severity,
        status: 'open',
        count: group.count,
        last_seen_at: group.last_seen_at,
        possible_reason: group.sample_reason ?? issue.possible_reason,
        recommended_action: issue.recommended_action,
        source_key: 'work_event_schema_version_unsupported',
        source_ref: null,
    }));
}
export async function loadEntitlementMismatchRows() {
    const { data, error } = await supabaseAdmin
        .from('organization_modules')
        .select('organization_id, module_id, modules(code, is_system)')
        .eq('status', 'active')
        .limit(ENTITLEMENT_SCAN_MODULE_LIMIT);
    if (error)
        throw error;
    const byOrg = new Map();
    for (const raw of data ?? []) {
        const row = raw;
        const mod = supabaseEmbedOne(row.modules);
        if (!mod?.code || mod.is_system)
            continue;
        const list = byOrg.get(row.organization_id) ?? [];
        list.push({ moduleId: row.module_id, code: mod.code });
        byOrg.set(row.organization_id, list);
    }
    const orgIds = [...byOrg.keys()].slice(0, ENTITLEMENT_SCAN_ORG_LIMIT);
    const mismatchCounts = new Map();
    for (const organizationId of orgIds) {
        const modules = byOrg.get(organizationId) ?? [];
        const entitledCodes = await filterSessionEnabledModuleCodes({ organizationId, modules });
        for (const mod of modules) {
            if (entitledCodes.has(mod.code))
                continue;
            const entitlement = await resolveEntitlement(organizationId, mod.moduleId);
            if (isSessionEnabledModuleEntitlementStatus(entitlement.status))
                continue;
            const existing = mismatchCounts.get(mod.code);
            if (existing) {
                existing.count += 1;
            }
            else {
                mismatchCounts.set(mod.code, { count: 1, last_checked_at: new Date().toISOString() });
            }
        }
    }
    const issue = resolveSystemHealthIssue('entitlement_mismatch');
    const rows = [...mismatchCounts.entries()].map(([moduleCode, info]) => ({
        id: buildSystemHealthRowId(['entitlement', moduleCode]),
        module_key: moduleCode,
        area: 'entitlement',
        issue_key: issue.issue_key,
        issue_label: issue.issue_label,
        severity: issue.severity,
        status: 'open',
        count: info.count,
        last_seen_at: info.last_checked_at,
        possible_reason: issue.possible_reason,
        recommended_action: issue.recommended_action,
        source_key: 'entitlement_mismatch',
        source_ref: null,
    }));
    const truncated = byOrg.size > ENTITLEMENT_SCAN_ORG_LIMIT;
    return {
        rows,
        note: {
            source_key: 'entitlement_mismatch',
            status: truncated ? 'partial' : rows.length ? 'included' : 'included',
            reason: truncated
                ? `Entitlement mismatch scan is bounded to ${ENTITLEMENT_SCAN_ORG_LIMIT} organizations.`
                : 'Entitlement mismatches detected from active organization_modules without entitled/trial status.',
        },
    };
}
export function buildSchedulerSourceNote() {
    return {
        source_key: 'scheduler',
        status: 'not_included',
        reason: 'No platform-wide persisted scheduler run/status table exists yet.',
    };
}
export async function loadOwnerSystemHealthRows() {
    const dbPing = await pingDatabase();
    const sourceNotes = [
        {
            source_key: 'database_ping',
            status: dbPing.ok ? 'included' : 'included',
            reason: dbPing.ok ? 'Database ping succeeded.' : 'Database ping failed.',
        },
        buildSchedulerSourceNote(),
    ];
    const rows = [];
    if (!dbPing.ok) {
        rows.push(buildDbHealthRow());
        return { rows, sourceNotes };
    }
    const [deliveryRows, incomePdfRow, workEventRows, unsupportedVersionRows, entitlementResult,] = await Promise.all([
        loadPlatformDeliveryFailureRows(),
        loadPlatformIncomePdfFailureRow(),
        loadPlatformWorkEventFailureRows(),
        loadUnsupportedEventVersionRows(),
        loadEntitlementMismatchRows(),
    ]);
    rows.push(...deliveryRows);
    if (incomePdfRow)
        rows.push(incomePdfRow);
    rows.push(...workEventRows);
    const existingUnsupportedIds = new Set(rows.filter((row) => row.issue_key === 'event_schema_version_unsupported').map((row) => row.id));
    for (const row of unsupportedVersionRows) {
        if (!existingUnsupportedIds.has(row.id))
            rows.push(row);
    }
    rows.push(...entitlementResult.rows);
    sourceNotes.push(entitlementResult.note);
    sourceNotes.push({ source_key: 'delivery_attempts', status: 'included', reason: 'Failed delivery_attempts grouped platform-wide.' }, { source_key: 'income_pdf', status: 'included', reason: 'income_documents with pdf_render_status=failed.' }, { source_key: 'work_events', status: 'included', reason: 'work_events with processing_status=failed.' }, {
        source_key: 'unsupported_event_versions',
        status: 'included',
        reason: 'Derived from persisted work_events.processing_error when unsupported schema version is recorded.',
    });
    return { rows: rows.sort((a, b) => b.count - a.count || a.module_key.localeCompare(b.module_key)), sourceNotes };
}
