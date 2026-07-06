/**
 * INC-6 — Income document PDF render + file_assets storage.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { notFound } from '../../shared/errors.js';
import { assertRowMatchesIssuerScope } from './income.guards.js';
import { loadActiveIncomeIssuerScope } from './income-issuer-scope.service.js';
import { buildIncomeDocumentRenderSnapshot } from './income-document-render-snapshot.builders.js';
import { renderIncomeDocumentPdfBuffer } from './income-document-pdf.renderer.js';
import { requiresPdfRender } from './income-pdf-template.resolver.js';
const BUCKET_INCOME_DOCUMENTS = 'income-documents';
let bucketEnsured = false;
async function ensureIncomeDocumentsBucket() {
    if (bucketEnsured)
        return;
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET_INCOME_DOCUMENTS, {
        public: false,
    });
    if (error && !error.message?.toLowerCase().includes('already exists')) {
        console.warn('[income-pdf] bucket create:', error.message);
    }
    bucketEnsured = true;
}
async function loadIssuedDocumentForPdf(orgId, documentId) {
    const { data, error } = await supabaseAdmin
        .from('income_documents')
        .select('id, organization_id, issuer_business_id, represented_client_id, document_type, document_number, issue_date, currency, language, notes, issuer_snapshot_json, customer_snapshot_json, lines_snapshot_json, totals_snapshot_json, legal_snapshot_json, pdf_render_status, pdf_asset_id')
        .eq('id', documentId)
        .eq('organization_id', orgId)
        .maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw notFound('Income document not found');
    return data;
}
async function storePdfAsset(ctx, orgId, documentNumber, pdfBuffer) {
    await ensureIncomeDocumentsBucket();
    const storageKey = `${orgId}/income/${Date.now()}-${documentNumber.replace(/[^\w.-]+/g, '_')}.pdf`;
    const { error: uploadErr } = await supabaseAdmin.storage
        .from(BUCKET_INCOME_DOCUMENTS)
        .upload(storageKey, pdfBuffer, { contentType: 'application/pdf', upsert: false });
    if (uploadErr)
        throw uploadErr;
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
    if (assetErr || !asset)
        throw assetErr ?? new Error('Failed to create PDF file asset');
    return asset.id;
}
export async function renderIncomeDocumentPdf(ctx, orgId, incomeDocumentId) {
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
        const { data: settings } = await supabaseAdmin
            .from('organization_settings')
            .select('document_footer_note')
            .eq('organization_id', orgId)
            .maybeSingle();
        const snapshot = buildIncomeDocumentRenderSnapshot({
            document_type: doc.document_type,
            document_number: doc.document_number,
            issue_date: doc.issue_date,
            currency: doc.currency,
            language: doc.language,
            notes: doc.notes,
            issuer_snapshot_json: doc.issuer_snapshot_json ?? {},
            customer_snapshot_json: doc.customer_snapshot_json ?? {},
            lines_snapshot_json: Array.isArray(doc.lines_snapshot_json) ? doc.lines_snapshot_json : [],
            totals_snapshot_json: doc.totals_snapshot_json,
            legal_snapshot_json: doc.legal_snapshot_json,
            organization_footer_note: settings
                ?.document_footer_note,
        });
        const pdfBuffer = await renderIncomeDocumentPdfBuffer(snapshot);
        const assetId = await storePdfAsset(ctx, orgId, doc.document_number, pdfBuffer);
        const renderedAt = new Date().toISOString();
        await supabaseAdmin
            .from('income_documents')
            .update({
            pdf_render_status: 'rendered',
            pdf_asset_id: assetId,
            pdf_rendered_at: renderedAt,
            pdf_render_error: null,
            render_snapshot_json: snapshot,
            pdf_template_key: snapshot.template.template_key,
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
            payload: { pdf_asset_id: assetId, template_key: snapshot.template.template_key },
        });
        return { pdf_asset_id: assetId, pdf_render_status: 'rendered' };
    }
    catch (err) {
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
export async function assertIncomeDocumentDownloadScope(scope, doc) {
    assertRowMatchesIssuerScope(scope, doc);
}
export async function loadIncomeDocumentForDownload(ctx, incomeDocumentId) {
    const scope = await loadActiveIncomeIssuerScope(ctx);
    const doc = await loadIssuedDocumentForPdf(scope.org_id, incomeDocumentId);
    await assertIncomeDocumentDownloadScope(scope, doc);
    return { doc, scope };
}
export function incomeDocumentDownloadPath(incomeDocumentId) {
    return `/api/v1/income/documents/${incomeDocumentId}/download`;
}
export async function loadIssuedDocumentPdfBytesForEmail(orgId, pdfAssetId) {
    const { data: asset, error: assetErr } = await supabaseAdmin
        .from('file_assets')
        .select('storage_bucket, storage_key, file_name')
        .eq('id', pdfAssetId)
        .eq('organization_id', orgId)
        .single();
    if (assetErr || !asset)
        throw notFound('PDF file asset not found');
    const bucket = asset.storage_bucket ?? BUCKET_INCOME_DOCUMENTS;
    const key = asset.storage_key;
    const { data: fileData, error: dlErr } = await supabaseAdmin.storage.from(bucket).download(key);
    if (dlErr || !fileData)
        throw notFound('PDF file not found in storage');
    return {
        buffer: Buffer.from(await fileData.arrayBuffer()),
        fileName: asset.file_name || 'document.pdf',
        storageBucket: bucket,
        storageKey: key,
    };
}
export async function downloadIncomeDocumentPdfBuffer(ctx, incomeDocumentId) {
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
    if (assetErr || !asset)
        throw notFound('PDF file asset not found');
    const bucket = asset.storage_bucket ?? BUCKET_INCOME_DOCUMENTS;
    const key = asset.storage_key;
    const { data: fileData, error: dlErr } = await supabaseAdmin.storage.from(bucket).download(key);
    if (dlErr || !fileData)
        throw notFound('PDF file not found in storage');
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
        fileName: asset.file_name || `${doc.document_number}.pdf`,
    };
}
