/**
 * Canonical PDF readiness for Income send preparation (email + DocFlow).
 * Pure contract only — does not render PDFs or mutate documents.
 */

export type IncomeDocumentPdfSendStatusKey =
  | 'pdf_pending'
  | 'pdf_failed'
  | 'pdf_ready'
  | 'pdf_unavailable';

export type IncomeDocumentPdfSendDisabledReasonKey = Exclude<
  IncomeDocumentPdfSendStatusKey,
  'pdf_ready'
>;

export type IncomeDocumentPdfSendReadiness = {
  ready: boolean;
  status_key: IncomeDocumentPdfSendStatusKey;
  status_label: string;
  disabled_reason: string | null;
  disabled_reason_key: IncomeDocumentPdfSendDisabledReasonKey | null;
  /** True only for failed render — caller still gates on issue permission. */
  retry_eligible: boolean;
};

const PDF_PENDING_REASON = 'ה-PDF בהכנה. ניתן לשלוח לאחר סיום ההפקה.';
const PDF_FAILED_REASON = 'הפקת קובץ ה-PDF נכשלה. ניתן לנסות שוב.';
const PDF_UNAVAILABLE_REASON = 'קובץ PDF אינו זמין לשליחה';

/** Canonical usable PDF artifact — same truth Download uses (`pdf_asset_id` present). */
export function hasCanonicalIncomeDocumentPdfAsset(
  pdfAssetId: string | null | undefined,
): boolean {
  return pdfAssetId != null && String(pdfAssetId).trim() !== '';
}

export function resolveIncomeDocumentPdfSendReadiness(params: {
  pdfRenderStatus: string;
  pdfAssetId: string | null | undefined;
}): IncomeDocumentPdfSendReadiness {
  const status = String(params.pdfRenderStatus ?? '').trim();
  const assetId =
    params.pdfAssetId != null && String(params.pdfAssetId).trim()
      ? String(params.pdfAssetId).trim()
      : null;

  if (status === 'pending') {
    return {
      ready: false,
      status_key: 'pdf_pending',
      status_label: 'PDF בהכנה',
      disabled_reason: PDF_PENDING_REASON,
      disabled_reason_key: 'pdf_pending',
      retry_eligible: false,
    };
  }

  if (status === 'failed') {
    return {
      ready: false,
      status_key: 'pdf_failed',
      status_label: 'הפקת PDF נכשלה',
      disabled_reason: PDF_FAILED_REASON,
      disabled_reason_key: 'pdf_failed',
      retry_eligible: true,
    };
  }

  if (status === 'rendered' && assetId) {
    return {
      ready: true,
      status_key: 'pdf_ready',
      status_label: 'PDF מוכן',
      disabled_reason: null,
      disabled_reason_key: null,
      retry_eligible: false,
    };
  }

  return {
    ready: false,
    status_key: 'pdf_unavailable',
    status_label: 'PDF אינו זמין',
    disabled_reason: PDF_UNAVAILABLE_REASON,
    disabled_reason_key: 'pdf_unavailable',
    // Missing/invalid asset on an issued doc — allow regenerate via retry command.
    retry_eligible: true,
  };
}
