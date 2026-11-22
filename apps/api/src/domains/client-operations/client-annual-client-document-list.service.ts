import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, forbidden } from '../../shared/errors.js';
import { requireGuardedUpload } from '../../shared/file-content-guard.js';
import { beginAttempt, finalizeAttempt, sendEmail } from '../delivery/index.js';
import { renderIncomeDocumentPdfBufferFromHtml } from '../income/income-document-pdf.renderer.js';
import { executeDocflowOfficeCommand } from '../docflow/docflow-commands.service.js';
import {
  buildClientDocumentListPdfHtml,
  buildClientDocumentListPdfSnapshot,
  defaultIncludeInClientList,
  overlayClientListSelection,
  projectClientDocumentListItems,
  type ClientDocumentListItemInput,
  type ClientDocumentListPdfSnapshot,
  type ClientFacingDocumentListItem,
} from './client-annual-client-document-list.pure.js';
import { CLIENT_DOCUMENT_STORAGE_BUCKET, clientDocumentStorageReadOrder } from './client-operations-filing-evidence.pure.js';

type AnnualTabScope = 'annual_report' | 'capital_declaration';

export type AnnualClientDocumentListSection = {
  title_key: string;
  generate_label_key: string;
  preview_label_key: string;
  download_label_key: string;
  send_label_key: string;
  email_label_key: string;
  include_label_key: string;
  empty_key: string;
  can_generate: boolean;
  can_send: boolean;
  can_send_email: boolean;
  recipient_email: string | null;
  items: ClientFacingDocumentListItem[];
  preview: {
    file_asset_id: string | null;
    generated_at: string | null;
    can_open: boolean;
  };
  send_history: Array<{
    send_id: string;
    generated_at: string;
    file_asset_id: string;
    docflow_message_id: string | null;
    frozen: true;
  }>;
  docflow_threads: Array<{ thread_id: string; label: string }>;
};

const LIST_KEYS = {
  title: 'clientOperations.annual.clientDocumentList',
  generate: 'clientOperations.annual.clientDocumentListGenerate',
  preview: 'clientOperations.annual.clientDocumentListPreview',
  download: 'clientOperations.annual.clientDocumentListDownload',
  send: 'clientOperations.annual.clientDocumentListSend',
  email: 'clientOperations.annual.clientDocumentListEmail',
  include: 'clientOperations.annual.clientDocumentListInclude',
  empty: 'clientOperations.annual.clientDocumentListEmpty',
};

let clientListColumnCache: boolean | null = null;
export async function supportsAnnualClientListColumns(): Promise<boolean> {
  if (clientListColumnCache != null) return clientListColumnCache;
  const { error } = await supabaseAdmin.from('client_annual_document_rows').select('include_in_client_list').limit(0);
  clientListColumnCache = !error;
  return clientListColumnCache;
}

function asDocumentListInput(row: Record<string, unknown>): ClientDocumentListItemInput {
  return {
    row_id: String(row.id ?? row.row_id ?? ''),
    source_type: String(row.source_type) === 'custom' ? 'custom' : 'system',
    system_key: row.system_key != null ? String(row.system_key) : null,
    document_name_he: String(row.document_name_he ?? ''),
    description_he: row.description_he != null ? String(row.description_he) : null,
    include_in_client_list: Boolean(
      row.include_in_client_list ??
        defaultIncludeInClientList({
          sourceType: String(row.source_type) === 'custom' ? 'custom' : 'system',
          tabScope: String(row.tab_scope) === 'capital_declaration' ? 'capital_declaration' : 'annual_report',
          required: row.required as boolean | null | undefined,
        }),
    ),
    client_facing_name_he: row.client_facing_name_he != null ? String(row.client_facing_name_he) : null,
    client_facing_description_he:
      row.client_facing_description_he != null ? String(row.client_facing_description_he) : null,
  };
}

function periodLabel(scope: AnnualTabScope, taxYear: number | null, declarationDate: string | null): string {
  if (scope === 'capital_declaration') {
    return declarationDate ? `תאריך הצהרה: ${declarationDate}` : 'הצהרת הון';
  }
  return taxYear != null ? `שנת מס ${taxYear}` : 'דוח שנתי';
}

export async function buildAnnualClientDocumentListSection(input: {
  orgId: string;
  clientId: string;
  scope: AnnualTabScope;
  canEdit: boolean;
  documentRows: Array<Record<string, unknown>>;
}): Promise<AnnualClientDocumentListSection> {
  const items = projectClientDocumentListItems(input.documentRows.map(asDocumentListInput));
  const [sends, threads, clientEmail] = await Promise.all([
    loadDocumentListSends(input.orgId, input.clientId, input.scope),
    loadDocflowThreads(input.orgId, input.clientId),
    loadClientEmail(input.orgId, input.clientId),
  ]);
  const latest = sends[0] ?? null;
  return {
    title_key: LIST_KEYS.title,
    generate_label_key: LIST_KEYS.generate,
    preview_label_key: LIST_KEYS.preview,
    download_label_key: LIST_KEYS.download,
    send_label_key: LIST_KEYS.send,
    email_label_key: LIST_KEYS.email,
    include_label_key: LIST_KEYS.include,
    empty_key: LIST_KEYS.empty,
    can_generate: input.canEdit,
    can_send: input.canEdit && Boolean(latest?.file_asset_id) && threads.length > 0,
    can_send_email: input.canEdit && Boolean(latest?.file_asset_id) && Boolean(clientEmail),
    recipient_email: clientEmail,
    items,
    preview: {
      file_asset_id: latest?.file_asset_id ?? null,
      generated_at: latest?.created_at ?? null,
      can_open: Boolean(latest?.file_asset_id),
    },
    send_history: sends.map((row) => ({
      send_id: row.id,
      generated_at: row.created_at,
      file_asset_id: row.file_asset_id,
      docflow_message_id: row.docflow_message_id,
      frozen: true as const,
    })),
    docflow_threads: threads,
  };
}

async function loadDocumentListSends(
  orgId: string,
  clientId: string,
  scope: AnnualTabScope,
): Promise<Array<{
  id: string;
  file_asset_id: string;
  created_at: string;
  docflow_message_id: string | null;
}>> {
  const { data, error } = await supabaseAdmin
    .from('client_annual_document_list_sends')
    .select('id, file_asset_id, created_at, docflow_message_id')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('tab_scope', scope)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return [];
  return ((data ?? []) as Array<{
    id: string;
    file_asset_id: string;
    created_at: string;
    docflow_message_id: string | null;
  }>).map((row) => ({
    id: String(row.id),
    file_asset_id: String(row.file_asset_id),
    created_at: String(row.created_at),
    docflow_message_id: row.docflow_message_id ? String(row.docflow_message_id) : null,
  }));
}

async function loadClientEmail(orgId: string, clientId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('email')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  if (error) return null;
  const email = String((data as { email?: string | null } | null)?.email ?? '').trim();
  return email || null;
}

async function loadDocflowThreads(
  orgId: string,
  clientId: string,
): Promise<Array<{ thread_id: string; label: string }>> {
  const { data, error } = await supabaseAdmin
    .from('client_message_threads')
    .select('id, thread_type, updated_at')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .neq('thread_status', 'archived')
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error) return [];
  return ((data ?? []) as Array<{ id: string; thread_type?: string | null }>).map((row, index) => ({
    thread_id: String(row.id),
    label: String(row.thread_type ?? '').trim() || `DocFlow ${index + 1}`,
  }));
}

export async function setAnnualDocumentClientListInclusion(input: {
  orgId: string;
  clientId: string;
  rowId: string;
  include: boolean;
}): Promise<void> {
  if (!(await supportsAnnualClientListColumns())) throw badRequest('client document list is not available');
  const { data, error } = await supabaseAdmin
    .from('client_annual_document_rows')
    .update({ include_in_client_list: input.include })
    .eq('id', input.rowId)
    .eq('organization_id', input.orgId)
    .eq('client_id', input.clientId)
    .select('id');
  if (error) throw badRequest('client document list update failed');
  if (!data?.length) throw badRequest('שורה לא נמצאה');
}

/** Persists PDF include flags only. Does not touch received, names, order, or files. */
export async function applyAnnualDocumentClientListSelection(input: {
  orgId: string;
  clientId: string;
  rowIds: string[];
  selectedRowIds: string[];
}): Promise<void> {
  if (!(await supportsAnnualClientListColumns())) throw badRequest('client document list is not available');
  const allowed = new Set(input.rowIds.map((id) => String(id)).filter(Boolean));
  const selected = new Set(input.selectedRowIds.map((id) => String(id)).filter((id) => allowed.has(id)));
  const includeIds = [...allowed].filter((id) => selected.has(id));
  const excludeIds = [...allowed].filter((id) => !selected.has(id));
  const patch = async (ids: string[], include: boolean) => {
    if (!ids.length) return;
    const { error } = await supabaseAdmin
      .from('client_annual_document_rows')
      .update({ include_in_client_list: include })
      .eq('organization_id', input.orgId)
      .eq('client_id', input.clientId)
      .in('id', ids);
    if (error) throw badRequest('client document list update failed');
  };
  await patch(includeIds, true);
  await patch(excludeIds, false);
}

async function uploadGeneratedListPdf(input: {
  ctx: RequestContext;
  orgId: string;
  clientId: string;
  scope: AnnualTabScope;
  pdf: Buffer;
}): Promise<string> {
  const fileName = 'client-document-list.pdf';
  const guarded = await requireGuardedUpload({
    buf: input.pdf,
    fileName,
    claimedMime: 'application/pdf',
    maxBytes: 8_000_000,
  });
  const storageScope = input.scope === 'capital_declaration' ? 'capital-declaration' : 'annual-report';
  const storageKey = `${input.orgId}/${storageScope}/${input.clientId}/document-list-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { error: upErr } = await supabaseAdmin.storage.from('client-files').upload(storageKey, input.pdf, {
    contentType: guarded.mime,
    upsert: false,
  });
  if (upErr) throw badRequest('client document list upload failed');
  const { data: asset, error: faErr } = await supabaseAdmin
    .from('file_assets')
    .insert({
      organization_id: input.orgId,
      storage_provider: 'supabase',
      storage_bucket: 'client-files',
      storage_key: storageKey,
      file_name: guarded.fileName,
      mime_type: guarded.mime,
      file_size: input.pdf.length,
      uploaded_by: input.ctx.user.id,
      access_level: 'organization',
      scan_status: guarded.scanStatus,
    })
    .select('id')
    .single();
  if (faErr || !asset) throw badRequest('client document list file record failed');
  await writeAudit({
    organizationId: input.orgId,
    actorUserId: input.ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_annual_report_file',
    entityId: input.clientId,
    action: AUDIT_ACTIONS.CLIENT_FILE_ATTACHED,
    payload: {
      client_id: input.clientId,
      file_asset_id: String((asset as { id: string }).id),
      context: 'client_document_list_pdf',
      tab_scope: input.scope,
    },
  });
  return String((asset as { id: string }).id);
}

export async function generateAnnualClientDocumentListPdf(input: {
  ctx: RequestContext;
  orgId: string;
  clientId: string;
  scope: AnnualTabScope;
  documentRows: Array<Record<string, unknown>>;
  workingTaxYear: number | null;
  assignedDueDate: string | null;
  selectedRowIds?: string[] | null;
}): Promise<{ file_asset_id: string; snapshot: ClientDocumentListPdfSnapshot }> {
  const [{ data: org }, { data: client }] = await Promise.all([
    supabaseAdmin.from('organizations').select('name').eq('id', input.orgId).maybeSingle(),
    supabaseAdmin
      .from('clients')
      .select('display_name')
      .eq('id', input.clientId)
      .eq('organization_id', input.orgId)
      .maybeSingle(),
  ]);
  const officeName = String((org as { name?: string | null } | null)?.name ?? '').trim() || 'NodexPro';
  const clientName =
    String((client as { display_name?: string | null } | null)?.display_name ?? '').trim() || input.clientId;
  const projected = projectClientDocumentListItems(input.documentRows.map(asDocumentListInput));
  const items =
    input.selectedRowIds != null ? overlayClientListSelection(projected, input.selectedRowIds) : projected;
  const snapshot = buildClientDocumentListPdfSnapshot({
    tabScope: input.scope,
    officeName,
    clientName,
    periodLabel: periodLabel(input.scope, input.workingTaxYear, input.assignedDueDate),
    generatedAt: new Date().toISOString(),
    items,
  });
  if (!snapshot.items.length) throw badRequest('no client documents selected');
  const htmlStarted = Date.now();
  const html = buildClientDocumentListPdfHtml(snapshot);
  const htmlMs = Date.now() - htmlStarted;
  const pdfStarted = Date.now();
  const pdf = await renderIncomeDocumentPdfBufferFromHtml(html);
  const pdfMs = Date.now() - pdfStarted;
  console.info('[client-document-list-pdf] stages', { htmlMs, pdfMs, items: snapshot.items.length });
  const fileAssetId = await uploadGeneratedListPdf({
    ctx: input.ctx,
    orgId: input.orgId,
    clientId: input.clientId,
    scope: input.scope,
    pdf,
  });
  const { error } = await supabaseAdmin.from('client_annual_document_list_sends').insert({
    organization_id: input.orgId,
    client_id: input.clientId,
    tab_scope: input.scope,
    tax_year: input.workingTaxYear,
    declaration_date: input.assignedDueDate,
    file_asset_id: fileAssetId,
    snapshot_json: snapshot,
    created_by: input.ctx.user.id,
  });
  if (error) throw badRequest('client document list snapshot storage is not ready');
  return { file_asset_id: fileAssetId, snapshot };
}

async function loadLatestDocumentListSend(input: {
  orgId: string;
  clientId: string;
  scope: AnnualTabScope;
  sendId?: string | null;
}): Promise<{ id: string; file_asset_id: string }> {
  let sendQ = supabaseAdmin
    .from('client_annual_document_list_sends')
    .select('id, file_asset_id, snapshot_json')
    .eq('organization_id', input.orgId)
    .eq('client_id', input.clientId)
    .eq('tab_scope', input.scope);
  if (input.sendId) sendQ = sendQ.eq('id', input.sendId);
  const { data: sendRow, error } = await sendQ.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error || !sendRow) throw badRequest('generate the client document list PDF before sending');
  return {
    id: String((sendRow as { id: string }).id),
    file_asset_id: String((sendRow as { file_asset_id: string }).file_asset_id),
  };
}

async function downloadDocumentListPdf(input: {
  orgId: string;
  fileAssetId: string;
}): Promise<{ fileName: string; mimeType: string; fileBase64: string }> {
  const { data: asset, error: assetError } = await supabaseAdmin
    .from('file_assets')
    .select('id, organization_id, storage_bucket, storage_key, file_name, mime_type')
    .eq('id', input.fileAssetId)
    .eq('organization_id', input.orgId)
    .maybeSingle();
  if (assetError || !asset) throw forbidden('File not found');
  const fileAsset = asset as {
    storage_bucket?: string | null;
    storage_key: string;
    file_name: string | null;
    mime_type: string | null;
  };
  let fileData: { arrayBuffer: () => Promise<ArrayBuffer> } | null = null;
  for (const candidate of clientDocumentStorageReadOrder(fileAsset.storage_bucket ?? CLIENT_DOCUMENT_STORAGE_BUCKET)) {
    const downloaded = await supabaseAdmin.storage.from(candidate).download(fileAsset.storage_key);
    if (!downloaded.error && downloaded.data) {
      fileData = downloaded.data;
      break;
    }
  }
  if (!fileData) {
    const downloaded = await supabaseAdmin.storage.from('client-files').download(fileAsset.storage_key);
    if (!downloaded.error && downloaded.data) fileData = downloaded.data;
  }
  if (!fileData) throw badRequest('document file is not available');
  return {
    fileName: fileAsset.file_name?.trim() || 'client-document-list.pdf',
    mimeType: fileAsset.mime_type || 'application/pdf',
    fileBase64: Buffer.from(await fileData.arrayBuffer()).toString('base64'),
  };
}

export async function sendAnnualClientDocumentListViaDocflow(input: {
  ctx: RequestContext;
  orgId: string;
  clientId: string;
  scope: AnnualTabScope;
  threadId: string;
  sendId?: string | null;
}): Promise<void> {
  const threadId = String(input.threadId ?? '').trim();
  if (!threadId) throw badRequest('thread_id required');
  const sendRow = await loadLatestDocumentListSend(input);
  const file = await downloadDocumentListPdf({ orgId: input.orgId, fileAssetId: sendRow.file_asset_id });
  const fileBase64 = file.fileBase64;
  const fileName = file.fileName;
  const body =
    input.ctx.user.uiLanguage === 'en' ? 'Client document list' : 'רשימת מסמכים ללקוח';
  const sendId = String((sendRow as { id: string }).id);
  const idempotencyKey = `client-document-list:${sendId}:${threadId}`;
  await executeDocflowOfficeCommand(input.ctx, 'send_office_message_with_attachment', {
    client_id: input.clientId,
    thread_id: threadId,
    file_base64: fileBase64,
    file_name: fileName,
    mime_type: file.mimeType,
    body,
    idempotency_key: idempotencyKey,
  });
  const { data: sentMessage } = await supabaseAdmin
    .from('client_messages')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('client_id', input.clientId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  const messageId = String((sentMessage as { id?: string } | null)?.id ?? '').trim();
  if (messageId) {
    const { error: sendUpdateError } = await supabaseAdmin
      .from('client_annual_document_list_sends')
      .update({ docflow_message_id: messageId })
      .eq('id', sendId)
      .eq('organization_id', input.orgId)
      .eq('client_id', input.clientId);
    if (sendUpdateError) throw badRequest('client document list send history update failed');
  }
}

export async function sendAnnualClientDocumentListViaEmail(input: {
  ctx: RequestContext;
  orgId: string;
  clientId: string;
  scope: AnnualTabScope;
  sendId?: string | null;
}): Promise<void> {
  const sendRow = await loadLatestDocumentListSend(input);
  const email = await loadClientEmail(input.orgId, input.clientId);
  if (!email) throw badRequest('client email is required', 'missing_client_email');
  const file = await downloadDocumentListPdf({ orgId: input.orgId, fileAssetId: sendRow.file_asset_id });
  const english = input.ctx.user.uiLanguage === 'en';
  const subject = english ? 'Client document list' : 'רשימת מסמכים ללקוח';
  const text = english ? `A document is attached: ${file.fileName}` : `מצורף מסמך: ${file.fileName}`;
  const html = english
    ? `<p>A document is attached: ${file.fileName}</p>`
    : `<div dir="rtl"><p>מצורף מסמך: ${file.fileName}</p></div>`;
  const attempt = await beginAttempt({
    organizationId: input.orgId,
    representedClientId: input.clientId,
    sourceModule: 'client-operations',
    sourceEntityType: 'client_annual_document_list',
    sourceEntityId: sendRow.id,
    channel: 'email',
    recipientEmail: email,
    senderSnapshotJson: { module: 'client-operations', tab_scope: input.scope },
    messageSnapshotJson: { subject, text },
    attachmentRefsJson: [
      {
        asset_id: sendRow.file_asset_id,
        filename: file.fileName,
        content_type: file.mimeType,
      },
    ],
    idempotencyKey: `client-document-list-email:${sendRow.id}:${crypto.randomUUID()}`,
    sentByUserId: input.ctx.user.id,
  });
  const sendResult = await sendEmail({
    organizationId: input.orgId,
    to: email,
    subject,
    body_text: text,
    body_html: html,
    attachments: [
      {
        filename: file.fileName,
        content_type: file.mimeType,
        content_base64: file.fileBase64,
      },
    ],
  });
  const finalized = await finalizeAttempt({
    attemptId: attempt.id,
    organizationId: input.orgId,
    result: sendResult.status,
    failureReason: sendResult.failure_reason,
    providerMessageId: sendResult.provider_message_id,
  });
  if (finalized.result !== 'sent') {
    throw badRequest(finalized.failureReason || 'email send failed');
  }
}
