import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';

const BUCKET = 'document-files';
const SIGNED_URL_EXPIRES_SEC = 60;

let bucketEnsured = false;
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
  if (error && !error.message?.toLowerCase().includes('already exists')) {
    console.warn('[document-versions] Could not create bucket:', error.message);
  }
  bucketEnsured = true;
}

function assertOrg(ctx: RequestContext, orgId: string): void {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
}
function assertPermission(ctx: RequestContext, permission: string): void {
  if (!ctx.membership?.permissions?.includes(permission)) throw forbidden('Insufficient permission');
}

export async function listVersions(ctx: RequestContext, orgId: string, documentId: string) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'documents:read');

  const { data: doc } = await supabaseAdmin.from('documents').select('id').eq('id', documentId).eq('organization_id', orgId).single();
  if (!doc) throw forbidden('Document not found');

  const { data } = await supabaseAdmin
    .from('document_versions')
    .select('id, version_number, original_file_name, mime_type, file_size, upload_source, created_by, created_at, is_current')
    .eq('document_id', documentId)
    .eq('organization_id', orgId)
    .order('version_number', { ascending: false });
  return data ?? [];
}

export async function getDocumentOpenUrl(
  ctx: RequestContext,
  orgId: string,
  documentId: string,
  versionId?: string
): Promise<{ url: string }> {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'documents:read');

  const { data: doc } = await supabaseAdmin
    .from('documents')
    .select('id, sensitivity_level, current_version_id')
    .eq('id', documentId)
    .eq('organization_id', orgId)
    .single();
  if (!doc) throw forbidden('Document not found');

  const canViewSensitive = ctx.membership?.permissions?.includes('documents:view_sensitive');
  if (!canViewSensitive && ['sensitive', 'restricted'].includes(doc.sensitivity_level)) {
    throw forbidden('Cannot view sensitive document');
  }

  let versionRow: { id: string; file_asset_id: string } | null = null;
  if (versionId) {
    const { data: v } = await supabaseAdmin
      .from('document_versions')
      .select('id, file_asset_id')
      .eq('id', versionId)
      .eq('document_id', documentId)
      .eq('organization_id', orgId)
      .single();
    if (!v) throw forbidden('Version not found');
    versionRow = v as { id: string; file_asset_id: string };
  } else {
    const versionIdToUse = doc.current_version_id;
    if (!versionIdToUse) throw badRequest('Document has no current version');
    const { data: v } = await supabaseAdmin
      .from('document_versions')
      .select('id, file_asset_id')
      .eq('id', versionIdToUse)
      .eq('organization_id', orgId)
      .single();
    if (!v) throw forbidden('Current version not found');
    versionRow = v as { id: string; file_asset_id: string };
  }

  const { data: fileAsset } = await supabaseAdmin
    .from('file_assets')
    .select('id, storage_key, organization_id')
    .eq('id', versionRow.file_asset_id)
    .single();
  if (!fileAsset || fileAsset.organization_id !== orgId) throw forbidden('File not found');

  await ensureBucket();
  const { data: signed, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(fileAsset.storage_key, SIGNED_URL_EXPIRES_SEC);
  if (error || !signed?.signedUrl) {
    const msg = error?.message ?? 'Unknown storage error';
    console.error('[getDocumentOpenUrl] storage error:', { storage_key: fileAsset.storage_key, error: msg });
    if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('object not found')) {
      throw new Error('File not found in storage.');
    }
    throw new Error(`Failed to create secure download URL: ${msg}`);
  }

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'document_version',
    entityId: versionRow.id,
    action: doc.sensitivity_level === 'sensitive' || doc.sensitivity_level === 'restricted' ? AUDIT_ACTIONS.DOCUMENT_SENSITIVE_VIEWED : AUDIT_ACTIONS.DOCUMENT_VERSION_VIEWED,
    payload: { document_id: documentId },
  });

  return { url: signed.signedUrl };
}
