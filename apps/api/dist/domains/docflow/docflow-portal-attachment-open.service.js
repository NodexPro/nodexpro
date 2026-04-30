import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import { writeAudit } from '../../shared/audit-events.js';
const BUCKET_CLIENT_FILES = 'client-files';
const SIGNED_URL_EXPIRES_SEC = 60;
let bucketEnsured = false;
async function ensureBucketExists() {
    if (bucketEnsured)
        return;
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET_CLIENT_FILES, { public: false });
    if (error && !error.message?.toLowerCase().includes('already exists')) {
        console.warn('[docflow-portal-file-open] Could not ensure bucket:', error.message);
    }
    bucketEnsured = true;
}
/**
 * Signed download URL for a file that appears as a DocFlow thread attachment for this client.
 * Portal session is validated by the caller; this enforces org + client + attachment row scope.
 */
export async function getPortalDocflowAttachmentSignedUrl(params) {
    const { data: row, error } = await supabaseAdmin
        .from('client_message_attachments')
        .select('id')
        .eq('org_id', params.orgId)
        .eq('client_id', params.clientId)
        .eq('file_asset_id', params.fileAssetId)
        .limit(1)
        .maybeSingle();
    if (error)
        throw error;
    if (!row)
        throw forbidden('Attachment not accessible for this portal session');
    const { data: fileAsset, error: faErr } = await supabaseAdmin
        .from('file_assets')
        .select('id, storage_bucket, storage_key, organization_id')
        .eq('id', params.fileAssetId)
        .single();
    if (faErr)
        throw faErr;
    if (!fileAsset || fileAsset.organization_id !== params.orgId)
        throw forbidden('File not found');
    const bucket = String(fileAsset.storage_bucket ?? BUCKET_CLIENT_FILES);
    if (bucket === BUCKET_CLIENT_FILES)
        await ensureBucketExists();
    const { data: signed, error: sErr } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUrl(fileAsset.storage_key, SIGNED_URL_EXPIRES_SEC);
    if (sErr || !signed?.signedUrl) {
        const msg = sErr?.message ?? 'Unknown storage error';
        console.error('[docflow-portal-file-open] storage error:', { storage_key: fileAsset.storage_key, error: msg });
        throw new Error(`Failed to create secure download URL: ${msg}`);
    }
    await writeAudit({
        organizationId: params.orgId,
        actorUserId: null,
        entityType: 'docflow_message_attachment',
        entityId: params.fileAssetId,
        action: 'message_attachment_opened',
        payload: {
            actor: 'client_portal_user',
            portal_user_id: params.portalUserId,
            org_id: params.orgId,
            client_id: params.clientId,
            file_asset_id: params.fileAssetId,
            expires_in_sec: SIGNED_URL_EXPIRES_SEC,
        },
    });
    return { url: signed.signedUrl };
}
