/**
 * Aggregated Client Card data - single round trip instead of 7.
 * Backend authoritative; frontend stays dumb.
 */
import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import * as documentsService from '../documents/documents.service.js';
const ENTITY_TYPE_CLIENT = 'client';
export async function getClientCardData(ctx, orgId, clientId) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
    const perms = ctx.membership?.permissions ?? [];
    if (!perms.includes('clients:read'))
        throw forbidden('Insufficient permission');
    const includeDocuments = perms.includes('documents:read');
    // All client profile fields (tax_id, phone, email, website, address) are visible to anyone with clients:read.
    // Sensitivity is applied only to explicitly sensitive data such as notes.
    const clientSelect = 'id, display_name, legal_name, tax_id, client_type, status, lifecycle_state, is_archived, email, phone, website, country_code, address, city, postal_code, external_code, created_at';
    const [clientRes, contactsRes, notesRes, tagLinksRes, timelineRes, fileLinksRes,] = await Promise.all([
        supabaseAdmin.from('clients').select(clientSelect).eq('id', clientId).eq('organization_id', orgId).single(),
        supabaseAdmin.from('client_contacts').select('id, full_name, email, phone, title, is_primary, status, created_at').eq('client_id', clientId).eq('organization_id', orgId).order('created_at'),
        supabaseAdmin.from('client_notes').select('id, note_text, visibility_scope, is_sensitive, created_at, updated_at').eq('client_id', clientId).eq('organization_id', orgId).order('created_at', { ascending: false }).limit(50),
        supabaseAdmin.from('entity_tag_links').select('tag_id, tags(id, name, code, color)').eq('organization_id', orgId).eq('entity_type', ENTITY_TYPE_CLIENT).eq('entity_id', clientId),
        supabaseAdmin.from('activity_timeline').select('id, event_type, source_type, created_at, payload_json').eq('organization_id', orgId).eq('entity_type', ENTITY_TYPE_CLIENT).eq('entity_id', clientId).order('created_at', { ascending: false }).limit(50),
        supabaseAdmin.from('entity_file_links').select('id, file_asset_id, created_at, file_assets(file_name)').eq('organization_id', orgId).eq('entity_type', ENTITY_TYPE_CLIENT).eq('entity_id', clientId).order('created_at', { ascending: false }),
    ]);
    const client = clientRes.data;
    if (!client)
        throw forbidden('Client not found');
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'client',
        entityId: clientId,
        action: AUDIT_ACTIONS.CLIENT_VIEWED,
        payload: {},
    });
    const contacts = (contactsRes.data ?? []);
    const notesRaw = (notesRes.data ?? []);
    const includeSensitiveNotes = perms.includes('clients:view_sensitive');
    const notes = !includeSensitiveNotes
        ? notesRaw.map((n) => (n.is_sensitive ? { ...n, note_text: '[Sensitive]' } : n))
        : notesRaw;
    const tagRows = (tagLinksRes.data ?? []);
    const tags = tagRows.map((r) => r.tags).filter((t) => t != null);
    const timeline = (timelineRes.data ?? []);
    const fileRows = (fileLinksRes.data ?? []);
    const files = fileRows.map((f) => ({ id: f.id, file_asset_id: f.file_asset_id, file_name: f.file_assets?.file_name ?? '', created_at: f.created_at }));
    let documents;
    if (includeDocuments) {
        const docList = await documentsService.listDocuments(ctx, orgId, { linkedToClientId: clientId });
        documents = docList;
    }
    return {
        client,
        contacts,
        notes,
        tags,
        timeline,
        files,
        documents,
    };
}
