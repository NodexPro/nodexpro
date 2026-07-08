/**
 * Shared persisted failure reads for owner system center (platform-wide + per-org).
 */
import { supabaseAdmin } from '../../db/client.js';
import { sanitizeFailureReason } from './owner-system-health.pure.js';
export const FAILURE_FETCH_LIMIT = 1000;
export const CUSTOMER_HEALTH_ORG_LIMIT = 100;
export const HIGH_VOLUME_EMAIL_FAILURE_THRESHOLD = 10;
export async function pingDatabase() {
    const { error } = await supabaseAdmin.from('modules').select('id').limit(1);
    return { ok: !error };
}
export async function loadDeliveryFailureGroups() {
    const { data, error } = await supabaseAdmin
        .from('delivery_attempts')
        .select('organization_id, source_module, channel, failure_reason, updated_at, created_at')
        .eq('result', 'failed')
        .order('updated_at', { ascending: false })
        .limit(FAILURE_FETCH_LIMIT);
    if (error)
        throw error;
    const groups = new Map();
    for (const raw of data ?? []) {
        const row = raw;
        const failure_bucket = sanitizeFailureReason(row.failure_reason) ?? 'unknown';
        const mapKey = `${row.organization_id}|${row.source_module}|${row.channel}|${failure_bucket}`;
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
                organization_id: row.organization_id,
                source_module: row.source_module || 'delivery',
                channel: row.channel || 'unknown',
                failure_bucket,
                count: 1,
                last_seen_at: lastSeen,
                sample_reason: sanitizeFailureReason(row.failure_reason),
            });
        }
    }
    return [...groups.values()];
}
export async function loadIncomePdfFailuresByOrg() {
    const { data, error } = await supabaseAdmin
        .from('income_documents')
        .select('organization_id, updated_at, created_at')
        .eq('pdf_render_status', 'failed')
        .order('updated_at', { ascending: false })
        .limit(FAILURE_FETCH_LIMIT);
    if (error)
        throw error;
    const groups = new Map();
    for (const raw of data ?? []) {
        const row = raw;
        const lastSeen = row.updated_at || row.created_at || null;
        const existing = groups.get(row.organization_id);
        if (existing) {
            existing.count += 1;
            if (lastSeen && (!existing.last_seen_at || lastSeen > existing.last_seen_at)) {
                existing.last_seen_at = lastSeen;
            }
        }
        else {
            groups.set(row.organization_id, { organization_id: row.organization_id, count: 1, last_seen_at: lastSeen });
        }
    }
    return [...groups.values()];
}
export async function loadWorkEventFailureGroups() {
    const { data, error } = await supabaseAdmin
        .from('work_events')
        .select('org_id, source_module, processing_error, processing_outcome, received_at')
        .eq('processing_status', 'failed')
        .order('received_at', { ascending: false })
        .limit(FAILURE_FETCH_LIMIT);
    if (error)
        throw error;
    const groups = new Map();
    for (const raw of data ?? []) {
        const row = raw;
        const outcome = row.processing_outcome || 'failed';
        const mapKey = `${row.org_id}|${row.source_module}|${outcome}`;
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
                organization_id: row.org_id,
                source_module: row.source_module || 'work_engine',
                outcome,
                count: 1,
                last_seen_at: row.received_at ?? null,
                sample_reason,
            });
        }
    }
    return [...groups.values()];
}
export async function loadUnsupportedEventVersionByOrg() {
    const { data, error } = await supabaseAdmin
        .from('work_events')
        .select('org_id, received_at')
        .eq('processing_status', 'failed')
        .ilike('processing_error', '%Unsupported schema_version%')
        .order('received_at', { ascending: false })
        .limit(FAILURE_FETCH_LIMIT);
    if (error)
        throw error;
    const groups = new Map();
    for (const raw of data ?? []) {
        const row = raw;
        const existing = groups.get(row.org_id);
        if (existing) {
            existing.count += 1;
            if (row.received_at && (!existing.last_seen_at || row.received_at > existing.last_seen_at)) {
                existing.last_seen_at = row.received_at;
            }
        }
        else {
            groups.set(row.org_id, { organization_id: row.org_id, count: 1, last_seen_at: row.received_at });
        }
    }
    return [...groups.values()];
}
export async function loadEmailFailureCountByOrg() {
    const { data, error } = await supabaseAdmin
        .from('delivery_attempts')
        .select('organization_id, updated_at, created_at')
        .eq('result', 'failed')
        .eq('channel', 'email')
        .order('updated_at', { ascending: false })
        .limit(FAILURE_FETCH_LIMIT);
    if (error)
        throw error;
    const groups = new Map();
    for (const raw of data ?? []) {
        const row = raw;
        const lastSeen = row.updated_at || row.created_at || null;
        const existing = groups.get(row.organization_id);
        if (existing) {
            existing.count += 1;
            if (lastSeen && (!existing.last_seen_at || lastSeen > existing.last_seen_at)) {
                existing.last_seen_at = lastSeen;
            }
        }
        else {
            groups.set(row.organization_id, {
                organization_id: row.organization_id,
                count: 1,
                last_seen_at: lastSeen,
            });
        }
    }
    return [...groups.values()];
}
