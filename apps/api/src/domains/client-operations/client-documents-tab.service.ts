import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, conflict, forbidden } from '../../shared/errors.js';
import { requireGuardedUpload } from '../../shared/file-content-guard.js';
import { assertFileAssetDownloadable } from '../../shared/document-download-guard.js';
import { CO_UI, documentFolderLabelKey } from './client-operations-ui-labels.pure.js';
import { formatReportingPeriodDisplayLabel } from './client-operations-reporting-dashboard.pure.js';
import {
  CLIENT_DOCUMENT_STORAGE_BUCKET,
  FILING_EVIDENCE_FOLDER_SYSTEM_KEY,
  clientDocumentDeliveryPresentation,
  clientDocumentStorageReadOrder,
} from './client-operations-filing-evidence.pure.js';
import { beginAttempt, finalizeAttempt, listAttempts, sendEmail } from '../delivery/index.js';
import { assertCanAccessClientFromContext } from './organization-client-access.js';

const BUCKET = CLIENT_DOCUMENT_STORAGE_BUCKET;
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
  { system_key: 'vat_filings', name_he: 'דיווח מע״מ', sort_order: 100 },
  { system_key: 'income_tax_advance_filings', name_he: 'דיווח מקדמות', sort_order: 110 },
  { system_key: 'ni_deductions_filings', name_he: 'דיווחי ב״ל', sort_order: 120 },
];

export type ClientDocumentsBrandVariant = 'primary' | 'secondary' | 'neutral';

export type ClientDocumentsTabFolderCardDto = {
  folder_id: string;
  name_he: string;
  name_key?: string;
  system_key?: string | null;
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
  actions: { can_view: boolean; can_delete: boolean; can_send: boolean };
  evidence_kind?: 'filing' | 'payment' | null;
  evidence_kind_key?: string | null;
  reporting_period_key?: string | null;
  reporting_period_display?: string | null;
  delivery?: {
    result: 'pending' | 'sent' | 'failed' | null;
    provider_confirmed: false;
    status_key: string | null;
  };
};

export type ClientDocumentsTabResponse = {
  tab_key: 'client_documents';
  read_model_version: number;
  permissions: { can_view: boolean; can_edit: boolean };
  ui: {
    add_folder_label_he: string;
    add_folder_label_key?: string;
    add_document_label_he: string;
    add_document_label_key?: string;
    empty_folders_state_he: string;
    empty_folders_state_key?: string;
    empty_documents_state_he: string;
    empty_documents_state_key?: string;
    tab_title_he: string;
    tab_title_key?: string;
  };
  folders_grid: {
    columns_per_row: 3;
    folders: ClientDocumentsTabFolderCardDto[];
  };
  open_folder: null | {
    folder_id: string;
    folder_name_he: string;
    folder_name_key?: string;
    documents: ClientDocumentsTabDocumentRowDto[];
    period_navigation?: null | {
      selected_period_key: string | null;
      periods: Array<{ period_key: string; display_label: string }>;
    };
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
  | 'send_client_document_to_client'
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

/** Idempotent: insert only system folders that are still missing. */
export async function ensureClientDocumentFolders(orgId: string, clientId: string): Promise<void> {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('client_document_folders')
    .select('system_key')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .not('system_key', 'is', null);
  if (existingError) throw new AppError(500, existingError.message ?? 'folder lookup failed', 'SUPABASE_ERROR');
  const present = new Set(
    ((existing ?? []) as Array<{ system_key: string | null }>)
      .map((row) => row.system_key)
      .filter((key): key is string => Boolean(key)),
  );
  const missing = CLIENT_DOCUMENT_DEFAULT_FOLDERS.filter((folder) => !present.has(folder.system_key));
  if (missing.length === 0) return;
  const rows = missing.map((folder) => ({
    organization_id: orgId,
    client_id: clientId,
    system_key: folder.system_key,
    name_he: folder.name_he,
    sort_order: folder.sort_order,
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

async function bumpReadModelVersion(
  orgId: string,
  clientId: string,
  expected: number,
  userId: string,
  extra?: Record<string, unknown> | null,
): Promise<void> {
  const { data: updated, error } = await supabaseAdmin
    .from('client_document_profiles')
    .update({
      read_model_version: expected + 1,
      updated_at: new Date().toISOString(),
      updated_by: userId,
      ...(extra ?? {}),
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
  /** GET / case refresh: never insert profiles or folders. */
  readOnly?: boolean;
};

export async function getClientDocumentsTabReadModel(
  ctx: RequestContext,
  clientId: string,
  options?: ClientDocumentsTabReadOptions
): Promise<ClientDocumentsTabResponse | null> {
  const orgId = assertOrg(ctx);
  if (!canViewDocumentsTab(ctx)) return null;
  await ensureClientInOrg(orgId, clientId);
  if (options?.readOnly) {
    const { data: existingProfile } = await supabaseAdmin
      .from('client_document_profiles')
      .select('read_model_version')
      .eq('organization_id', orgId)
      .eq('client_id', clientId)
      .maybeSingle();
    if (!existingProfile) {
      const canEdit = canEditDocumentsTab(ctx);
      return {
        tab_key: 'client_documents',
        read_model_version: 1,
        permissions: { can_view: true, can_edit: canEdit },
        ui: {
          tab_title_he: 'מסמכים',
          tab_title_key: CO_UI.documents.tabTitle,
          add_folder_label_he: 'הוסף תיקייה',
          add_folder_label_key: CO_UI.documents.addFolder,
          add_document_label_he: 'הוסף מסמך',
          add_document_label_key: CO_UI.documents.addDocument,
          empty_folders_state_he: 'אין תיקיות',
          empty_folders_state_key: CO_UI.documents.emptyFolders,
          empty_documents_state_he: 'אין מסמכים בתיקייה',
          empty_documents_state_key: CO_UI.documents.emptyDocuments,
        },
        folders_grid: { columns_per_row: 3, folders: [] },
        open_folder: null,
        file_open_path_template: `/m/client-operations/clients/{clientId}/documents/files/{fileAssetId}/open`,
      };
    }
  } else {
    await ensureDocumentProfile(orgId, clientId);
    if (!options?.skipEnsureDefaultFolders) {
      await ensureClientDocumentFolders(orgId, clientId);
    }
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

  const openFolderMeta = openFolderId ? folders.find((f) => f.id === openFolderId) ?? null : null;
  const filingFolder = Boolean(
    openFolderMeta?.system_key &&
      Object.values(FILING_EVIDENCE_FOLDER_SYSTEM_KEY).includes(openFolderMeta.system_key),
  );
  const [docAggResult, openDocsResult, deliveryAttempts] = await Promise.all([
    folderIds.length > 0
      ? supabaseAdmin
          .from('client_documents')
          .select('folder_id, updated_at')
          .eq('organization_id', orgId)
          .eq('client_id', clientId)
          .is('deleted_at', null)
          .in('folder_id', folderIds)
      : Promise.resolve({ data: [] as Array<{ folder_id: string; updated_at: string }> | null }),
    openFolderMeta
      ? supabaseAdmin
          .from('client_documents')
          .select('id, file_asset_id, display_label_he, created_at, evidence_kind, reporting_period_key, file_assets(file_name)')
          .eq('organization_id', orgId)
          .eq('client_id', clientId)
          .eq('folder_id', openFolderMeta.id)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
      : Promise.resolve(null),
    filingFolder
      ? listAttempts({
          organizationId: orgId,
          representedClientId: clientId,
          sourceModule: 'client-operations',
          sourceEntityType: 'client_document',
          channel: 'email',
          limit: 200,
        }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const counts = new Map<string, { n: number; lastDoc: string | null }>();
  for (const fid of folderIds) counts.set(fid, { n: 0, lastDoc: null });
  for (const r of (docAggResult.data ?? []) as Array<{ folder_id: string; updated_at: string }>) {
    const cur = counts.get(r.folder_id);
    if (!cur) continue;
    cur.n += 1;
    const ts = new Date(r.updated_at).getTime();
    if (!cur.lastDoc || ts > new Date(cur.lastDoc).getTime()) cur.lastDoc = r.updated_at;
  }

  const folderCards: ClientDocumentsTabFolderCardDto[] = folders.map((f, idx) => {
    const agg = counts.get(f.id) ?? { n: 0, lastDoc: null };
    const folderTs = f.updated_at ? new Date(f.updated_at).getTime() : 0;
    const docTs = agg.lastDoc ? new Date(agg.lastDoc).getTime() : 0;
    const lastIso = docTs >= folderTs && agg.lastDoc ? agg.lastDoc : f.updated_at || null;
    const is_system = Boolean(f.system_key);
    const canArchive = canEdit && !is_system && agg.n === 0;
    const defaultName = CLIENT_DOCUMENT_DEFAULT_FOLDERS.find((d) => d.system_key === f.system_key)?.name_he;
    const renamed = Boolean(f.system_key && defaultName && f.name_he !== defaultName);
    return {
      folder_id: f.id,
      name_he: f.name_he,
      name_key: renamed ? undefined : documentFolderLabelKey(f.system_key),
      system_key: f.system_key,
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
  if (openFolderMeta) {
    const folderMeta = openFolderMeta;
    {
      const extended = openDocsResult;
      const base = extended?.error
        ? await supabaseAdmin
            .from('client_documents')
            .select('id, file_asset_id, display_label_he, created_at, file_assets(file_name)')
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('folder_id', openFolderMeta.id)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
        : extended;
      const docRows = base?.data;
      const deliveryByDocument = new Map<string, 'pending' | 'sent' | 'failed'>();
      for (const attempt of deliveryAttempts) {
        if (!deliveryByDocument.has(attempt.sourceEntityId)) {
          deliveryByDocument.set(attempt.sourceEntityId, attempt.result);
        }
      }
      const mapped = ((docRows ?? []) as Array<{
        id: string;
        file_asset_id: string;
        display_label_he: string | null;
        created_at: string;
        evidence_kind?: string | null;
        reporting_period_key?: string | null;
        file_assets: { file_name: string | null } | { file_name: string | null }[] | null;
      }>).map((d) => {
        const fa = d.file_assets;
        const fn = Array.isArray(fa) ? fa[0]?.file_name : fa?.file_name;
        const evidenceKind: 'filing' | 'payment' | null =
          d.evidence_kind === 'filing' || d.evidence_kind === 'payment' ? d.evidence_kind : null;
        const periodKey = d.reporting_period_key ? String(d.reporting_period_key) : null;
        return {
          document_id: d.id,
          file_asset_id: d.file_asset_id ?? null,
          file_name_he: fn ?? null,
          display_label_he: d.display_label_he,
          uploaded_display_he: formatDateTimeHe(d.created_at),
          file_open_allowed: Boolean(d.file_asset_id),
          evidence_kind: evidenceKind,
          evidence_kind_key: evidenceKind === 'payment'
            ? CO_UI.reporting.filing.evidencePayment
            : evidenceKind === 'filing'
              ? CO_UI.reporting.filing.evidenceFiling
              : null,
          reporting_period_key: periodKey,
          reporting_period_display: periodKey ? formatReportingPeriodDisplayLabel(periodKey) : null,
          delivery: {
            result: deliveryByDocument.get(d.id) ?? null,
            ...clientDocumentDeliveryPresentation(deliveryByDocument.get(d.id) ?? null),
          },
          actions: {
            can_view: canViewDocumentsTab(ctx) && Boolean(d.file_asset_id),
            can_delete: canEdit,
            can_send: canEdit && Boolean(d.file_asset_id),
          },
        };
      });
      const periodKeys = [...new Set(mapped.map((d) => d.reporting_period_key).filter((k): k is string => Boolean(k)))].sort();
      const selectedPeriod = periodKeys.length ? periodKeys[periodKeys.length - 1]! : null;
      const documents = mapped;

      const defaultOpenName = CLIENT_DOCUMENT_DEFAULT_FOLDERS.find((d) => d.system_key === folderMeta.system_key)?.name_he;
      const openRenamed = Boolean(folderMeta.system_key && defaultOpenName && folderMeta.name_he !== defaultOpenName);
      open_folder = {
        folder_id: openFolderMeta.id,
        folder_name_he: folderMeta.name_he,
        folder_name_key: openRenamed ? undefined : documentFolderLabelKey(folderMeta.system_key),
        documents,
        period_navigation: filingFolder
          ? {
              selected_period_key: selectedPeriod,
              periods: periodKeys.map((period_key) => ({
                period_key,
                display_label: formatReportingPeriodDisplayLabel(period_key),
              })),
            }
          : null,
      };
    }
  }

  return {
    tab_key: 'client_documents',
    read_model_version,
    permissions: { can_view: true, can_edit: canEdit },
    ui: {
      tab_title_he: 'מסמכים',
      tab_title_key: CO_UI.documents.tabTitle,
      add_folder_label_he: 'הוסף תיקייה',
      add_folder_label_key: CO_UI.documents.addFolder,
      add_document_label_he: 'הוסף מסמך',
      add_document_label_key: CO_UI.documents.addDocument,
      empty_folders_state_he: 'אין תיקיות',
      empty_folders_state_key: CO_UI.documents.emptyFolders,
      empty_documents_state_he: 'אין מסמכים בתיקייה',
      empty_documents_state_key: CO_UI.documents.emptyDocuments,
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
  await assertCanAccessClientFromContext(ctx, clientId);
  await assertClientDocumentFileOpenAllowed(orgId, clientId, fileAssetId);
  const { data: fileAsset, error } = await supabaseAdmin
    .from('file_assets')
    .select('storage_key, storage_bucket, organization_id, scan_status')
    .eq('id', fileAssetId)
    .single();
  if (error || !fileAsset || (fileAsset as { organization_id?: string }).organization_id !== orgId) {
    throw forbidden('File not found');
  }
  const assetRow = fileAsset as { storage_key: string; storage_bucket?: string | null; scan_status?: string | null };
  assertFileAssetDownloadable(assetRow.scan_status);
  let signedUrl: string | null = null;
  for (const bucket of clientDocumentStorageReadOrder(assetRow.storage_bucket)) {
    const { data: signed, error: se } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(assetRow.storage_key, SIGNED_URL_SEC);
    if (!se && signed?.signedUrl) {
      signedUrl = signed.signedUrl;
      break;
    }
  }
  if (!signedUrl) throw badRequest('document file is not available', 'document_file_unavailable');
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_documents_workspace',
    entityId: clientId,
    action: AUDIT_ACTIONS.FILE_OPENED,
    payload: { client_id: clientId, file_asset_id: fileAssetId },
  });
  return { url: signedUrl };
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
  const guarded = await requireGuardedUpload({
    buf,
    fileName,
    claimedMime: body.mime_type,
    maxBytes: MAX_FILE,
  });
  const storageKey = `${orgId}/client-documents/${clientId}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(storageKey, buf, {
    contentType: guarded.mime,
    upsert: false,
  });
  if (upErr) throw new AppError(500, upErr.message ?? 'upload failed', 'SUPABASE_ERROR');

  const { data: asset, error: faErr } = await supabaseAdmin
    .from('file_assets')
    .insert({
      organization_id: orgId,
      storage_provider: 'supabase',
      storage_bucket: BUCKET,
      storage_key: storageKey,
      file_name: guarded.fileName,
      mime_type: guarded.mime,
      file_size: buf.length,
      uploaded_by: ctx.user.id,
      access_level: 'organization',
      scan_status: guarded.scanStatus,
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
  await assertCanAccessClientFromContext(ctx, clientId);
  await ensureClientInOrg(orgId, clientId);
  await ensureDocumentProfile(orgId, clientId);
  await ensureClientDocumentFolders(orgId, clientId);

  if (body == null || typeof body.type !== 'string') throw badRequest('פקודה לא תקינה');
  const expected = Number(body.expected_version);
  if (!Number.isFinite(expected)) throw badRequest('גרסה לא תקינה');
  await assertExpectedVersion(orgId, clientId, expected);
  const payload = asObj(body.payload);
  const cmd = body.type as ClientDocumentsCommandType;
  let profilePatch: Record<string, unknown> | null = null;

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
      let fileAssetId = String(payload.file_asset_id ?? '');
      if (!folderId) throw badRequest('folder_id וקובץ נדרשים');
      if (!fileAssetId && typeof payload.file_base64 === 'string' && payload.file_base64.length > 0) {
        const uploaded = await uploadClientWorkspaceDocument(ctx, orgId, clientId, {
          file_base64: payload.file_base64,
          file_name: typeof payload.file_name === 'string' ? payload.file_name : '',
          mime_type: typeof payload.mime_type === 'string' ? payload.mime_type : null,
        });
        fileAssetId = uploaded.file_asset_id;
      }
      if (!fileAssetId) throw badRequest('folder_id וקובץ נדרשים');
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
    case 'send_client_document_to_client': {
      const documentId = String(payload.document_id ?? '');
      if (!documentId) throw badRequest('document_id נדרש');
      const { data: doc } = await supabaseAdmin
        .from('client_documents')
        .select('id, file_asset_id')
        .eq('id', documentId)
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .is('deleted_at', null)
        .maybeSingle();
      if (!doc) throw badRequest('מסמך לא נמצא');
      const fileAssetId = String((doc as { file_asset_id?: string }).file_asset_id ?? '');
      if (!fileAssetId) throw badRequest('מסמך לא נמצא');
      const { data: client } = await supabaseAdmin
        .from('clients')
        .select('email, display_name')
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .maybeSingle();
      const email = String((client as { email?: string | null } | null)?.email ?? '').trim();
      if (!email) throw badRequest('client email is required', 'missing_client_email');
      const { data: asset, error: assetError } = await supabaseAdmin
        .from('file_assets')
        .select('id, organization_id, storage_bucket, storage_key, file_name, mime_type, scan_status')
        .eq('id', fileAssetId)
        .eq('organization_id', orgId)
        .maybeSingle();
      if (assetError || !asset) throw forbidden('File not found');
      const fileAsset = asset as {
        storage_bucket?: string | null;
        storage_key: string;
        file_name: string | null;
        mime_type: string | null;
        scan_status?: string | null;
      };
      const storageKey = String(fileAsset.storage_key ?? '');
      if (!storageKey.startsWith(`${orgId}/client-documents/${clientId}/`)) {
        throw forbidden('File not linked to this client documents workspace');
      }
      assertFileAssetDownloadable(fileAsset.scan_status);
      let fileData: { arrayBuffer: () => Promise<ArrayBuffer> } | null = null;
      let bucket = BUCKET;
      for (const candidate of clientDocumentStorageReadOrder(fileAsset.storage_bucket)) {
        const downloaded = await supabaseAdmin.storage.from(candidate).download(storageKey);
        if (!downloaded.error && downloaded.data) {
          fileData = downloaded.data;
          bucket = candidate;
          break;
        }
      }
      if (!fileData) throw badRequest('document file is not available', 'document_file_unavailable');
      const contentBase64 = Buffer.from(await fileData.arrayBuffer()).toString('base64');
      const fileName = fileAsset.file_name?.trim() || 'document';
      const english = ctx.user.uiLanguage === 'en';
      const subject = english ? 'Document from the office' : 'מסמך מהמשרד';
      const text = english
        ? `A document is attached: ${fileName}`
        : `מצורף מסמך: ${fileName}`;
      const html = english
        ? `<p>A document is attached: ${fileName}</p>`
        : `<div dir="rtl"><p>מצורף מסמך: ${fileName}</p></div>`;
      const attempt = await beginAttempt({
        organizationId: orgId,
        representedClientId: clientId,
        sourceModule: 'client-operations',
        sourceEntityType: 'client_document',
        sourceEntityId: documentId,
        channel: 'email',
        recipientEmail: email,
        senderSnapshotJson: { module: 'client-operations' },
        messageSnapshotJson: { subject, text },
        attachmentRefsJson: [
          {
            asset_id: fileAssetId,
            storage_ref: `${bucket}/${storageKey}`,
            filename: fileName,
            content_type: fileAsset.mime_type,
          },
        ],
        idempotencyKey: `client-document:${documentId}:${crypto.randomUUID()}`,
        sentByUserId: ctx.user.id,
      });
      const sendResult = await sendEmail({
        organizationId: orgId,
        to: email,
        subject,
        body_text: text,
        body_html: html,
        attachments: [
          {
            filename: fileName,
            content_type: fileAsset.mime_type,
            content_base64: contentBase64,
          },
        ],
      });
      const finalized = await finalizeAttempt({
        attemptId: attempt.id,
        organizationId: orgId,
        result: sendResult.status,
        failureReason: sendResult.failure_reason,
        providerMessageId: sendResult.provider_message_id,
      });
      await auditDocuments(ctx, orgId, clientId, cmd, {
        document_id: documentId,
        file_asset_id: fileAssetId,
        delivery_attempt_id: finalized.id,
        delivery_channel: 'email',
        recipient_email: email,
        provider_message_id: finalized.providerMessageId,
        provider_confirmed: false,
        delivery_result: finalized.result,
        failure_reason: finalized.failureReason,
      });
      break;
    }
    case 'open_client_document_folder': {
      const raw = payload.folder_id;
      const folderId = raw == null || raw === '' ? null : String(raw);
      if (folderId) {
        const folder = await fetchFolder(orgId, clientId, folderId);
        if (!folder || folder.archived_at) throw badRequest('תיקייה לא נמצאה');
      }
      profilePatch = { open_folder_id: folderId };
      break;
    }
    default:
      throw badRequest('סוג פקודה לא מוכר');
  }

  await bumpReadModelVersion(orgId, clientId, expected, ctx.user.id, profilePatch);
}
