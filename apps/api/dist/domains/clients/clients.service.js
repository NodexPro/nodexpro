import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest, conflict } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import { addTimelineEvent, TIMELINE_SOURCE, TIMELINE_EVENTS } from './timeline.service.js';
import { buildClientSearchText, upsertClientSearchIndex, refreshClientSearchIndexWithContacts, searchClients as searchClientsByIds } from './search-index.service.js';
const ENTITY_TYPE_CLIENT = 'client';
const ALLOWED_CLIENT_TYPES = new Set([
    'business_customer',
    'individual_customer',
    'supplier',
    'partner',
    'other',
]);
function assertOrg(ctx, orgId) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
}
function assertPermission(ctx, permission) {
    const perms = ctx.membership?.permissions ?? [];
    if (!perms.includes(permission))
        throw forbidden('Insufficient permission');
}
function assertClientsRead(ctx) {
    assertPermission(ctx, 'clients:read');
}
function assertClientsWrite(ctx) {
    assertPermission(ctx, 'clients:write');
}
function assertClientsViewSensitive(ctx) {
    assertPermission(ctx, 'clients:view_sensitive');
}
function assertClientsArchive(ctx) {
    assertPermission(ctx, 'clients:archive');
}
/** Client must have at least one contact method: phone OR email. */
function assertContactMethod(phone, email) {
    const p = (phone ?? '').trim();
    const e = (email ?? '').trim();
    if (!p && !e)
        throw badRequest('Client must have at least one contact method: phone or email.');
}
const ALLOWED_SORT_FIELDS = new Set(['display_name', 'created_at', 'updated_at', 'status']);
const DEFAULT_SORT_BY = 'display_name';
const DEFAULT_SORT_DIR = 'asc';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
/** Predefined list views. Backend maps these to query filters. */
export const CLIENT_LIST_VIEWS = [
    'all',
    'active',
    'inactive',
    'archived',
    'business_customer',
    'individual_customer',
    'supplier',
    'partner',
    'other',
    'recently_updated',
    'missing_tax_id',
    'duplicate_candidates',
];
export async function listClients(ctx, orgId, options = {}) {
    assertOrg(ctx, orgId);
    assertClientsRead(ctx);
    const view = typeof options.view === 'string' && CLIENT_LIST_VIEWS.includes(options.view)
        ? options.view
        : 'all';
    const searchQ = typeof options.search === 'string' ? options.search.trim() : '';
    const includeArchivedByView = view === 'all' || view === 'archived';
    const includeArchived = options.includeArchived === true || includeArchivedByView;
    let sortBy = ALLOWED_SORT_FIELDS.has(options.sort_by ?? '') ? options.sort_by : DEFAULT_SORT_BY;
    const sortDir = options.sort_dir === 'desc' ? 'desc' : 'asc';
    const limit = Math.min(Math.max(1, Math.floor(Number(options.limit) || DEFAULT_LIMIT)), MAX_LIMIT);
    const offset = Math.max(0, Math.floor(Number(options.offset) || 0));
    if (view === 'recently_updated') {
        sortBy = 'updated_at';
    }
    const selectCols = 'id, tax_id, client_type, display_name, legal_name, status, lifecycle_state, is_archived, created_at, updated_at';
    let clientIdsFilter = null;
    if (searchQ) {
        const searchResults = await searchClientsByIds(orgId, searchQ, { includeArchived });
        clientIdsFilter = searchResults.map((r) => r.entityId);
        if (clientIdsFilter.length === 0) {
            return { items: [], total: 0, limit, offset, has_more: false };
        }
    }
    let countQ = supabaseAdmin
        .from('clients')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId);
    if (!includeArchived && view !== 'archived') {
        countQ = countQ.eq('is_archived', false);
    }
    if (view === 'archived') {
        countQ = countQ.eq('is_archived', true);
    }
    if (view === 'active') {
        countQ = countQ.eq('status', 'active');
    }
    if (view === 'inactive') {
        countQ = countQ.eq('status', 'inactive');
    }
    if (ALLOWED_CLIENT_TYPES.has(view)) {
        countQ = countQ.eq('client_type', view);
    }
    if (view === 'missing_tax_id') {
        countQ = countQ.or('tax_id.is.null,tax_id.eq.');
    }
    let duplicateTaxIds = [];
    if (view === 'duplicate_candidates') {
        const { data: dupTaxIds } = await supabaseAdmin
            .from('clients')
            .select('tax_id')
            .eq('organization_id', orgId)
            .not('tax_id', 'is', null)
            .neq('tax_id', '');
        const taxIdCounts = (dupTaxIds ?? []).reduce((acc, r) => {
            acc[r.tax_id] = (acc[r.tax_id] ?? 0) + 1;
            return acc;
        }, {});
        duplicateTaxIds = Object.keys(taxIdCounts).filter((t) => taxIdCounts[t] > 1);
        if (duplicateTaxIds.length === 0) {
            countQ = countQ.eq('id', 'never-match');
        }
        else {
            countQ = countQ.in('tax_id', duplicateTaxIds);
        }
    }
    if (clientIdsFilter) {
        countQ = countQ.in('id', clientIdsFilter);
    }
    const { count: total } = await countQ;
    const totalCount = total ?? 0;
    let q = supabaseAdmin
        .from('clients')
        .select(selectCols)
        .eq('organization_id', orgId)
        .order(sortBy, { ascending: sortDir === 'asc' })
        .range(offset, offset + limit - 1);
    if (!includeArchived && view !== 'archived') {
        q = q.eq('is_archived', false);
    }
    if (view === 'archived') {
        q = q.eq('is_archived', true);
    }
    if (view === 'active') {
        q = q.eq('status', 'active');
    }
    if (view === 'inactive') {
        q = q.eq('status', 'inactive');
    }
    if (ALLOWED_CLIENT_TYPES.has(view)) {
        q = q.eq('client_type', view);
    }
    if (view === 'missing_tax_id') {
        q = q.or('tax_id.is.null,tax_id.eq.');
    }
    if (view === 'duplicate_candidates') {
        if (duplicateTaxIds.length === 0) {
            q = q.eq('id', 'never-match');
        }
        else {
            q = q.in('tax_id', duplicateTaxIds);
        }
    }
    if (clientIdsFilter) {
        q = q.in('id', clientIdsFilter);
    }
    const { data } = await q;
    const items = (Array.isArray(data) ? data : []);
    return {
        items,
        total: totalCount,
        limit,
        offset,
        has_more: offset + items.length < totalCount,
    };
}
export async function getClientById(ctx, orgId, clientId, _options) {
    assertOrg(ctx, orgId);
    assertClientsRead(ctx);
    const { data: client, error } = await supabaseAdmin
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .eq('organization_id', orgId)
        .single();
    if (error || !client)
        throw forbidden('Client not found');
    const out = { ...client };
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'client',
        entityId: clientId,
        action: AUDIT_ACTIONS.CLIENT_VIEWED,
        payload: {},
    });
    return out;
}
/** Normalize contact fields from request body: accept string (trimmed) or null; reject other types. */
function normalizeContactValue(v) {
    if (v == null)
        return null;
    if (typeof v === 'string') {
        const s = v.trim();
        return s === '' ? null : s;
    }
    return null;
}
export async function createClient(ctx, orgId, body) {
    assertOrg(ctx, orgId);
    assertClientsWrite(ctx);
    const taxId = String(body.tax_id ?? '').trim();
    if (!taxId)
        throw badRequest('tax_id is required');
    const clientType = String(body.client_type ?? '').trim();
    if (!ALLOWED_CLIENT_TYPES.has(clientType)) {
        throw badRequest('Invalid client_type');
    }
    const displayName = String(body.display_name ?? '').trim();
    if (!displayName)
        throw badRequest('display_name is required');
    const phone = normalizeContactValue(body.phone);
    const email = normalizeContactValue(body.email);
    assertContactMethod(phone, email);
    const { data: existing } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('organization_id', orgId)
        .eq('tax_id', taxId)
        .maybeSingle();
    if (existing)
        throw conflict('A client with this tax ID (HP) already exists in this organization');
    const insertPayload = {
        organization_id: orgId,
        tax_id: taxId,
        client_type: clientType,
        display_name: displayName,
        legal_name: body.legal_name != null && typeof body.legal_name === 'string' ? body.legal_name.trim() || null : null,
        external_code: body.external_code != null && typeof body.external_code === 'string' ? body.external_code.trim() || null : null,
        country_code: body.country_code != null && typeof body.country_code === 'string' ? body.country_code.slice(0, 2).trim() || null : null,
        email,
        phone,
        website: normalizeContactValue(body.website),
        address: body.street != null && typeof body.street === 'string' ? body.street.trim() || null : null,
        city: body.city != null && typeof body.city === 'string' ? body.city.trim() || null : null,
        postal_code: body.postal_code != null && typeof body.postal_code === 'string' ? body.postal_code.trim() || null : null,
        status: 'active',
        lifecycle_state: 'lead',
        created_by: ctx.user.id,
    };
    const { data: client, error } = await supabaseAdmin
        .from('clients')
        .insert(insertPayload)
        .select()
        .single();
    if (error || !client)
        throw new Error('Failed to create client');
    await upsertClientSearchIndex(orgId, client.id, buildClientSearchText(client));
    await addTimelineEvent({
        organizationId: orgId,
        entityType: ENTITY_TYPE_CLIENT,
        entityId: client.id,
        eventType: TIMELINE_EVENTS.CLIENT_CREATED,
        sourceType: TIMELINE_SOURCE.SYSTEM,
        sourceModule: 'shared',
        actorUserId: ctx.user.id,
        payload: { display_name: client.display_name },
    });
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'client',
        entityId: client.id,
        action: AUDIT_ACTIONS.CLIENT_CREATED,
        payload: { display_name: client.display_name, tax_id_masked: '***' },
    });
    return client;
}
export async function updateClient(ctx, orgId, clientId, body) {
    assertOrg(ctx, orgId);
    assertClientsWrite(ctx);
    const { data: existing } = await supabaseAdmin
        .from('clients')
        .select('id, tax_id, display_name, legal_name, external_code, email, phone, address, city, postal_code, website')
        .eq('id', clientId)
        .eq('organization_id', orgId)
        .single();
    if (!existing)
        throw forbidden('Client not found');
    const email = body.email !== undefined ? normalizeContactValue(body.email) : (existing.email ?? null);
    const phone = body.phone !== undefined ? normalizeContactValue(body.phone) : (existing.phone ?? null);
    assertContactMethod(phone, email);
    if (body.tax_id != null && body.tax_id !== existing.tax_id) {
        const taxId = String(body.tax_id).trim();
        const { data: dup } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('organization_id', orgId)
            .eq('tax_id', taxId)
            .maybeSingle();
        if (dup)
            throw conflict('A client with this tax ID (HP) already exists');
        await writeAudit({
            organizationId: orgId,
            actorUserId: ctx.user.id,
            entityType: 'client',
            entityId: clientId,
            action: AUDIT_ACTIONS.CLIENT_TAX_ID_CHANGED,
            payload: { previous_tax_id_masked: '***' },
        });
    }
    if (body.client_type != null && !ALLOWED_CLIENT_TYPES.has(String(body.client_type))) {
        throw badRequest('Invalid client_type');
    }
    const updatePayload = { updated_at: new Date().toISOString() };
    if (body.tax_id !== undefined)
        updatePayload.tax_id = String(body.tax_id).trim();
    if (body.client_type !== undefined)
        updatePayload.client_type = body.client_type;
    if (body.display_name !== undefined)
        updatePayload.display_name = body.display_name.trim();
    if (body.legal_name !== undefined)
        updatePayload.legal_name = body.legal_name?.trim() ?? null;
    if (body.external_code !== undefined)
        updatePayload.external_code = body.external_code?.trim() ?? null;
    if (body.country_code !== undefined)
        updatePayload.country_code = body.country_code != null && typeof body.country_code === 'string' ? body.country_code.slice(0, 2).trim() || null : null;
    if (body.email !== undefined)
        updatePayload.email = normalizeContactValue(body.email);
    if (body.phone !== undefined)
        updatePayload.phone = normalizeContactValue(body.phone);
    if (body.website !== undefined)
        updatePayload.website = normalizeContactValue(body.website);
    if (body.city !== undefined)
        updatePayload.city = body.city?.trim() ?? null;
    if (body.street !== undefined)
        updatePayload.address = body.street?.trim() ?? null;
    if (body.postal_code !== undefined)
        updatePayload.postal_code = body.postal_code?.trim() ?? null;
    if (body.status !== undefined)
        updatePayload.status = body.status;
    if (body.lifecycle_state !== undefined)
        updatePayload.lifecycle_state = body.lifecycle_state;
    if (body.owner_user_id !== undefined)
        updatePayload.owner_user_id = body.owner_user_id;
    const { data: client, error } = await supabaseAdmin
        .from('clients')
        .update(updatePayload)
        .eq('id', clientId)
        .eq('organization_id', orgId)
        .select()
        .single();
    if (error || !client)
        throw new Error('Failed to update client');
    await upsertClientSearchIndex(orgId, clientId, buildClientSearchText(client));
    await addTimelineEvent({
        organizationId: orgId,
        entityType: ENTITY_TYPE_CLIENT,
        entityId: clientId,
        eventType: TIMELINE_EVENTS.CLIENT_UPDATED,
        sourceType: TIMELINE_SOURCE.SYSTEM,
        sourceModule: 'shared',
        actorUserId: ctx.user.id,
        payload: { display_name: client.display_name },
    });
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'client',
        entityId: clientId,
        action: AUDIT_ACTIONS.CLIENT_UPDATED,
        payload: {},
    });
    return client;
}
export async function archiveClient(ctx, orgId, clientId) {
    assertOrg(ctx, orgId);
    assertClientsArchive(ctx);
    const { data: client, error } = await supabaseAdmin
        .from('clients')
        .update({
        is_archived: true,
        archived_at: new Date().toISOString(),
        archived_by: ctx.user.id,
        updated_at: new Date().toISOString(),
    })
        .eq('id', clientId)
        .eq('organization_id', orgId)
        .select()
        .single();
    if (error || !client)
        throw forbidden('Client not found');
    await addTimelineEvent({
        organizationId: orgId,
        entityType: ENTITY_TYPE_CLIENT,
        entityId: clientId,
        eventType: TIMELINE_EVENTS.CLIENT_ARCHIVED,
        sourceType: TIMELINE_SOURCE.SYSTEM,
        actorUserId: ctx.user.id,
    });
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'client',
        entityId: clientId,
        action: AUDIT_ACTIONS.CLIENT_ARCHIVED,
        payload: {},
    });
    return client;
}
export async function restoreClient(ctx, orgId, clientId) {
    assertOrg(ctx, orgId);
    assertClientsArchive(ctx);
    const { data: client, error } = await supabaseAdmin
        .from('clients')
        .update({
        is_archived: false,
        archived_at: null,
        archived_by: null,
        updated_at: new Date().toISOString(),
    })
        .eq('id', clientId)
        .eq('organization_id', orgId)
        .select()
        .single();
    if (error || !client)
        throw forbidden('Client not found');
    await upsertClientSearchIndex(orgId, clientId, buildClientSearchText(client));
    await addTimelineEvent({
        organizationId: orgId,
        entityType: ENTITY_TYPE_CLIENT,
        entityId: clientId,
        eventType: TIMELINE_EVENTS.CLIENT_RESTORED,
        sourceType: TIMELINE_SOURCE.SYSTEM,
        actorUserId: ctx.user.id,
    });
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'client',
        entityId: clientId,
        action: AUDIT_ACTIONS.CLIENT_RESTORED,
        payload: {},
    });
    return client;
}
const BULK_MAX_IDS = 500;
function parseBulkClientIds(body) {
    const arr = Array.isArray(body?.clientIds)
        ? body.clientIds
        : [];
    return arr
        .filter((id) => typeof id === 'string' && id.trim().length > 0)
        .slice(0, BULK_MAX_IDS);
}
/** Ensure all client ids belong to org; return only those that do. */
async function resolveBulkClientsInOrg(orgId, clientIds) {
    if (clientIds.length === 0)
        return [];
    const { data } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('organization_id', orgId)
        .in('id', clientIds);
    return (data ?? []).map((r) => r.id);
}
export async function bulkMarkActive(ctx, orgId, body) {
    assertOrg(ctx, orgId);
    assertClientsWrite(ctx);
    const clientIds = parseBulkClientIds(body);
    const inOrg = await resolveBulkClientsInOrg(orgId, clientIds);
    if (inOrg.length === 0)
        return { updated: 0, clientIds: [] };
    const { data } = await supabaseAdmin
        .from('clients')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('organization_id', orgId)
        .in('id', inOrg)
        .select('id');
    const updated = Array.isArray(data) ? data.length : 0;
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'client',
        entityId: null,
        action: AUDIT_ACTIONS.CLIENT_UPDATED,
        payload: { bulk: true, action: 'mark_active', count: updated, client_ids: inOrg },
    });
    return { updated, clientIds: inOrg };
}
export async function bulkMarkInactive(ctx, orgId, body) {
    assertOrg(ctx, orgId);
    assertClientsWrite(ctx);
    const clientIds = parseBulkClientIds(body);
    const inOrg = await resolveBulkClientsInOrg(orgId, clientIds);
    if (inOrg.length === 0)
        return { updated: 0, clientIds: [] };
    const { data } = await supabaseAdmin
        .from('clients')
        .update({ status: 'inactive', updated_at: new Date().toISOString() })
        .eq('organization_id', orgId)
        .in('id', inOrg)
        .select('id');
    const updated = Array.isArray(data) ? data.length : 0;
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'client',
        entityId: null,
        action: AUDIT_ACTIONS.CLIENT_UPDATED,
        payload: { bulk: true, action: 'mark_inactive', count: updated, client_ids: inOrg },
    });
    return { updated, clientIds: inOrg };
}
export async function bulkArchive(ctx, orgId, body) {
    assertOrg(ctx, orgId);
    assertClientsArchive(ctx);
    const clientIds = parseBulkClientIds(body);
    const inOrg = await resolveBulkClientsInOrg(orgId, clientIds);
    if (inOrg.length === 0)
        return { updated: 0, clientIds: [] };
    const { data } = await supabaseAdmin
        .from('clients')
        .update({
        is_archived: true,
        archived_at: new Date().toISOString(),
        archived_by: ctx.user.id,
        updated_at: new Date().toISOString(),
    })
        .eq('organization_id', orgId)
        .in('id', inOrg)
        .select('id');
    const updated = Array.isArray(data) ? data.length : 0;
    for (const clientId of inOrg) {
        await addTimelineEvent({
            organizationId: orgId,
            entityType: ENTITY_TYPE_CLIENT,
            entityId: clientId,
            eventType: TIMELINE_EVENTS.CLIENT_ARCHIVED,
            sourceType: TIMELINE_SOURCE.SYSTEM,
            actorUserId: ctx.user.id,
        });
    }
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'client',
        entityId: null,
        action: AUDIT_ACTIONS.CLIENT_ARCHIVED,
        payload: { bulk: true, count: updated, client_ids: inOrg },
    });
    return { updated, clientIds: inOrg };
}
export async function bulkRestore(ctx, orgId, body) {
    assertOrg(ctx, orgId);
    assertClientsArchive(ctx);
    const clientIds = parseBulkClientIds(body);
    const inOrg = await resolveBulkClientsInOrg(orgId, clientIds);
    if (inOrg.length === 0)
        return { updated: 0, clientIds: [] };
    const { data: clients } = await supabaseAdmin
        .from('clients')
        .update({
        is_archived: false,
        archived_at: null,
        archived_by: null,
        updated_at: new Date().toISOString(),
    })
        .eq('organization_id', orgId)
        .in('id', inOrg)
        .select();
    const updated = Array.isArray(clients) ? clients.length : 0;
    for (const c of clients ?? []) {
        await upsertClientSearchIndex(orgId, c.id, buildClientSearchText(c));
        await addTimelineEvent({
            organizationId: orgId,
            entityType: ENTITY_TYPE_CLIENT,
            entityId: c.id,
            eventType: TIMELINE_EVENTS.CLIENT_RESTORED,
            sourceType: TIMELINE_SOURCE.SYSTEM,
            actorUserId: ctx.user.id,
        });
    }
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'client',
        entityId: null,
        action: AUDIT_ACTIONS.CLIENT_RESTORED,
        payload: { bulk: true, count: updated, client_ids: inOrg },
    });
    return { updated, clientIds: inOrg };
}
export { buildClientSearchText, refreshClientSearchIndexWithContacts };
