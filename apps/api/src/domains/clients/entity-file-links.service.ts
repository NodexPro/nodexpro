import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { addTimelineEvent, TIMELINE_SOURCE, TIMELINE_EVENTS } from './timeline.service.js';

const ENTITY_TYPE_CLIENT = 'client';

function assertOrg(ctx: RequestContext, orgId: string): void {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
}
function assertPermission(ctx: RequestContext, permission: string): void {
  if (!ctx.membership?.permissions?.includes(permission)) throw forbidden('Insufficient permission');
}

export async function listFilesForClient(ctx: RequestContext, orgId: string, clientId: string) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:read');

  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
  if (!client) throw forbidden('Client not found');

  const { data: links } = await supabaseAdmin
    .from('entity_file_links')
    .select('id, file_asset_id, relation_type, created_at, file_assets(id, file_name, mime_type, file_size, access_level)')
    .eq('organization_id', orgId)
    .eq('entity_type', ENTITY_TYPE_CLIENT)
    .eq('entity_id', clientId)
    .order('created_at', { ascending: false });

  const list = (links ?? []) as unknown as { id: string; file_asset_id: string; relation_type: string; created_at: string; file_assets: { file_name: string; mime_type: string | null; file_size: number | null; access_level: string } | null }[];
  return list.map((l) => ({
    id: l.id,
    file_asset_id: l.file_asset_id,
    relation_type: l.relation_type,
    created_at: l.created_at,
    file_name: l.file_assets?.file_name ?? '',
    mime_type: l.file_assets?.mime_type ?? null,
    file_size: l.file_assets?.file_size ?? null,
    access_level: l.file_assets?.access_level ?? 'organization',
  }));
}

const BUCKET_CLIENT_FILES = 'client-files';
const SIGNED_URL_EXPIRES_SEC = 60;
const MAX_CLIENT_FILE_SIZE = 10 * 1024 * 1024; // 10MB (baseline parity with documents)
const MAX_CLIENT_FILE_BASE64_LENGTH = Math.ceil(MAX_CLIENT_FILE_SIZE / 3) * 4; // base64 chars upper bound (approx)

let bucketEnsured = false;
async function ensureBucketExists(): Promise<void> {
  if (bucketEnsured) return;
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET_CLIENT_FILES, { public: false });
  if (error && !error.message?.toLowerCase().includes('already exists')) {
    console.warn('[entity-file-links] Could not create bucket:', error.message);
  }
  bucketEnsured = true;
}

export async function attachFileToClient(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  body: {
    file_asset_id?: string;
    file_name?: string;
    mime_type?: string | null;
    file_size?: number | null;
    relation_type?: string;
    file_base64?: string;
  }
) {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:write');

  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
  if (!client) throw forbidden('Client not found');

  // Enforce maximum 2 files per client (business rule for Phase 3).
  const countResult = await supabaseAdmin
    .from('entity_file_links')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('entity_type', ENTITY_TYPE_CLIENT)
    .eq('entity_id', clientId);
  const currentCount = countResult.count ?? 0;
  if (currentCount >= 2) {
    throw badRequest('Maximum 2 files per client');
  }

  let fileAssetId = body.file_asset_id ?? null;

  if (fileAssetId) {
    const { data: file } = await supabaseAdmin.from('file_assets').select('id').eq('id', fileAssetId).eq('organization_id', orgId).single();
    if (!file) throw forbidden('File not found');
  } else {
    const fileName = body.file_name?.trim();
    if (!fileName) throw badRequest('file_name is required when file_asset_id is not provided');
    const storageKey = `${orgId}/${clientId}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let fileSize = body.file_size ?? null;

    if (body.file_base64) {
      await ensureBucketExists();
      if (typeof body.file_base64 !== 'string') throw badRequest('Invalid file_base64');
      if (body.file_base64.length > MAX_CLIENT_FILE_BASE64_LENGTH) {
        throw badRequest(`File too large. Max ${MAX_CLIENT_FILE_SIZE / 1024 / 1024}MB`);
      }
      const buf = Buffer.from(body.file_base64, 'base64');
      fileSize = buf.length;
      if (fileSize > MAX_CLIENT_FILE_SIZE) {
        throw badRequest(`File too large. Max ${MAX_CLIENT_FILE_SIZE / 1024 / 1024}MB`);
      }
      const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET_CLIENT_FILES).upload(storageKey, buf, {
        contentType: body.mime_type ?? 'application/octet-stream',
        upsert: false,
      });
      if (uploadError) throw new Error('Failed to upload file to storage');
    }

    const { data: newFile, error: fileError } = await supabaseAdmin
      .from('file_assets')
      .insert({
        organization_id: orgId,
        storage_provider: 'supabase',
        storage_key: storageKey,
        file_name: fileName,
        mime_type: body.mime_type ?? null,
        file_size: fileSize,
        uploaded_by: ctx.user.id,
        access_level: 'organization',
      })
      .select('id')
      .single();
    if (fileError || !newFile) throw new Error('Failed to create file asset');
    fileAssetId = newFile.id as string;
  }

  const { data: link, error } = await supabaseAdmin
    .from('entity_file_links')
    .insert({
      organization_id: orgId,
      file_asset_id: fileAssetId,
      entity_type: ENTITY_TYPE_CLIENT,
      entity_id: clientId,
      relation_type: body.relation_type ?? 'attachment',
      created_by: ctx.user.id,
    })
    .select()
    .single();
  if (error) throw new Error('Failed to attach file');

  await addTimelineEvent({
    organizationId: orgId,
    entityType: ENTITY_TYPE_CLIENT,
    entityId: clientId,
    eventType: TIMELINE_EVENTS.FILE_ATTACHED,
    sourceType: TIMELINE_SOURCE.SYSTEM,
    actorUserId: ctx.user.id,
    payload: { file_asset_id: fileAssetId },
  });
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'client_file',
    entityId: link.id,
    action: AUDIT_ACTIONS.CLIENT_FILE_ATTACHED,
    payload: { client_id: clientId, file_asset_id: fileAssetId },
  });
  return link;
}

/**
 * Authorize file access: user must have access to the entity (client) the file is linked to.
 */
export async function assertCanAccessFileViaClient(ctx: RequestContext, orgId: string, fileAssetId: string): Promise<void> {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:read');

  const { data: link } = await supabaseAdmin
    .from('entity_file_links')
    .select('entity_id')
    .eq('organization_id', orgId)
    .eq('file_asset_id', fileAssetId)
    .eq('entity_type', ENTITY_TYPE_CLIENT)
    .single();
  if (!link) throw forbidden('File not linked to a client you can access');

  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', link.entity_id).eq('organization_id', orgId).single();
  if (!client) throw forbidden('Client not found');
}

/**
 * Secure file open: validates access, returns signed URL, audits view.
 * Verifies file is linked to the specific clientId (prevents cross-client access).
 */
export async function getFileOpenUrl(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  fileAssetId: string
): Promise<{ url: string }> {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:read');

  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
  if (!client) throw forbidden('Client not found');

  const { data: link } = await supabaseAdmin
    .from('entity_file_links')
    .select('id')
    .eq('organization_id', orgId)
    .eq('entity_type', ENTITY_TYPE_CLIENT)
    .eq('entity_id', clientId)
    .eq('file_asset_id', fileAssetId)
    .single();
  if (!link) throw forbidden('File not linked to this client');

  const { data: fileAsset } = await supabaseAdmin
    .from('file_assets')
    .select('id, storage_key, organization_id')
    .eq('id', fileAssetId)
    .single();
  if (!fileAsset || fileAsset.organization_id !== orgId) throw forbidden('File not found');

  await ensureBucketExists();
  const { data: signed, error } = await supabaseAdmin.storage
    .from(BUCKET_CLIENT_FILES)
    .createSignedUrl(fileAsset.storage_key, SIGNED_URL_EXPIRES_SEC);
  if (error || !signed?.signedUrl) {
    const msg = error?.message ?? 'Unknown storage error';
    console.error('[getFileOpenUrl] storage error:', { storage_key: fileAsset.storage_key, error: msg });
    if (error?.message?.toLowerCase().includes('not found') || error?.message?.toLowerCase().includes('object not found')) {
      throw new Error('File not found in storage. It may have been attached before upload was enabled.');
    }
    throw new Error(`Failed to create secure download URL: ${msg}`);
  }

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'client_file',
    entityId: fileAssetId,
    action: AUDIT_ACTIONS.CLIENT_FILE_VIEWED,
    payload: { client_id: clientId },
  });

  return { url: signed.signedUrl };
}

/**
 * Remove file link from client. Deletes only the entity_file_links row; file_asset is preserved.
 * If the link does not exist or does not belong to this client, returns 403.
 */
export async function removeFileFromClient(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  fileAssetId: string
): Promise<void> {
  assertOrg(ctx, orgId);
  assertPermission(ctx, 'clients:write');

  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
  if (!client) throw forbidden('Client not found');

  const { data: link } = await supabaseAdmin
    .from('entity_file_links')
    .select('id')
    .eq('organization_id', orgId)
    .eq('entity_type', ENTITY_TYPE_CLIENT)
    .eq('entity_id', clientId)
    .eq('file_asset_id', fileAssetId)
    .single();
  if (!link) throw forbidden('File link not found for this client');

  const { error } = await supabaseAdmin
    .from('entity_file_links')
    .delete()
    .eq('id', link.id)
    .eq('organization_id', orgId);
  if (error) throw new Error('Failed to remove file link');

  await addTimelineEvent({
    organizationId: orgId,
    entityType: ENTITY_TYPE_CLIENT,
    entityId: clientId,
    eventType: TIMELINE_EVENTS.FILE_LINK_REMOVED,
    sourceType: TIMELINE_SOURCE.SYSTEM,
    actorUserId: ctx.user.id,
    payload: { file_asset_id: fileAssetId },
  });
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'client_file',
    entityId: fileAssetId,
    action: AUDIT_ACTIONS.CLIENT_FILE_LINK_REMOVED,
    payload: { client_id: clientId, link_id: link.id },
  });
}
