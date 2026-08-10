import { badRequest } from '../../shared/errors.js';
import { resolveIncomeDocumentPdfSendReadiness, } from './income-document-pdf-send-readiness.pure.js';
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
    const pdf_readiness = resolveIncomeDocumentPdfSendReadiness({
        pdfRenderStatus: input.pdfRenderStatus,
        pdfAssetId: input.pdfAssetId,
    });
    const retry_pdf_render_allowed = Boolean(input.permissions.issue) && pdf_readiness.retry_eligible;
    if (!input.permissions.issue) {
        return {
            enabled: false,
            disabled_reason: 'אין הרשאת הנפקה',
            disabled_reason_key: 'no_issue_permission',
            pdf_readiness,
            retry_pdf_render_allowed: false,
        };
    }
    if (!input.representedClientId) {
        return {
            enabled: false,
            disabled_reason: 'שליחה בדוקפלו זמינה במצב ניהול לקוח בלבד',
            disabled_reason_key: 'self_mode_not_allowed',
            pdf_readiness,
            retry_pdf_render_allowed,
        };
    }
    if (!input.docflowEntitled) {
        return {
            enabled: false,
            disabled_reason: 'מודול דוקפלו אינו פעיל עבור הארגון',
            disabled_reason_key: 'docflow_not_entitled',
            pdf_readiness,
            retry_pdf_render_allowed,
        };
    }
    if (!input.portalActive) {
        return {
            enabled: false,
            disabled_reason: 'ללקוח אין גישה פעילה לפורטל דוקפלו',
            disabled_reason_key: 'docflow_portal_inactive',
            pdf_readiness,
            retry_pdf_render_allowed,
        };
    }
    if (input.documentStatus !== 'issued') {
        return {
            enabled: false,
            disabled_reason: 'המסמך טרם הונפק',
            disabled_reason_key: 'document_not_issued',
            pdf_readiness,
            retry_pdf_render_allowed,
        };
    }
    if (!pdf_readiness.ready) {
        return {
            enabled: false,
            disabled_reason: pdf_readiness.disabled_reason,
            disabled_reason_key: pdf_readiness.disabled_reason_key,
            pdf_readiness,
            retry_pdf_render_allowed,
        };
    }
    return {
        enabled: true,
        disabled_reason: null,
        disabled_reason_key: null,
        pdf_readiness,
        retry_pdf_render_allowed: false,
    };
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
