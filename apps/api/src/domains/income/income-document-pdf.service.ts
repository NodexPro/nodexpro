/**
 * INC-6 — Income document PDF render + file_assets storage.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { notFound } from '../../shared/errors.js';
import { assertRowMatchesIssuerScope, type ActiveIncomeIssuerScope } from './income.guards.js';
import { loadActiveIncomeIssuerScope } from './income-issuer-scope.service.js';
import { buildUnifiedIncomeDocumentPrintHtml } from './income-document-unified-render.html.js';
import {
  buildUnifiedIncomeDocumentRenderAuditSnapshot,
} from './income-document-unified-render.pure.js';
import {
  buildUnifiedIncomeDocumentRenderModelForIssuedDocument,
  type IssuedIncomeDocumentForRender,
} from './income-document-unified-render.service.js';
import { renderIncomeDocumentPdfBufferFromHtml } from './income-document-pdf.renderer.js';
import { requiresPdfRender } from './income-pdf-template.resolver.js';

const BUCKET_INCOME_DOCUMENTS = 'income-documents';
let bucketEnsured = false;

async function ensureIncomeDocumentsBucket(): Promise<void> {
  if (bucketEnsured) return;
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET_INCOME_DOCUMENTS, {
    public: false,
  });
  if (error && !error.message?.toLowerCase().includes('already exists')) {
    console.warn('[income-pdf] bucket create:', error.message);
  }
  bucketEnsured = true;
}

interface IssuedDocForPdf extends IssuedIncomeDocumentForRender {
  pdf_render_status: string;
  pdf_asset_id: string | null;
}

async function loadIssuedDocumentForPdf(orgId: string, documentId: string): Promise<IssuedDocForPdf> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, organization_id, issuer_business_id, represented_client_id, document_type, document_number, issue_date, due_date, currency, language, notes, issuer_snapshot_json, customer_snapshot_json, lines_snapshot_json, totals_snapshot_json, legal_snapshot_json, source_draft_id, pdf_render_status, pdf_asset_id',
    )
    .eq('id', documentId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Income document not found');
  return data as IssuedDocForPdf;
}

async function storePdfAsset(
  ctx: RequestContext,
  orgId: string,
  documentNumber: string,
  pdfBuffer: Buffer,
): Promise<string> {
  await ensureIncomeDocumentsBucket();
  const storageKey = `${orgId}/income/${Date.now()}-${documentNumber.replace(/[^\w.-]+/g, '_')}.pdf`;
  const { error: uploadErr } = await supabaseAdmin.storage
    .from(BUCKET_INCOME_DOCUMENTS)
    .upload(storageKey, pdfBuffer, { contentType: 'application/pdf', upsert: false });
  if (uploadErr) throw uploadErr;

  const { data: asset, error: assetErr } = await supabaseAdmin
    .from('file_assets')
    .insert({
      organization_id: orgId,
      storage_provider: 'supabase',
      storage_bucket: BUCKET_INCOME_DOCUMENTS,
      storage_key: storageKey,
      file_name: `${documentNumber}.pdf`,
      mime_type: 'application/pdf',
      file_size: pdfBuffer.length,
      uploaded_by: ctx.user.id,
      access_level: 'organization',
    })
    .select('id')
    .single();
  if (assetErr || !asset) throw assetErr ?? new Error('Failed to create PDF file asset');
  return (asset as { id: string }).id;
}

export async function renderIncomeDocumentPdf(
  ctx: RequestContext,
  orgId: string,
  incomeDocumentId: string,
): Promise<{ pdf_asset_id: string | null; pdf_render_status: string }> {
  const doc = await loadIssuedDocumentForPdf(orgId, incomeDocumentId);

  if (!requiresPdfRender(doc.document_type)) {
    await supabaseAdmin
      .from('income_documents')
      .update({ pdf_render_status: 'rendered', pdf_render_error: null })
      .eq('id', incomeDocumentId)
      .eq('organization_id', orgId);
    return { pdf_asset_id: null, pdf_render_status: 'rendered' };
  }

  if (doc.pdf_render_status === 'rendered' && doc.pdf_asset_id) {
    return { pdf_asset_id: doc.pdf_asset_id, pdf_render_status: 'rendered' };
  }

  await supabaseAdmin
    .from('income_documents')
    .update({ pdf_render_status: 'pending', pdf_render_error: null })
    .eq('id', incomeDocumentId)
    .eq('organization_id', orgId);

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'income',
    entityType: 'income_document',
    entityId: incomeDocumentId,
    action: AUDIT_ACTIONS.INCOME_PDF_RENDER_STARTED,
    payload: { document_number: doc.document_number, document_type: doc.document_type },
  });

  try {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    const renderModel = await buildUnifiedIncomeDocumentRenderModelForIssuedDocument(scope, doc);
    const printHtml = buildUnifiedIncomeDocumentPrintHtml(renderModel);
    const pdfBuffer = await renderIncomeDocumentPdfBufferFromHtml(printHtml);
    const assetId = await storePdfAsset(ctx, orgId, doc.document_number, pdfBuffer);
    const renderedAt = new Date().toISOString();
    const renderAuditSnapshot = buildUnifiedIncomeDocumentRenderAuditSnapshot(renderModel);

    await supabaseAdmin
      .from('income_documents')
      .update({
        pdf_render_status: 'rendered',
        pdf_asset_id: assetId,
        pdf_rendered_at: renderedAt,
        pdf_render_error: null,
        render_snapshot_json: renderAuditSnapshot,
        pdf_template_key: 'unified_income_document_v1',
      })
      .eq('id', incomeDocumentId)
      .eq('organization_id', orgId);

    await writeAudit({
      organizationId: orgId,
      actorUserId: ctx.user.id,
      moduleCode: 'income',
      entityType: 'income_document',
      entityId: incomeDocumentId,
      action: AUDIT_ACTIONS.INCOME_PDF_RENDER_SUCCEEDED,
      payload: { pdf_asset_id: assetId, template_key: 'unified_income_document_v1' },
    });

    return { pdf_asset_id: assetId, pdf_render_status: 'rendered' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'PDF render failed';
    await supabaseAdmin
      .from('income_documents')
      .update({
        pdf_render_status: 'failed',
        pdf_render_error: message.slice(0, 2000),
      })
      .eq('id', incomeDocumentId)
      .eq('organization_id', orgId);

    await writeAudit({
      organizationId: orgId,
      actorUserId: ctx.user.id,
      moduleCode: 'income',
      entityType: 'income_document',
      entityId: incomeDocumentId,
      action: AUDIT_ACTIONS.INCOME_PDF_RENDER_FAILED,
      payload: { error: message },
    });

    return { pdf_asset_id: null, pdf_render_status: 'failed' };
  }
}

export async function assertIncomeDocumentDownloadScope(
  scope: ActiveIncomeIssuerScope,
  doc: { organization_id: string; issuer_business_id: string; represented_client_id: string | null },
): Promise<void> {
  assertRowMatchesIssuerScope(scope, doc);
}

export async function loadIncomeDocumentForDownload(
  ctx: RequestContext,
  incomeDocumentId: string,
): Promise<{
  doc: IssuedDocForPdf;
  scope: ActiveIncomeIssuerScope;
}> {
  const scope = await loadActiveIncomeIssuerScope(ctx);
  const doc = await loadIssuedDocumentForPdf(scope.org_id, incomeDocumentId);
  await assertIncomeDocumentDownloadScope(scope, doc);
  return { doc, scope };
}

export function incomeDocumentDownloadPath(incomeDocumentId: string): string {
  return `/api/v1/income/documents/${incomeDocumentId}/download`;
}

export async function loadIssuedDocumentPdfBytesForEmail(
  orgId: string,
  pdfAssetId: string,
): Promise<{ buffer: Buffer; fileName: string; storageBucket: string; storageKey: string }> {
  const { data: asset, error: assetErr } = await supabaseAdmin
    .from('file_assets')
    .select('storage_bucket, storage_key, file_name')
    .eq('id', pdfAssetId)
    .eq('organization_id', orgId)
    .single();
  if (assetErr || !asset) throw notFound('PDF file asset not found');

  const bucket =
    (asset as { storage_bucket?: string | null }).storage_bucket ?? BUCKET_INCOME_DOCUMENTS;
  const key = (asset as { storage_key: string }).storage_key;
  const { data: fileData, error: dlErr } = await supabaseAdmin.storage.from(bucket).download(key);
  if (dlErr || !fileData) throw notFound('PDF file not found in storage');

  return {
    buffer: Buffer.from(await fileData.arrayBuffer()),
    fileName: (asset as { file_name: string }).file_name || 'document.pdf',
    storageBucket: bucket,
    storageKey: key,
  };
}

export async function downloadIncomeDocumentPdfBuffer(
  ctx: RequestContext,
  incomeDocumentId: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const { doc } = await loadIncomeDocumentForDownload(ctx, incomeDocumentId);
  if (doc.pdf_render_status !== 'rendered' || !doc.pdf_asset_id) {
    throw notFound('PDF is not available for this document');
  }

  const { data: asset, error: assetErr } = await supabaseAdmin
    .from('file_assets')
    .select('storage_bucket, storage_key, file_name')
    .eq('id', doc.pdf_asset_id)
    .eq('organization_id', doc.organization_id)
    .single();
  if (assetErr || !asset) throw notFound('PDF file asset not found');

  const bucket =
    (asset as { storage_bucket?: string | null }).storage_bucket ?? BUCKET_INCOME_DOCUMENTS;
  const key = (asset as { storage_key: string }).storage_key;
  const { data: fileData, error: dlErr } = await supabaseAdmin.storage.from(bucket).download(key);
  if (dlErr || !fileData) throw notFound('PDF file not found in storage');

  await writeAudit({
    organizationId: doc.organization_id,
    actorUserId: ctx.user.id,
    moduleCode: 'income',
    entityType: 'income_document',
    entityId: incomeDocumentId,
    action: AUDIT_ACTIONS.INCOME_PDF_DOWNLOADED,
    payload: { pdf_asset_id: doc.pdf_asset_id },
  });

  return {
    buffer: Buffer.from(await fileData.arrayBuffer()),
    fileName: (asset as { file_name: string }).file_name || `${doc.document_number}.pdf`,
  };
}
