import { badRequest } from '../../shared/errors.js';
export function parseIncomeDocumentDocflowIdempotencyKey(body) {
    const raw = String(body.idempotency_key ?? '').trim();
    if (!raw)
        throw badRequest('idempotency_key is required');
    if (raw.length > 256)
        throw badRequest('idempotency_key too long');
    return raw;
}
export function buildIncomeDocumentDocflowDeliveryIdempotencyKey(incomeDocumentId, idempotencyKey) {
    return `income:docflow:${incomeDocumentId}:${idempotencyKey}`;
}
export function assertIncomeDocumentReadyForDocflowSend(doc) {
    if (doc.document_status !== 'issued') {
        throw badRequest('Document must be issued before DocFlow delivery');
    }
    if (doc.pdf_render_status !== 'rendered') {
        throw badRequest('Document PDF is not ready for DocFlow delivery');
    }
    if (!doc.pdf_asset_id) {
        throw badRequest('Document PDF attachment is not available');
    }
}
export function assertIncomeRepresentedClientScopeForDocflowSend(representedClientId) {
    if (!representedClientId) {
        throw badRequest('DocFlow delivery requires an active represented client scope');
    }
    return representedClientId;
}
export function resolveIncomeDocumentDocflowSendEligibility(input) {
    if (!input.permissions.issue) {
        return { enabled: false, disabled_reason: 'אין הרשאת הנפקה' };
    }
    if (!input.representedClientId) {
        return { enabled: false, disabled_reason: 'שליחה בדוקפלו זמינה במצב ניהול לקוח בלבד' };
    }
    if (!input.docflowEntitled) {
        return { enabled: false, disabled_reason: 'מודול דוקפלו אינו פעיל עבור הארגון' };
    }
    if (!input.portalActive) {
        return { enabled: false, disabled_reason: 'ללקוח אין גישה פעילה לפורטל דוקפלו' };
    }
    if (input.documentStatus !== 'issued') {
        return { enabled: false, disabled_reason: 'המסמך טרם הונפק' };
    }
    if (input.pdfRenderStatus !== 'rendered' || !input.pdfAssetId) {
        return { enabled: false, disabled_reason: 'קובץ PDF אינו זמין לשליחה' };
    }
    return { enabled: true, disabled_reason: null };
}
export function incomeDocflowDeliveryAttemptCountLabel(attemptCount) {
    if (attemptCount <= 0)
        return 'לא נשלח בדוקפלו';
    if (attemptCount === 1)
        return 'נשלח בדוקפלו פעם אחת';
    return `נשלח בדוקפלו ${attemptCount} פעמים`;
}
export function buildIncomeDocflowSenderSnapshot(client) {
    return {
        source: 'client_operations_core',
        client_id: client.id,
        display_name: client.display_name,
        channel: 'docflow',
    };
}
export function buildIncomeDocumentDocflowMessageSnapshot(params) {
    const body = `מצורף ${params.documentTypeLabel} מספר ${params.documentNumber} עבור ${params.clientDisplayName ?? 'הלקוח'}.`;
    return {
        channel: 'docflow',
        body,
        document_type_label: params.documentTypeLabel,
        document_number: params.documentNumber,
        business_name: params.businessName,
        client_display_name: params.clientDisplayName,
    };
}
export function bodyPreviewFromDocflowMessageSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object')
        return null;
    const body = snapshot.body;
    return body != null && String(body).trim() ? String(body).trim() : null;
}
export function incomeDocumentDocflowRuleContextKey(incomeDocumentId) {
    return `income_document:${incomeDocumentId}`;
}
