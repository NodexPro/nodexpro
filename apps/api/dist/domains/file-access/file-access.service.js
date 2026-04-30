/**
 * Secure file access: org-scoped validation, signed URLs only.
 * Reusable for settings (logo/signature) and future Document Hub.
 * Backend authoritative; no public URLs as primary model.
 */
import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest, notFound, conflict } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
const SIGNED_URL_EXPIRES_SEC = 60;
const SETTINGS_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const SETTINGS_IMAGE_MIME_ALLOWLIST = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    // SVG excluded: no sanitization pipeline
]);
/**
 * Load file asset and verify it belongs to the given organization.
 * Throws 404 if not found, 403 if org mismatch.
 */
export async function validateOrgFileOwnership(ctx, organizationId, fileAssetId) {
    if (ctx.organizationId !== organizationId)
        throw forbidden('Organization context required');
    const { data: row, error } = await supabaseAdmin
        .from('file_assets')
        .select('id, organization_id, storage_bucket, storage_key, file_name, mime_type, file_size, archived_at')
        .eq('id', fileAssetId)
        .single();
    if (error || !row) {
        writeAudit({
            organizationId,
            actorUserId: ctx.user.id,
            entityType: 'file_asset',
            entityId: fileAssetId,
            action: AUDIT_ACTIONS.FILE_ACCESS_DENIED,
            payload: { reason: 'not_found' },
        }).catch(() => { });
        throw notFound('File not found');
    }
    if (row.organization_id !== organizationId) {
        writeAudit({
            organizationId,
            actorUserId: ctx.user.id,
            entityType: 'file_asset',
            entityId: fileAssetId,
            action: AUDIT_ACTIONS.FILE_ACCESS_DENIED,
            payload: { reason: 'org_mismatch' },
        }).catch(() => { });
        throw forbidden('File does not belong to this organization');
    }
    return row;
}
/**
 * Assert file asset is allowed for use as settings image (logo or signature).
 * Throws 400 invalid type, 409 if archived or oversized.
 */
export function assertFileAllowedForSettingsImage(file) {
    if (file.archived_at) {
        throw conflict('File asset is archived and cannot be used');
    }
    const mime = (file.mime_type ?? '').toLowerCase().split(';')[0].trim();
    if (!mime || !SETTINGS_IMAGE_MIME_ALLOWLIST.has(mime)) {
        throw badRequest('Invalid file type for logo/signature. Allowed: PNG, JPEG, WebP only.');
    }
    const size = file.file_size ?? 0;
    if (size > SETTINGS_IMAGE_MAX_BYTES) {
        throw badRequest(`File too large. Maximum size for logo/signature is ${SETTINGS_IMAGE_MAX_BYTES / 1024 / 1024} MB`);
    }
}
const BUCKET_ORG_ASSETS = 'organization-assets';
let bucketEnsured = false;
async function ensureOrgAssetsBucket() {
    if (bucketEnsured)
        return;
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET_ORG_ASSETS, { public: false });
    if (error && error.message !== 'Bucket already exists') {
        console.error('[file-access] Failed to ensure bucket:', error.message);
    }
    bucketEnsured = true;
}
/**
 * Generate short-lived signed URL for an org file after validation.
 * For purpose 'settings': file must be linked as logo or signature in organization_settings,
 * and user must have settings:read (or access_settings).
 */
export async function getSecureOpenUrlForOrgFile(ctx, organizationId, fileAssetId, accessPurpose) {
    const file = await validateOrgFileOwnership(ctx, organizationId, fileAssetId);
    if (accessPurpose === 'settings') {
        const perms = ctx.membership?.permissions ?? [];
        const canRead = perms.includes('settings:read') || perms.includes('access_settings');
        if (!canRead) {
            await writeAudit({
                organizationId,
                actorUserId: ctx.user.id,
                entityType: 'file_asset',
                entityId: fileAssetId,
                action: AUDIT_ACTIONS.FILE_ACCESS_DENIED,
                payload: { reason: 'insufficient_permission', purpose: 'settings' },
            });
            throw forbidden('Insufficient permission to access settings files');
        }
        const { data: settings } = await supabaseAdmin
            .from('organization_settings')
            .select('logo_file_asset_id, signature_image_file_asset_id')
            .eq('organization_id', organizationId)
            .maybeSingle();
        const s = settings;
        const isLogo = s?.logo_file_asset_id === fileAssetId;
        const isSignature = s?.signature_image_file_asset_id === fileAssetId;
        if (!isLogo && !isSignature) {
            await writeAudit({
                organizationId,
                actorUserId: ctx.user.id,
                entityType: 'file_asset',
                entityId: fileAssetId,
                action: AUDIT_ACTIONS.FILE_ACCESS_DENIED,
                payload: { reason: 'not_linked_to_settings', purpose: 'settings' },
            });
            throw forbidden('File not linked to organization settings');
        }
    }
    const bucket = file.storage_bucket ?? BUCKET_ORG_ASSETS;
    if (bucket === BUCKET_ORG_ASSETS)
        await ensureOrgAssetsBucket();
    const { data: signed, error } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUrl(file.storage_key, SIGNED_URL_EXPIRES_SEC);
    if (error || !signed?.signedUrl) {
        console.error('[file-access] Signed URL error:', { bucket, key: file.storage_key, error: error?.message });
        throw notFound('File not found in storage');
    }
    await writeAudit({
        organizationId,
        actorUserId: ctx.user.id,
        entityType: 'file_asset',
        entityId: fileAssetId,
        action: AUDIT_ACTIONS.FILE_OPENED,
        payload: { purpose: accessPurpose, expiresIn: SIGNED_URL_EXPIRES_SEC },
    });
    return { url: signed.signedUrl, expiresIn: SIGNED_URL_EXPIRES_SEC };
}
