import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
const BUCKET = 'document-files';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv',
];
let bucketEnsured = false;
async function ensureBucket() {
    if (bucketEnsured)
        return;
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
    if (error && !error.message?.toLowerCase().includes('already exists')) {
        console.warn('[document-upload] Could not create bucket:', error.message);
    }
    bucketEnsured = true;
}
function assertOrg(ctx, orgId) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
}
function assertPermission(ctx, permission) {
    if (!ctx.membership?.permissions?.includes(permission))
        throw forbidden('Insufficient permission');
}
export async function uploadDocument(ctx, orgId, body) {
    assertOrg(ctx, orgId);
    assertPermission(ctx, 'documents:write');
    const fileName = body.file_name?.trim();
    if (!fileName)
        throw badRequest('file_name is required');
    const mimeType = body.mime_type ?? 'application/octet-stream';
    if (ALLOWED_MIME.length > 0 && !ALLOWED_MIME.includes(mimeType)) {
        throw badRequest(`Unsupported file type: ${mimeType}`);
    }
    const buf = Buffer.from(body.file_base64, 'base64');
    const fileSize = buf.length;
    if (fileSize > MAX_FILE_SIZE)
        throw badRequest(`File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    if (fileSize === 0)
        throw badRequest('File is empty');
    await ensureBucket();
    const storageKey = `${orgId}/documents/${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(storageKey, buf, {
        contentType: mimeType,
        upsert: false,
    });
    if (uploadError)
        throw new Error('Failed to upload file to storage');
    const { data: fileAsset, error: fileError } = await supabaseAdmin
        .from('file_assets')
        .insert({
        organization_id: orgId,
        storage_provider: 'supabase',
        storage_key: storageKey,
        file_name: fileName,
        mime_type: mimeType,
        file_size: fileSize,
        uploaded_by: ctx.user.id,
        access_level: 'organization',
    })
        .select('id')
        .single();
    if (fileError || !fileAsset)
        throw new Error('Failed to create file asset');
    const { data: doc, error: docError } = await supabaseAdmin
        .from('documents')
        .insert({
        organization_id: orgId,
        title: body.title ?? fileName,
        document_type_code: body.document_type_code ?? 'other',
        primary_client_id: body.primary_client_id ?? null,
        lifecycle_state: 'uploaded',
        status: 'active',
        source_type: 'manual',
        created_by: ctx.user.id,
    })
        .select()
        .single();
    if (docError || !doc)
        throw new Error('Failed to create document');
    const { data: version, error: versionError } = await supabaseAdmin
        .from('document_versions')
        .insert({
        organization_id: orgId,
        document_id: doc.id,
        version_number: 1,
        file_asset_id: fileAsset.id,
        original_file_name: fileName,
        mime_type: mimeType,
        file_size: fileSize,
        upload_source: 'manual',
        created_by: ctx.user.id,
        is_current: true,
    })
        .select()
        .single();
    if (versionError || !version)
        throw new Error('Failed to create document version');
    await supabaseAdmin.from('documents').update({ current_version_id: version.id }).eq('id', doc.id).eq('organization_id', orgId);
    await supabaseAdmin.from('document_status_history').insert({
        organization_id: orgId,
        document_id: doc.id,
        to_status: 'active',
        changed_by: ctx.user.id,
        source_type: 'system',
    });
    await supabaseAdmin.from('document_activity_timeline').insert({
        organization_id: orgId,
        document_id: doc.id,
        event_type: 'uploaded',
        source_module: 'documents',
        actor_user_id: ctx.user.id,
        payload_json: { version_id: version.id, file_name: fileName },
    });
    const searchText = [fileName, body.title, doc.document_type_code].filter(Boolean).join(' ');
    const normalized = searchText.toLowerCase().replace(/\s+/g, ' ').trim();
    await supabaseAdmin.from('document_search_index').upsert({
        organization_id: orgId,
        document_id: doc.id,
        search_text: searchText,
        normalized_search_text: normalized,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,document_id' });
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'document',
        entityId: doc.id,
        action: AUDIT_ACTIONS.DOCUMENT_CREATED,
        payload: { version_id: version.id },
    });
    return { document: doc, version };
}
export async function uploadNewVersion(ctx, orgId, documentId, body) {
    assertOrg(ctx, orgId);
    assertPermission(ctx, 'documents:write');
    const { data: doc } = await supabaseAdmin.from('documents').select('id, current_version_id, is_archived').eq('id', documentId).eq('organization_id', orgId).single();
    if (!doc)
        throw forbidden('Document not found');
    if (doc.is_archived)
        throw badRequest('Cannot add version to archived document');
    const fileName = body.file_name?.trim();
    if (!fileName)
        throw badRequest('file_name is required');
    const mimeType = body.mime_type ?? 'application/octet-stream';
    if (ALLOWED_MIME.length > 0 && !ALLOWED_MIME.includes(mimeType)) {
        throw badRequest(`Unsupported file type: ${mimeType}`);
    }
    const buf = Buffer.from(body.file_base64, 'base64');
    const fileSize = buf.length;
    if (fileSize > MAX_FILE_SIZE)
        throw badRequest(`File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    if (fileSize === 0)
        throw badRequest('File is empty');
    await ensureBucket();
    const storageKey = `${orgId}/documents/${documentId}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(storageKey, buf, {
        contentType: mimeType,
        upsert: false,
    });
    if (uploadError)
        throw new Error('Failed to upload file to storage');
    const { data: fileAsset, error: fileError } = await supabaseAdmin
        .from('file_assets')
        .insert({
        organization_id: orgId,
        storage_provider: 'supabase',
        storage_key: storageKey,
        file_name: fileName,
        mime_type: mimeType,
        file_size: fileSize,
        uploaded_by: ctx.user.id,
        access_level: 'organization',
    })
        .select('id')
        .single();
    if (fileError || !fileAsset)
        throw new Error('Failed to create file asset');
    const { data: prevVersions } = await supabaseAdmin
        .from('document_versions')
        .select('version_number')
        .eq('document_id', documentId)
        .order('version_number', { ascending: false })
        .limit(1);
    const nextVersion = prevVersions?.length ? (prevVersions[0].version_number + 1) : 1;
    await supabaseAdmin.from('document_versions').update({ is_current: false }).eq('document_id', documentId);
    const { data: version, error: versionError } = await supabaseAdmin
        .from('document_versions')
        .insert({
        organization_id: orgId,
        document_id: documentId,
        version_number: nextVersion,
        file_asset_id: fileAsset.id,
        original_file_name: fileName,
        mime_type: mimeType,
        file_size: fileSize,
        upload_source: 'manual',
        created_by: ctx.user.id,
        is_current: true,
    })
        .select()
        .single();
    if (versionError || !version)
        throw new Error('Failed to create document version');
    await supabaseAdmin.from('documents').update({ current_version_id: version.id }).eq('id', documentId).eq('organization_id', orgId);
    await supabaseAdmin.from('document_activity_timeline').insert({
        organization_id: orgId,
        document_id: documentId,
        event_type: 'version_added',
        source_module: 'documents',
        actor_user_id: ctx.user.id,
        payload_json: { version_id: version.id, version_number: nextVersion, file_name: fileName },
    });
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'document_version',
        entityId: version.id,
        action: AUDIT_ACTIONS.DOCUMENT_VERSION_UPLOADED,
        payload: { document_id: documentId, version_number: nextVersion },
    });
    return version;
}
