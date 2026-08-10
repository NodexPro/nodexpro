/**
 * Backend-prepared issue command result truth for Income / retainer issue.
 * UI renders only — no frontend duplicate-detection.
 */
function normalizePdfRenderStatus(status) {
    if (status === 'rendered' || status === 'failed' || status === 'pending')
        return status;
    return 'pending';
}
function buildViewAction(params) {
    return {
        action_key: 'view_document',
        label: 'צפייה בחשבונית',
        enabled: params.pdf_render_status === 'rendered',
        document_id: params.document_id,
    };
}
const DOCUMENT_TYPE_LABELS = {
    tax_invoice: 'חשבונית מס',
    deal_invoice: 'חשבון עסקה',
    quote: 'הצעת מחיר',
    receipt: 'קבלה',
    tax_invoice_receipt: 'חשבונית מס/קבלה',
    credit_note: 'חשבונית זיכוי',
};
export function incomeDocumentTypeLabelHe(documentTypeKey) {
    return DOCUMENT_TYPE_LABELS[documentTypeKey] ?? 'מסמך';
}
export function formatIssuedDateDisplayHe(issuedDateIso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedDateIso))
        return issuedDateIso;
    const [y, m, d] = issuedDateIso.split('-');
    return `${d}/${m}/${y}`;
}
export function buildAlreadyIssuedIssueResult(params) {
    const typeLabel = incomeDocumentTypeLabelHe(params.document_type_key);
    const issuedDisplay = formatIssuedDateDisplayHe(params.issued_date);
    const pdf_render_status = normalizePdfRenderStatus(params.pdf_render_status);
    const message = [
        `החשבונית כבר הופקה בתאריך ${issuedDisplay}.`,
        `מספר החשבונית: ${params.document_number}.`,
        'ניתן לצפות בה ברשימת החשבוניות.',
    ].join('\n');
    return {
        result_key: 'already_issued',
        message,
        document_id: params.document_id,
        document_number: params.document_number,
        document_type_key: params.document_type_key,
        document_type_label: typeLabel,
        issued_date: params.issued_date,
        pdf_render_status,
        view_action: buildViewAction({
            document_id: params.document_id,
            pdf_render_status,
        }),
    };
}
export function buildFreshIssuedIssueResult(params) {
    const typeLabel = incomeDocumentTypeLabelHe(params.document_type_key);
    const issuedDisplay = formatIssuedDateDisplayHe(params.issued_date);
    const pdf_render_status = normalizePdfRenderStatus(params.pdf_render_status);
    return {
        result_key: 'issued',
        message: `${typeLabel} מספר ${params.document_number} הופקה בתאריך ${issuedDisplay}.`,
        document_id: params.document_id,
        document_number: params.document_number,
        document_type_key: params.document_type_key,
        document_type_label: typeLabel,
        issued_date: params.issued_date,
        pdf_render_status,
        view_action: buildViewAction({
            document_id: params.document_id,
            pdf_render_status,
        }),
    };
}
