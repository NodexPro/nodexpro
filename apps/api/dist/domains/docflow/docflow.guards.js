import { supabaseAdmin } from '../../db/client.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { resolveEntitlement } from '../modules/entitlement.service.js';
const DOCFLOW_MODULE_CODE = 'docflow';
export function reqString(payload, key) {
    const v = String(payload[key] ?? '').trim();
    if (!v)
        throw badRequest(`${key} is required`);
    return v;
}
export function asOptionalString(v) {
    if (v === undefined || v === null)
        return null;
    const out = String(v).trim();
    return out ? out : null;
}
export function reqDateTimeIso(payload, key) {
    const v = reqString(payload, key);
    if (!Number.isFinite(new Date(v).getTime()))
        throw badRequest(`${key} must be valid ISO date/time`);
    return v;
}
export async function assertDocflowEntitled(organizationId) {
    const { data: mod, error } = await supabaseAdmin.from('modules').select('id').eq('code', DOCFLOW_MODULE_CODE).maybeSingle();
    if (error)
        throw error;
    if (!mod)
        throw forbidden('DocFlow module not registered');
    const entitlement = await resolveEntitlement(organizationId, mod.id);
    if (entitlement.status !== 'entitled' && entitlement.status !== 'trial') {
        console.warn('[docflow][deny] assertDocflowEntitled', {
            org_id: organizationId,
            entitlement_status: entitlement.status,
            entitlement_reason: entitlement.reason ?? null,
        });
        throw forbidden(entitlement.reason ?? 'Not entitled to use DocFlow');
    }
}
export function assertOfficeScope(ctx, organizationId) {
    if (!ctx.organizationId || ctx.organizationId !== organizationId) {
        console.warn('[docflow][deny] assertOfficeScope: organization mismatch', {
            auth_org_id: ctx.organizationId ?? null,
            payload_org_id: organizationId,
            user_email: ctx.user.email ?? null,
            user_id: ctx.user.id ?? null,
        });
        throw forbidden('Organization context required');
    }
    if (!ctx.membership) {
        console.warn('[docflow][deny] assertOfficeScope: missing membership', {
            auth_org_id: ctx.organizationId ?? null,
            payload_org_id: organizationId,
            user_email: ctx.user.email ?? null,
            user_id: ctx.user.id ?? null,
        });
        throw forbidden('Organization membership required');
    }
}
export async function assertClientBelongsToOrg(organizationId, clientId) {
    const { data, error } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('id', clientId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw notFound('Client not found');
}
export function canTransitionThreadStatus(from, to) {
    if (from === to)
        return true;
    const allowed = {
        open: new Set(['waiting_client', 'waiting_office', 'resolved']),
        waiting_client: new Set(['waiting_office', 'resolved']),
        waiting_office: new Set(['waiting_client', 'resolved']),
        resolved: new Set(['archived', 'open']),
        archived: new Set([]),
    };
    return Boolean(allowed[from]?.has(to));
}
export async function assertFileAssetInScope(organizationId, fileAssetId) {
    const { data, error } = await supabaseAdmin
        .from('file_assets')
        .select('id')
        .eq('id', fileAssetId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw notFound('File asset not found in organization');
}
export async function assertDocflowThreadScope(organizationId, clientId, threadId) {
    const { data, error } = await supabaseAdmin
        .from('client_message_threads')
        .select('id')
        .eq('id', threadId)
        .eq('org_id', organizationId)
        .eq('client_id', clientId)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw notFound('Thread not found');
}
export async function assertDocflowMessageScope(organizationId, clientId, threadId, messageId) {
    const { data, error } = await supabaseAdmin
        .from('client_messages')
        .select('id')
        .eq('id', messageId)
        .eq('thread_id', threadId)
        .eq('org_id', organizationId)
        .eq('client_id', clientId)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw notFound('Message not found');
}
