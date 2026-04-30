import { supabaseAdmin } from '../../db/client.js';
export const TIMELINE_SOURCE = { SYSTEM: 'system', MANUAL: 'manual' };
export const TIMELINE_EVENTS = {
    CLIENT_CREATED: 'client_created',
    CLIENT_UPDATED: 'client_updated',
    CLIENT_ARCHIVED: 'client_archived',
    CONTACT_ADDED: 'contact_added',
    CONTACT_UPDATED: 'contact_updated',
    CONTACT_REMOVED: 'contact_removed',
    NOTE_ADDED: 'note_added',
    NOTE_EDITED: 'note_edited',
    NOTE_DELETED: 'note_deleted',
    FILE_ATTACHED: 'file_attached',
    FILE_LINK_REMOVED: 'file_link_removed',
    TAG_ADDED: 'tag_added',
    TAG_REMOVED: 'tag_removed',
    CLIENT_RESTORED: 'client_restored',
    USER_NOTE_CREATED: 'user_note_created',
};
export async function addTimelineEvent(params) {
    await supabaseAdmin.from('activity_timeline').insert({
        organization_id: params.organizationId,
        entity_type: params.entityType,
        entity_id: params.entityId,
        event_type: params.eventType,
        source_type: params.sourceType,
        source_module: params.sourceModule ?? null,
        actor_user_id: params.actorUserId ?? null,
        visibility_scope: params.visibilityScope ?? 'organization',
        is_sensitive: params.isSensitive ?? false,
        payload_json: params.payload ?? null,
    });
}
export async function getTimelineForEntity(organizationId, entityType, entityId, limit = 50) {
    const { data } = await supabaseAdmin
        .from('activity_timeline')
        .select('id, event_type, source_type, source_module, actor_user_id, visibility_scope, is_sensitive, payload_json, created_at')
        .eq('organization_id', organizationId)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })
        .limit(limit);
    return (data ?? []);
}
