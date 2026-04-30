import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
function assertOrg(ctx, orgId) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
}
function assertPermission(ctx, permission) {
    if (!ctx.membership?.permissions?.includes(permission))
        throw forbidden('Insufficient permission');
}
export async function listLinks(ctx, orgId, documentId) {
    assertOrg(ctx, orgId);
    assertPermission(ctx, 'documents:read');
    const { data: doc } = await supabaseAdmin.from('documents').select('id').eq('id', documentId).eq('organization_id', orgId).single();
    if (!doc)
        throw forbidden('Document not found');
    const { data } = await supabaseAdmin
        .from('document_links')
        .select('id, target_entity_type, target_entity_id, relation_type, is_primary, created_at')
        .eq('document_id', documentId)
        .eq('organization_id', orgId);
    return data ?? [];
}
export async function addLink(ctx, orgId, documentId, body) {
    assertOrg(ctx, orgId);
    assertPermission(ctx, 'documents:write');
    const { data: doc } = await supabaseAdmin.from('documents').select('id, primary_client_id').eq('id', documentId).eq('organization_id', orgId).single();
    if (!doc)
        throw forbidden('Document not found');
    const targetType = body.target_entity_type?.trim();
    const targetId = body.target_entity_id?.trim();
    if (!targetType || !targetId)
        throw forbidden('target_entity_type and target_entity_id required');
    if (targetType === 'client') {
        const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', targetId).eq('organization_id', orgId).single();
        if (!client)
            throw forbidden('Client not found');
    }
    const { data: link } = await supabaseAdmin
        .from('document_links')
        .insert({
        organization_id: orgId,
        document_id: documentId,
        target_entity_type: targetType,
        target_entity_id: targetId,
        relation_type: body.relation_type ?? 'related',
        is_primary: body.is_primary ?? false,
        created_by: ctx.user.id,
    })
        .select()
        .single();
    if (!link)
        throw new Error('Failed to add link');
    if (body.is_primary && targetType === 'client') {
        await supabaseAdmin.from('documents').update({ primary_client_id: targetId }).eq('id', documentId).eq('organization_id', orgId);
    }
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'document_link',
        entityId: link.id,
        action: AUDIT_ACTIONS.DOCUMENT_LINKED,
        payload: { document_id: documentId, target_entity_type: targetType, target_entity_id: targetId },
    });
    return link;
}
export async function removeLink(ctx, orgId, documentId, linkId) {
    assertOrg(ctx, orgId);
    assertPermission(ctx, 'documents:write');
    const { data: link } = await supabaseAdmin
        .from('document_links')
        .select('id, target_entity_type, target_entity_id, is_primary')
        .eq('id', linkId)
        .eq('document_id', documentId)
        .eq('organization_id', orgId)
        .single();
    if (!link)
        throw forbidden('Link not found');
    await supabaseAdmin.from('document_links').delete().eq('id', linkId).eq('organization_id', orgId);
    if (link.is_primary && link.target_entity_type === 'client') {
        await supabaseAdmin.from('documents').update({ primary_client_id: null }).eq('id', documentId).eq('organization_id', orgId);
    }
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'document_link',
        entityId: linkId,
        action: AUDIT_ACTIONS.DOCUMENT_UNLINKED,
        payload: { document_id: documentId },
    });
}
