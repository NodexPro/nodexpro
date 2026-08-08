/**
 * Issued-document view action for dumb UI (click document number → final PDF).
 */

import { resolveIncomeDocumentPdfSendReadiness } from './income-document-pdf-send-readiness.pure.js';
import { INCOME_COMMAND_RETRY_PDF_RENDER, type IncomeIssuedDocumentViewAction } from './income.types.js';

export function buildIncomeIssuedDocumentViewAction(params: {
  incomeDocumentId: string;
  canView: boolean;
  canRetryPdf: boolean;
  pdfRenderStatus: string;
  pdfAssetId: string | null;
  pdfDownloadPath: string | null;
  pdfRenderError?: string | null;
}): IncomeIssuedDocumentViewAction {
  const readiness = resolveIncomeDocumentPdfSendReadiness({
    pdfRenderStatus: params.pdfRenderStatus,
    pdfAssetId: params.pdfAssetId,
  });
  const enabled =
    params.canView && readiness.ready && Boolean(params.pdfDownloadPath);
  const retryAllowed = params.canRetryPdf && readiness.retry_eligible;
  const baseReason = readiness.disabled_reason ?? 'המסמך אינו זמין לצפייה';
  const renderError =
    params.pdfRenderError != null ? String(params.pdfRenderError).trim() : '';
  const disabledReason =
    !enabled && readiness.status_key === 'pdf_failed' && renderError
      ? `${baseReason} ${renderError}`.trim()
      : enabled
        ? null
        : baseReason;
  return {
    action_key: 'open_document',
    label: 'צפייה במסמך',
    enabled,
    income_document_id: params.incomeDocumentId,
    pdf_download_path: enabled ? params.pdfDownloadPath : null,
    disabled_reason: disabledReason,
    retry_command: retryAllowed ? INCOME_COMMAND_RETRY_PDF_RENDER : null,
  };
}
