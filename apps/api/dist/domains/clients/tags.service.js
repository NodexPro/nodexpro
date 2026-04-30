import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest, notFound, conflict } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import { addTimelineEvent, TIMELINE_SOURCE, TIMELINE_EVENTS } from './timeline.service.js';
const ENTITY_TYPE_CLIENT = 'client';
function assertOrg(ctx, orgId) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
}
function assertPermission(ctx, permission) {
    if (!ctx.membership?.permissions?.includes(permission))
        throw forbidden('Insufficient permission');
}
export async function listTags(ctx, orgId) {
    assertOrg(ctx, orgId);
    assertPermission(ctx, 'clients:read');
    const { data } = await supabaseAdmin.from('tags').select('*').eq('organization_id', orgId).eq('status', 'active').order('name');
    return data ?? [];
}
export async function createTag(ctx, orgId, body) {
    assertOrg(ctx, orgId);
    assertPermission(ctx, 'clients:write');
    const name = String(body.name ?? '').trim();
    if (!name)
        throw badRequest('name is required');
    const { data: tag, error } = await supabaseAdmin
        .from('tags')
        .insert({
        organization_id: orgId,
        name,
        code: body.code?.trim() ?? null,
        color: body.color?.trim() ?? null,
        status: 'active',
    })
        .select()
        .single();
    if (error)
        throw new Error('Failed to create tag');
    return tag;
}
export async function listTagsForClient(ctx, orgId, clientId) {
    assertOrg(ctx, orgId);
    assertPermission(ctx, 'clients:read');
    const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
    if (!client)
        throw forbidden('Client not found');
    const { data: links } = await supabaseAdmin
        .from('entity_tag_links')
        .select('tag_id, tags(id, name, code, color)')
        .eq('organization_id', orgId)
        .eq('entity_type', ENTITY_TYPE_CLIENT)
        .eq('entity_id', clientId);
    const rows = (links ?? []);
    return rows.map((r) => r.tags).filter((t) => t != null);
}
export async function addTagToClient(ctx, orgId, clientId, tagId) {
    assertOrg(ctx, orgId);
    assertPermission(ctx, 'clients:write');
    const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
    if (!client)
        throw notFound('Client not found');
    const { data: tag } = await supabaseAdmin.from('tags').select('id').eq('id', tagId).eq('organization_id', orgId).single();
    if (!tag)
        throw notFound('Tag not found');
    const { data: link, error } = await supabaseAdmin
        .from('entity_tag_links')
        .insert({
        organization_id: orgId,
        entity_type: ENTITY_TYPE_CLIENT,
        entity_id: clientId,
        tag_id: tagId,
        created_by: ctx.user.id,
    })
        .select()
        .single();
    if (error) {
        // Postgres unique_violation (duplicate link for same org/client/tag)
        const pgCode = error.code;
        if (pgCode === '23505') {
            throw conflict('Tag already linked to client', 'TAG_ALREADY_LINKED');
        }
        throw badRequest('Failed to add tag');
    }
    await addTimelineEvent({
        organizationId: orgId,
        entityType: ENTITY_TYPE_CLIENT,
        entityId: clientId,
        eventType: TIMELINE_EVENTS.TAG_ADDED,
        sourceType: TIMELINE_SOURCE.SYSTEM,
        actorUserId: ctx.user.id,
        payload: { tag_id: tagId },
    });
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'client_tag',
        entityId: link.id,
        action: AUDIT_ACTIONS.CLIENT_TAG_ADDED,
        payload: { client_id: clientId, tag_id: tagId },
    });
    return link;
}
export async function removeTagFromClient(ctx, orgId, clientId, tagId) {
    assertOrg(ctx, orgId);
    assertPermission(ctx, 'clients:write');
    const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
    if (!client)
        throw forbidden('Client not found');
    const { data: link } = await supabaseAdmin
        .from('entity_tag_links')
        .select('id')
        .eq('organization_id', orgId)
        .eq('entity_type', ENTITY_TYPE_CLIENT)
        .eq('entity_id', clientId)
        .eq('tag_id', tagId)
        .single();
    if (!link)
        throw forbidden('Tag link not found');
    await supabaseAdmin.from('entity_tag_links').delete().eq('id', link.id);
    await addTimelineEvent({
        organizationId: orgId,
        entityType: ENTITY_TYPE_CLIENT,
        entityId: clientId,
        eventType: TIMELINE_EVENTS.TAG_REMOVED,
        sourceType: TIMELINE_SOURCE.SYSTEM,
        actorUserId: ctx.user.id,
        payload: { tag_id: tagId },
    });
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'client_tag',
        entityId: link.id,
        action: AUDIT_ACTIONS.CLIENT_TAG_REMOVED,
        payload: { client_id: clientId, tag_id: tagId },
    });
    return { removed: true };
}
