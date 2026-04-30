import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { badRequest, forbidden } from '../../shared/errors.js';

const BUCKET_CLIENT_FILES = 'client-files';
const MAX_CLIENT_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_CLIENT_FILE_BASE64_LENGTH = Math.ceil(MAX_CLIENT_FILE_SIZE / 3) * 4;

let bucketEnsured = false;
async function ensureBucketExists(): Promise<void> {
  if (bucketEnsured) return;
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET_CLIENT_FILES, { public: false });
  if (error && !error.message?.toLowerCase().includes('already exists')) {
    console.warn('[shared-client-file-upload] Could not ensure bucket:', error.message);
  }
  bucketEnsured = true;
}

type UploadPayload = {
  file_base64: string;
  file_name: string;
  mime_type?: string | null;
  module_key: string;
  thread_id: string;
  message_id: string;
};

/**
 * Shared file upload to file_assets (no DocFlow file storage).
 * Caller is responsible for prior org/client/thread/message validation.
 */
export async function uploadSharedClientFileAssetForOffice(
  ctx: RequestContext,
  params: {
    orgId: string;
    clientId: string;
    payload: UploadPayload;
  }
): Promise<{ file_asset_id: string; file_name: string; mime_type: string | null; file_size: number }> {
  if (ctx.organizationId !== params.orgId) throw forbidden('Organization context required');
  const perms = ctx.membership?.permissions ?? [];
  if (!perms.includes('clients:write')) throw forbidden('Insufficient permission');

  const fileName = String(params.payload.file_name ?? '').trim();
  if (!fileName) throw badRequest('file_name is required');
  const b64 = params.payload.file_base64;
  if (typeof b64 !== 'string' || !b64.length) throw badRequest('file_base64 is required');
  if (b64.length > MAX_CLIENT_FILE_BASE64_LENGTH) throw badRequest(`File too large. Max ${MAX_CLIENT_FILE_SIZE / 1024 / 1024}MB`);

  const buf = Buffer.from(b64, 'base64');
  const fileSize = buf.length;
  if (fileSize > MAX_CLIENT_FILE_SIZE) throw badRequest(`File too large. Max ${MAX_CLIENT_FILE_SIZE / 1024 / 1024}MB`);

  const storageKey = `${params.orgId}/${params.clientId}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await ensureBucketExists();
  const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET_CLIENT_FILES).upload(storageKey, buf, {
    contentType: params.payload.mime_type ?? 'application/octet-stream',
    upsert: false,
  });
  if (uploadError) throw new Error('Failed to upload file to storage');

  const { data: fileAsset, error: fileAssetErr } = await supabaseAdmin
    .from('file_assets')
    .insert({
      organization_id: params.orgId,
      storage_provider: 'supabase',
      storage_bucket: BUCKET_CLIENT_FILES,
      storage_key: storageKey,
      file_name: fileName,
      mime_type: params.payload.mime_type ?? null,
      file_size: fileSize,
      uploaded_by: ctx.user.id,
      access_level: 'organization',
    })
    .select('id')
    .single();
  if (fileAssetErr || !fileAsset) throw new Error('Failed to create file asset');

  await writeAudit({
    organizationId: params.orgId,
    actorUserId: ctx.user.id,
    entityType: 'file_asset',
    entityId: fileAsset.id,
    action: AUDIT_ACTIONS.CLIENT_FILE_ATTACHED,
    payload: {
      source: 'docflow_shared_upload',
      client_id: params.clientId,
      module_key: params.payload.module_key,
      thread_id: params.payload.thread_id,
      message_id: params.payload.message_id,
      file_name: fileName,
      file_size: fileSize,
    },
  });

  return {
    file_asset_id: fileAsset.id,
    file_name: fileName,
    mime_type: params.payload.mime_type ?? null,
    file_size: fileSize,
  };
}
