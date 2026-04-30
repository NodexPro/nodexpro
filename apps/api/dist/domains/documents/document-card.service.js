/**
 * Aggregated Document Card data - single round trip instead of 4+.
 * Backend authoritative; frontend stays dumb.
 */
import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
export async function getDocumentCardData(ctx, orgId, documentId) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
    const perms = ctx.membership?.permissions ?? [];
    if (!perms.includes('documents:read'))
        throw forbidden('Insufficient permission');
    const [docRes, versionsRes, linksRes, activityRes] = await Promise.all([
        supabaseAdmin.from('documents').select('*').eq('id', documentId).eq('organization_id', orgId).single(),
        supabaseAdmin.from('document_versions').select('id, version_number, original_file_name, mime_type, file_size, created_by, created_at, is_current').eq('document_id', documentId).eq('organization_id', orgId).order('version_number', { ascending: false }),
        supabaseAdmin.from('document_links').select('id, target_entity_type, target_entity_id, relation_type, is_primary').eq('document_id', documentId).eq('organization_id', orgId),
        supabaseAdmin.from('document_activity_timeline').select('id, event_type, created_at, payload_json').eq('document_id', documentId).eq('organization_id', orgId).order('created_at', { ascending: false }).limit(50),
    ]);
    const doc = docRes.data;
    if (!doc)
        throw forbidden('Document not found');
    const canViewSensitive = perms.includes('documents:view_sensitive');
    if (!canViewSensitive && ['sensitive', 'restricted'].includes(doc.sensitivity_level ?? '')) {
        doc.sensitivity_level = 'restricted';
    }
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'document',
        entityId: documentId,
        action: doc.sensitivity_level === 'sensitive' || doc.sensitivity_level === 'restricted' ? AUDIT_ACTIONS.DOCUMENT_SENSITIVE_VIEWED : AUDIT_ACTIONS.DOCUMENT_VIEWED,
        payload: {},
    });
    const versions = (versionsRes.data ?? []);
    const links = (linksRes.data ?? []);
    const activity = (activityRes.data ?? []);
    return {
        document: doc,
        versions,
        links,
        activity,
    };
}
