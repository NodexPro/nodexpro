import { INCOME_COMMAND_SEND_DOCUMENT_BY_EMAIL, INCOME_DOCUMENT_EMAIL_HISTORY_AGGREGATE_KEY, INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY, } from './income.types.js';
import { resolveIncomeDocumentPdfSendReadiness, } from './income-document-pdf-send-readiness.pure.js';
import { normalizeIncomeDocumentRecipientEmailPrefill, normalizeRepresentedClientRecipientEmailPrefill, } from './income-document-email-recipient-prefill.pure.js';
export { INCOME_DOCUMENT_EMAIL_HISTORY_AGGREGATE_KEY, INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY };
export { normalizeIncomeDocumentRecipientEmailPrefill, normalizeRepresentedClientRecipientEmailPrefill, };
export function toIncomeDocumentPdfSendReadinessView(readiness) {
    return {
        status_key: readiness.status_key,
        status_label: readiness.status_label,
        message: readiness.disabled_reason,
    };
}
export function resolveIncomeDocumentEmailSendEligibility(input) {
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
            disabled_reason: 'שליחה במייל זמינה במצב ניהול לקוח בלבד',
            disabled_reason_key: 'self_mode_not_allowed',
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
export function incomeEmailDeliveryAttemptCountLabel(attemptCount) {
    if (attemptCount <= 0)
        return 'לא נשלח במייל';
    if (attemptCount === 1)
        return 'נשלח במייל פעם אחת';
    return `נשלח במייל ${attemptCount} פעמים`;
}
export function formatEmailDeliverySentAtDisplay(sentAt) {
    if (!sentAt)
        return '—';
    const d = sentAt.length >= 10 ? sentAt.slice(0, 10) : sentAt;
    return new Date(d).toLocaleString('he-IL', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}
export function deliveryAttemptResultLabel(result) {
    if (result === 'sent')
        return 'נשלח';
    if (result === 'failed')
        return 'נכשל';
    if (result === 'pending')
        return 'בתהליך';
    return result;
}
export function subjectPreviewFromMessageSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object')
        return null;
    const subject = snapshot.subject;
    return subject != null && String(subject).trim() ? String(subject).trim() : null;
}
export function buildIncomeDocumentEmailDeliveryAction(params) {
    return {
        key: 'open_email_history',
        icon_key: 'at',
        label: '@',
        enabled: params.canOpenHistory,
        disabled_reason: params.historyDisabledReason,
        history_aggregate_key: INCOME_DOCUMENT_EMAIL_HISTORY_AGGREGATE_KEY,
        history_aggregate_params: { income_document_id: params.incomeDocumentId },
    };
}
export function buildIncomeDocumentEmailDeliveryBlock(params) {
    const sendEligibility = resolveIncomeDocumentEmailSendEligibility({
        permissions: params.permissions,
        representedClientId: params.representedClientId,
        documentStatus: params.documentStatus,
        pdfRenderStatus: params.pdfRenderStatus,
        pdfAssetId: params.pdfAssetId,
    });
    const canOpenHistory = params.permissions.view;
    return {
        attempt_count: params.attemptCount,
        status_label: incomeEmailDeliveryAttemptCountLabel(params.attemptCount),
        send_enabled: sendEligibility.enabled,
        send_disabled_reason: sendEligibility.disabled_reason,
        action: buildIncomeDocumentEmailDeliveryAction({
            incomeDocumentId: params.incomeDocumentId,
            canOpenHistory,
            historyDisabledReason: canOpenHistory ? null : 'אין הרשאת צפייה',
        }),
    };
}
export function buildIncomeDocumentEmailSendForm(params) {
    return {
        visible: true,
        command: INCOME_COMMAND_SEND_DOCUMENT_BY_EMAIL,
        income_document_id: params.incomeDocumentId,
        fields: [
            {
                key: 'recipient_email',
                label: 'אימייל נמען',
                required: true,
                type: 'email',
                default_value: normalizeIncomeDocumentRecipientEmailPrefill(params.recipientEmailDefault),
            },
        ],
        enabled: params.sendEligibility.enabled,
        disabled_reason: params.sendEligibility.disabled_reason,
        disabled_reason_key: params.sendEligibility.disabled_reason_key,
    };
}
export function mapDeliveryAttemptToDocumentHistoryRow(attempt) {
    return {
        attempt_id: attempt.id,
        sent_at_display: formatEmailDeliverySentAtDisplay(attempt.sentAt),
        recipient_email: attempt.recipientEmail,
        result: attempt.result,
        result_label: deliveryAttemptResultLabel(attempt.result),
        failure_reason: attempt.failureReason,
        provider_message_id: attempt.providerMessageId,
        subject_preview: subjectPreviewFromMessageSnapshot(attempt.messageSnapshotJson),
    };
}
