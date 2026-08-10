/**
 * Issued-document VIEW vs PDF action contracts (separate capabilities).
 * VIEW = immutable issued HTML via unified render.
 * PDF  = binary asset for download / email attachment.
 */
import { resolveIncomeDocumentPdfSendReadiness } from './income-document-pdf-send-readiness.pure.js';
import { INCOME_COMMAND_RETRY_PDF_RENDER, INCOME_ISSUED_DOCUMENT_VIEW_AGGREGATE_KEY, } from './income.types.js';
export function buildIncomeIssuedDocumentViewAction(params) {
    const enabled = params.canView;
    return {
        action_key: 'open_document',
        label: 'צפייה במסמך',
        enabled,
        view_mode: 'issued_html',
        income_document_id: params.incomeDocumentId,
        view_aggregate_key: INCOME_ISSUED_DOCUMENT_VIEW_AGGREGATE_KEY,
        view_aggregate_params: { income_document_id: params.incomeDocumentId },
        disabled_reason: enabled ? null : 'אין הרשאת צפייה',
    };
}
export function buildIncomeIssuedDocumentPdfAction(params) {
    const readiness = resolveIncomeDocumentPdfSendReadiness({
        pdfRenderStatus: params.pdfRenderStatus,
        pdfAssetId: params.pdfAssetId,
    });
    const enabled = readiness.ready && Boolean(params.pdfDownloadPath);
    const retryAllowed = params.canRetryPdf && readiness.retry_eligible;
    const baseReason = readiness.disabled_reason ?? 'קובץ PDF אינו זמין';
    const renderError = params.pdfRenderError != null ? String(params.pdfRenderError).trim() : '';
    const disabledReason = !enabled && readiness.status_key === 'pdf_failed' && renderError
        ? `${baseReason} ${renderError}`.trim()
        : enabled
            ? null
            : baseReason;
    return {
        action_key: 'download_pdf',
        label: 'הורדת PDF',
        enabled,
        income_document_id: params.incomeDocumentId,
        pdf_download_path: enabled ? params.pdfDownloadPath : null,
        pdf_status_key: readiness.status_key,
        pdf_status_label: readiness.status_label,
        disabled_reason: disabledReason,
        retry_command: retryAllowed ? INCOME_COMMAND_RETRY_PDF_RENDER : null,
    };
}
