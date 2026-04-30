import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, conflict, forbidden } from '../../shared/errors.js';

const BUCKET = 'client-files';
const MAX_B64 = 12_000_000;
const MAX_FILE = 8_000_000;

/** Default folders — server-only source of truth; stable system_key. */
export const CLIENT_DOCUMENT_DEFAULT_FOLDERS: ReadonlyArray<{ system_key: string; name_he: string; sort_order: number }> = [
  { system_key: 'opening_dossier', name_he: 'פתיחת תיק', sort_order: 10 },
  { system_key: 'withholdings', name_he: 'תיק ניכויים', sort_order: 20 },
  { system_key: 'id_and_license', name_he: 'ת.ז ורישיון נהיגה', sort_order: 30 },
  { system_key: 'business_certificate', name_he: 'תעודת עוסק', sort_order: 40 },
  { system_key: 'letters', name_he: 'מכתבים', sort_order: 50 },
  { system_key: 'forms', name_he: 'טפסים', sort_order: 60 },
  { system_key: 'assessments', name_he: 'שומות', sort_order: 70 },
  { system_key: 'payroll', name_he: 'שכר', sort_order: 80 },
  { system_key: 'case_closure', name_he: 'סגירת תיק', sort_order: 90 },
];

export type ClientDocumentsBrandVariant = 'primary' | 'secondary' | 'neutral';

export type ClientDocumentsTabFolderCardDto = {
  folder_id: string;
  name_he: string;
  document_count: number;
  last_updated_at: string | null;
  last_updated_display_he: string;
  is_system: boolean;
  brand_variant: ClientDocumentsBrandVariant;
  actions: {
    can_open: boolean;
    can_rename: boolean;
    can_archive_or_delete: boolean;
  };
};

export type ClientDocumentsTabDocumentRowDto = {
  document_id: string;
  /** Present when a file is attached; required for the existing signed-URL open route. */
  file_asset_id: string | null;
  file_name_he: string | null;
  display_label_he: string | null;
  uploaded_display_he: string;
  file_open_allowed: boolean;
  actions: { can_view: boolean; can_delete: boolean };
};

export type ClientDocumentsTabResponse = {
  tab_key: 'client_documents';
  read_model_version: number;
  permissions: { can_view: boolean; can_edit: boolean };
  ui: {
    add_folder_label_he: string;
    add_document_label_he: string;
    empty_folders_state_he: string;
    empty_documents_state_he: string;
    tab_title_he: string;
  };
  folders_grid: {
    columns_per_row: 3;
    folders: ClientDocumentsTabFolderCardDto[];
  };
  open_folder: null | {
    folder_id: string;
    folder_name_he: string;
    documents: ClientDocumentsTabDocumentRowDto[];
  };
  file_open_path_template: string;
};

export type ClientDocumentsTabCommandBody = {
  type: string;
  payload?: Record<string, unknown>;
  expected_version: number;
};

export type ClientDocumentsCommandType =
  | 'initialize_client_document_folders'
  | 'create_client_document_folder'
  | 'rename_client_document_folder'
  | 'archive_or_delete_client_document_folder'
  | 'upload_client_document'
  | 'delete_client_document'
  | 'open_client_document_folder';

function assertOrg(ctx: RequestContext): string {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Active organization required');
  return orgId;
}

function hasPerm(ctx: RequestContext, code: string): boolean {
  return (ctx.membership?.permissions ?? []).includes(code);
}

function canViewDocumentsTab(ctx: RequestContext): boolean {
  return hasPerm(ctx, 'client_documents_tab.view') || hasPerm(ctx, 'client_operations.view');
}

function canEditDocumentsTab(ctx: RequestContext): boolean {
  return hasPerm(ctx, 'client_documents_tab.edit') || hasPerm(ctx, 'client_operations.edit');
}

async function ensureClientInOrg(orgId: string, clientId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  if (!data) throw forbidden('Client not found');
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function formatDateTimeHe(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}

async function ensureDocumentProfile(orgId: string, clientId: string): Promise<{ read_model_version: number }> {
  const { data: existing } = await supabaseAdmin
    .from('client_document_profiles')
    .select('read_model_version')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (existing) {
    return { read_model_version: Number((existing as { read_model_version: number }).read_model_version ?? 1) };
  }
  const { data: ins, error } = await supabaseAdmin
    .from('client_document_profiles')
    .insert({
      organization_id: orgId,
      client_id: clientId,
      open_folder_id: null,
      read_model_version: 1,
    })
    .select('read_model_version')
    .single();
  if (error || !ins) throw new AppError(500, error?.message ?? 'client_document_profiles insert failed', 'SUPABASE_ERROR');
  return { read_model_version: Number((ins as { read_model_version: number }).read_model_version ?? 1) };
}

/** Idempotent: insert missing system folders only (no duplicates). One round-trip via upsert. */
export async function ensureClientDocumentFolders(orgId: string, clientId: string): Promise<void> {
  const rows = CLIENT_DOCUMENT_DEFAULT_FOLDERS.map((t) => ({
    organization_id: orgId,
    client_id: clientId,
    system_key: t.system_key,
    name_he: t.name_he,
    sort_order: t.sort_order,
    archived_at: null as string | null,
  }));
  const { error } = await supabaseAdmin.from('client_document_folders').upsert(rows, {
    onConflict: 'organization_id,client_id,system_key',
    ignoreDuplicates: true,
  });
  if (error) throw new AppError(500, error.message ?? 'default folder upsert failed', 'SUPABASE_ERROR');
}

async function assertExpectedVersion(orgId: string, clientId: string, expected: number): Promise<void> {
  const { data: row } = await supabaseAdmin
    .from('client_document_profiles')
    .select('read_model_version')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .single();
  const cur = Number((row as { read_model_version?: number } | null)?.read_model_version ?? 1);
  if (!Number.isFinite(expected) || expected !== cur) {
    throw conflict('הנתונים עודכנו; רענן ונסה שוב');
  }
}

async function bumpReadModelVersion(orgId: string, clientId: string, expected: number, userId: string): Promise<void> {
  const { data: updated, error } = await supabaseAdmin
    .from('client_document_profiles')
    .update({
      read_model_version: expected + 1,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('read_model_version', expected)
    .select('id');
  if (error) throw new AppError(500, error.message ?? 'version bump failed', 'SUPABASE_ERROR');
  if (!updated?.length) throw conflict('הנתונים עודכנו; רענן ונסה שוב');
}

async function auditDocuments(ctx: RequestContext, orgId: string, clientId: string, command: string, payload: Record<string, unknown>): Promise<void> {
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_documents_workspace',
    entityId: clientId,
    action: AUDIT_ACTIONS.CLIENT_DOCUMENTS_WORKSPACE_UPDATED,
    payload: {
      client_id: clientId,
      workspace_command: command,
      command,
      domain: 'client_documents_workspace',
      ...payload,
    },
  });
}

function brandVariantForIndex(i: number): ClientDocumentsBrandVariant {
  const m = i % 3;
  if (m === 0) return 'primary';
  if (m === 1) return 'secondary';
  return 'neutral';
}

export type ClientDocumentsTabReadOptions = {
  /** When true, skips default-folder seeding (caller already ran `executeClientDocumentsTabCommand`, which ensures folders). */
  skipEnsureDefaultFolders?: boolean;
};

export async function getClientDocumentsTabReadModel(
  ctx: RequestContext,
  clientId: string,
  options?: ClientDocumentsTabReadOptions
): Promise<ClientDocumentsTabResponse | null> {
  const orgId = assertOrg(ctx);
  if (!canViewDocumentsTab(ctx)) return null;
  await ensureClientInOrg(orgId, clientId);
  await ensureDocumentProfile(orgId, clientId);
  if (!options?.skipEnsureDefaultFolders) {
    await ensureClientDocumentFolders(orgId, clientId);
  }

  const { data: prof } = await supabaseAdmin
    .from('client_document_profiles')
    .select('read_model_version, open_folder_id')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .single();
  const read_model_version = Number((prof as { read_model_version?: number } | null)?.read_model_version ?? 1);
  let openFolderId = (prof as { open_folder_id?: string | null } | null)?.open_folder_id ?? null;

  const canEdit = canEditDocumentsTab(ctx);

  const { data: folderRows } = await supabaseAdmin
    .from('client_document_folders')
    .select('id, system_key, name_he, sort_order, updated_at, archived_at')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .is('archived_at', null)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  const folders = (folderRows ?? []) as Array<{
    id: string;
    system_key: string | null;
    name_he: string;
    sort_order: number;
    updated_at: string;
    archived_at: string | null;
  }>;

  const folderIds = folders.map((f) => f.id);
  const activeFolderIdSet = new Set(folderIds);

  if (openFolderId && !activeFolderIdSet.has(openFolderId)) {
    openFolderId = null;
  }

  const counts = new Map<string, { n: number; lastDoc: string | null }>();
  for (const fid of folderIds) counts.set(fid, { n: 0, lastDoc: null });

  if (folderIds.length > 0) {
    const { data: docAgg } = await supabaseAdmin
      .from('client_documents')
      .select('folder_id, updated_at')
      .eq('organization_id', orgId)
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .in('folder_id', folderIds);

    for (const r of (docAgg ?? []) as Array<{ folder_id: string; updated_at: string }>) {
      const cur = counts.get(r.folder_id);
      if (!cur) continue;
      cur.n += 1;
      const ts = new Date(r.updated_at).getTime();
      if (!cur.lastDoc || ts > new Date(cur.lastDoc).getTime()) cur.lastDoc = r.updated_at;
    }
  }

  const folderCards: ClientDocumentsTabFolderCardDto[] = folders.map((f, idx) => {
    const agg = counts.get(f.id) ?? { n: 0, lastDoc: null };
    const folderTs = f.updated_at ? new Date(f.updated_at).getTime() : 0;
    const docTs = agg.lastDoc ? new Date(agg.lastDoc).getTime() : 0;
    const lastIso = docTs >= folderTs && agg.lastDoc ? agg.lastDoc : f.updated_at || null;
    const is_system = Boolean(f.system_key);
    const canArchive = canEdit && !is_system && agg.n === 0;
    return {
      folder_id: f.id,
      name_he: f.name_he,
      document_count: agg.n,
      last_updated_at: lastIso,
      last_updated_display_he: formatDateTimeHe(lastIso),
      is_system,
      brand_variant: brandVariantForIndex(idx),
      actions: {
        can_open: true,
        can_rename: canEdit && !is_system,
        can_archive_or_delete: canArchive,
      },
    };
  });

  let open_folder: ClientDocumentsTabResponse['open_folder'] = null;
  if (openFolderId) {
    const folderMeta = folders.find((f) => f.id === openFolderId);
    if (folderMeta) {
      const { data: docRows } = await supabaseAdmin
        .from('client_documents')
        .select('id, file_asset_id, display_label_he, created_at, file_assets(file_name)')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('folder_id', openFolderId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      const documents: ClientDocumentsTabDocumentRowDto[] = ((docRows ?? []) as Array<{
        id: string;
        file_asset_id: string;
        display_label_he: string | null;
        created_at: string;
        file_assets: { file_name: string | null } | { file_name: string | null }[] | null;
      }>).map((d) => {
        const fa = d.file_assets;
        const fn = Array.isArray(fa) ? fa[0]?.file_name : fa?.file_name;
        return {
          document_id: d.id,
          file_asset_id: d.file_asset_id ?? null,
          file_name_he: fn ?? null,
          display_label_he: d.display_label_he,
          uploaded_display_he: formatDateTimeHe(d.created_at),
          file_open_allowed: Boolean(d.file_asset_id),
          actions: {
            can_view: canViewDocumentsTab(ctx) && Boolean(d.file_asset_id),
            can_delete: canEdit,
          },
        };
      });

      open_folder = {
        folder_id: openFolderId,
        folder_name_he: folderMeta.name_he,
        documents,
      };
    }
  }

  return {
    tab_key: 'client_documents',
    read_model_version,
    permissions: { can_view: true, can_edit: canEdit },
    ui: {
      tab_title_he: 'מסמכים',
      add_folder_label_he: 'הוסף תיקייה',
      add_document_label_he: 'הוסף מסמך',
      empty_folders_state_he: 'אין תיקיות',
      empty_documents_state_he: 'אין מסמכים בתיקייה',
    },
    folders_grid: { columns_per_row: 3, folders: folderCards },
    open_folder,
    file_open_path_template: `/m/client-operations/clients/{clientId}/documents/files/{fileAssetId}/open`,
  };
}

export async function assertClientDocumentFileOpenAllowed(orgId: string, clientId: string, fileAssetId: string): Promise<void> {
  const { data: linked } = await supabaseAdmin
    .from('client_documents')
    .select('id')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('file_asset_id', fileAssetId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (linked) return;
  const { data: fileAsset, error } = await supabaseAdmin
    .from('file_assets')
    .select('organization_id, storage_key')
    .eq('id', fileAssetId)
    .single();
  if (error || !fileAsset) throw forbidden('File not found');
  const fa = fileAsset as { organization_id: string; storage_key: string };
  if (fa.organization_id !== orgId) throw forbidden('File not found');
  const prefix = `${orgId}/client-documents/${clientId}/`;
  if (!String(fa.storage_key).startsWith(prefix)) throw forbidden('File not linked to this client documents workspace');
}

const SIGNED_URL_SEC = 120;

export async function getClientDocumentFileOpenUrl(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  fileAssetId: string
): Promise<{ url: string }> {
  await assertClientDocumentFileOpenAllowed(orgId, clientId, fileAssetId);
  const { data: fileAsset, error } = await supabaseAdmin
    .from('file_assets')
    .select('storage_key, organization_id')
    .eq('id', fileAssetId)
    .single();
  if (error || !fileAsset || (fileAsset as { organization_id?: string }).organization_id !== orgId) {
    throw forbidden('File not found');
  }
  const { data: signed, error: se } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl((fileAsset as { storage_key: string }).storage_key, SIGNED_URL_SEC);
  if (se || !signed?.signedUrl) throw new AppError(500, se?.message ?? 'signed url failed', 'SUPABASE_ERROR');
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_documents_workspace',
    entityId: clientId,
    action: AUDIT_ACTIONS.FILE_OPENED,
    payload: { client_id: clientId, file_asset_id: fileAssetId },
  });
  return { url: signed.signedUrl };
}

let documentsBucketEnsured = false;
async function ensureDocumentsBucket(): Promise<void> {
  if (documentsBucketEnsured) return;
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
  if (error && !error.message?.toLowerCase().includes('already exists')) {
    console.warn('[client-documents] bucket:', error.message);
  }
  documentsBucketEnsured = true;
}

export async function uploadClientWorkspaceDocument(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  body: { file_base64?: string; file_name?: string; mime_type?: string | null }
): Promise<{ file_asset_id: string; file_name: string }> {
  const fileName = String(body.file_name ?? '').trim();
  if (!fileName) throw badRequest('file_name is required');
  const b64 = body.file_base64;
  if (typeof b64 !== 'string' || !b64.length) throw badRequest('file_base64 is required');
  if (b64.length > MAX_B64) throw badRequest('File too large');

  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).eq('organization_id', orgId).single();
  if (!client) throw forbidden('Client not found');

  await ensureDocumentsBucket();
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > MAX_FILE) throw badRequest('File too large');
  const storageKey = `${orgId}/client-documents/${clientId}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(storageKey, buf, {
    contentType: body.mime_type ?? 'application/octet-stream',
    upsert: false,
  });
  if (upErr) throw new AppError(500, upErr.message ?? 'upload failed', 'SUPABASE_ERROR');

  const { data: asset, error: faErr } = await supabaseAdmin
    .from('file_assets')
    .insert({
      organization_id: orgId,
      storage_provider: 'supabase',
      storage_key: storageKey,
      file_name: fileName,
      mime_type: body.mime_type ?? null,
      file_size: buf.length,
      uploaded_by: ctx.user.id,
      access_level: 'organization',
    })
    .select('id, file_name')
    .single();
  if (faErr || !asset) throw new AppError(500, faErr?.message ?? 'file_assets insert failed', 'SUPABASE_ERROR');

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_documents_workspace',
    entityId: clientId,
    action: AUDIT_ACTIONS.CLIENT_FILE_ATTACHED,
    payload: {
      client_id: clientId,
      file_asset_id: (asset as { id: string }).id,
      file_name: String((asset as { file_name?: string }).file_name ?? fileName),
      context: 'client_documents_upload',
    },
  });

  return { file_asset_id: String((asset as { id: string }).id), file_name: String((asset as { file_name?: string }).file_name ?? fileName) };
}

async function fetchFolder(orgId: string, clientId: string, folderId: string): Promise<{
  id: string;
  system_key: string | null;
  name_he: string;
  archived_at: string | null;
} | null> {
  const { data } = await supabaseAdmin
    .from('client_document_folders')
    .select('id, system_key, name_he, archived_at')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('id', folderId)
    .maybeSingle();
  return (data as { id: string; system_key: string | null; name_he: string; archived_at: string | null }) ?? null;
}

async function countActiveDocsInFolder(orgId: string, clientId: string, folderId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('client_documents')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('folder_id', folderId)
    .is('deleted_at', null);
  if (error) throw new AppError(500, error.message ?? 'count failed', 'SUPABASE_ERROR');
  return count ?? 0;
}

export async function executeClientDocumentsTabCommand(ctx: RequestContext, clientId: string, body: ClientDocumentsTabCommandBody): Promise<void> {
  const orgId = assertOrg(ctx);
  if (!canEditDocumentsTab(ctx)) throw forbidden('Insufficient permission');
  await ensureClientInOrg(orgId, clientId);
  await ensureDocumentProfile(orgId, clientId);
  await ensureClientDocumentFolders(orgId, clientId);

  if (body == null || typeof body.type !== 'string') throw badRequest('פקודה לא תקינה');
  const expected = Number(body.expected_version);
  if (!Number.isFinite(expected)) throw badRequest('גרסה לא תקינה');
  await assertExpectedVersion(orgId, clientId, expected);
  const payload = asObj(body.payload);
  const cmd = body.type as ClientDocumentsCommandType;

  switch (cmd) {
    case 'initialize_client_document_folders': {
      await ensureClientDocumentFolders(orgId, clientId);
      await auditDocuments(ctx, orgId, clientId, cmd, {});
      break;
    }
    case 'create_client_document_folder': {
      const name_he = String(payload.name_he ?? '').trim();
      if (!name_he) throw badRequest('שם תיקייה נדרש');
      const { data: maxRow } = await supabaseAdmin
        .from('client_document_folders')
        .select('sort_order')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextOrder = Number((maxRow as { sort_order?: number } | null)?.sort_order ?? 0) + 10;
      const { error } = await supabaseAdmin.from('client_document_folders').insert({
        organization_id: orgId,
        client_id: clientId,
        system_key: null,
        name_he,
        sort_order: nextOrder,
        archived_at: null,
      });
      if (error) throw new AppError(500, error.message ?? 'insert folder failed', 'SUPABASE_ERROR');
      await auditDocuments(ctx, orgId, clientId, cmd, { name_he });
      break;
    }
    case 'rename_client_document_folder': {
      const folderId = String(payload.folder_id ?? '');
      const name_he = String(payload.name_he ?? '').trim();
      if (!folderId || !name_he) throw badRequest('נתונים חסרים');
      const row = await fetchFolder(orgId, clientId, folderId);
      if (!row || row.archived_at) throw badRequest('תיקייה לא נמצאה');
      if (row.system_key) throw badRequest('לא ניתן לשנות שם לתיקיית מערכת');
      const { error } = await supabaseAdmin
        .from('client_document_folders')
        .update({ name_he })
        .eq('id', folderId)
        .eq('organization_id', orgId)
        .eq('client_id', clientId);
      if (error) throw new AppError(500, error.message ?? 'rename failed', 'SUPABASE_ERROR');
      await auditDocuments(ctx, orgId, clientId, cmd, { folder_id: folderId, name_he });
      break;
    }
    case 'archive_or_delete_client_document_folder': {
      const folderId = String(payload.folder_id ?? '');
      if (!folderId) throw badRequest('folder_id נדרש');
      const row = await fetchFolder(orgId, clientId, folderId);
      if (!row || row.archived_at) throw badRequest('תיקייה לא נמצאה');
      if (row.system_key) throw badRequest('לא ניתן למחוק תיקיית מערכת');
      const n = await countActiveDocsInFolder(orgId, clientId, folderId);
      if (n > 0) throw badRequest('לא ניתן למחוק תיקייה עם מסמכים');
      const { error } = await supabaseAdmin
        .from('client_document_folders')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', folderId)
        .eq('organization_id', orgId)
        .eq('client_id', clientId);
      if (error) throw new AppError(500, error.message ?? 'archive folder failed', 'SUPABASE_ERROR');
      await supabaseAdmin
        .from('client_document_profiles')
        .update({ open_folder_id: null })
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('open_folder_id', folderId);
      await auditDocuments(ctx, orgId, clientId, cmd, { folder_id: folderId });
      break;
    }
    case 'upload_client_document': {
      const folderId = String(payload.folder_id ?? '');
      const fileAssetId = String(payload.file_asset_id ?? '');
      if (!folderId || !fileAssetId) throw badRequest('folder_id וקובץ נדרשים');
      const folder = await fetchFolder(orgId, clientId, folderId);
      if (!folder || folder.archived_at) throw badRequest('תיקייה לא נמצאה');
      await assertClientDocumentFileOpenAllowed(orgId, clientId, fileAssetId);
      const display_label_he =
        payload.display_label_he == null || payload.display_label_he === ''
          ? null
          : String(payload.display_label_he);
      const { error } = await supabaseAdmin.from('client_documents').insert({
        organization_id: orgId,
        client_id: clientId,
        folder_id: folderId,
        file_asset_id: fileAssetId,
        display_label_he,
        uploaded_by_user_id: ctx.user.id,
      });
      if (error) throw new AppError(500, error.message ?? 'document insert failed', 'SUPABASE_ERROR');
      await auditDocuments(ctx, orgId, clientId, cmd, { folder_id: folderId, file_asset_id: fileAssetId });
      break;
    }
    case 'delete_client_document': {
      const documentId = String(payload.document_id ?? '');
      if (!documentId) throw badRequest('document_id נדרש');
      const { data: doc, error: fe } = await supabaseAdmin
        .from('client_documents')
        .select('id')
        .eq('id', documentId)
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .is('deleted_at', null)
        .maybeSingle();
      if (fe || !doc) throw badRequest('מסמך לא נמצא');
      const { error } = await supabaseAdmin
        .from('client_documents')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', documentId)
        .eq('organization_id', orgId)
        .eq('client_id', clientId);
      if (error) throw new AppError(500, error.message ?? 'delete document failed', 'SUPABASE_ERROR');
      await auditDocuments(ctx, orgId, clientId, cmd, { document_id: documentId });
      break;
    }
    case 'open_client_document_folder': {
      const raw = payload.folder_id;
      const folderId = raw == null || raw === '' ? null : String(raw);
      if (folderId) {
        const folder = await fetchFolder(orgId, clientId, folderId);
        if (!folder || folder.archived_at) throw badRequest('תיקייה לא נמצאה');
      }
      const { error } = await supabaseAdmin
        .from('client_document_profiles')
        .update({ open_folder_id: folderId, updated_at: new Date().toISOString(), updated_by: ctx.user.id })
        .eq('organization_id', orgId)
        .eq('client_id', clientId);
      if (error) throw new AppError(500, error.message ?? 'open folder failed', 'SUPABASE_ERROR');
      break;
    }
    default:
      throw badRequest('סוג פקודה לא מוכר');
  }

  await bumpReadModelVersion(orgId, clientId, expected, ctx.user.id);
}
