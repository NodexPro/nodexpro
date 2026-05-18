import { badRequest } from '../../shared/errors.js';
import { optionalJsonObject, optionalString } from './income.guards.js';
function parseOptionalDate(value, field) {
    if (value === null || value === undefined || value === '')
        return null;
    const s = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        throw badRequest(`${field} must be YYYY-MM-DD`);
    }
    return s;
}
function parseLanguage(value) {
    const lang = optionalString(value) ?? 'he';
    if (lang !== 'he' && lang !== 'en')
        throw badRequest('language must be he or en');
    return lang;
}
export function parseDraftPayloadBody(body, parseDocumentType, optionalUuid, reqJsonArray) {
    const income_customer_id = optionalUuid(body.income_customer_id, 'income_customer_id');
    const one_time_customer_snapshot_json = optionalJsonObject(body.one_time_customer_snapshot_json, 'one_time_customer_snapshot_json');
    if (income_customer_id && one_time_customer_snapshot_json) {
        throw badRequest('one_time_customer_snapshot_json is only allowed when income_customer_id is null');
    }
    return {
        document_type: parseDocumentType(body.document_type),
        income_customer_id,
        one_time_customer_snapshot_json,
        draft_lines_json: reqJsonArray(body.draft_lines_json, 'draft_lines_json'),
        payment_terms_json: optionalJsonObject(body.payment_terms_json, 'payment_terms_json'),
        due_date: parseOptionalDate(body.due_date, 'due_date'),
        payment_received_json: optionalJsonObject(body.payment_received_json, 'payment_received_json'),
        notes: optionalString(body.notes),
        currency: optionalString(body.currency) ?? 'ILS',
        language: parseLanguage(body.language),
    };
}
export function validateDraftAgainstDocumentTypeRules(payload, docType) {
    const warnings = [];
    if (docType.requires_payment_received && !payload.payment_received_json) {
        warnings.push({
            code: 'payment_received_recommended',
            message: 'Payment received details are expected for this document type.',
        });
    }
    if (docType.requires_due_date && !payload.due_date) {
        warnings.push({
            code: 'due_date_recommended',
            message: 'Due date is expected for this document type.',
        });
    }
    if (!payload.income_customer_id && !payload.one_time_customer_snapshot_json) {
        warnings.push({
            code: 'customer_required',
            message: 'Select an income customer or provide a one-time customer snapshot.',
        });
    }
    let subtotalReference = 0;
    for (const line of payload.draft_lines_json) {
        if (line && typeof line === 'object' && !Array.isArray(line)) {
            const amount = Number(line.amount_reference);
            if (Number.isFinite(amount))
                subtotalReference += amount;
        }
    }
    return {
        validation_warnings_json: warnings,
        draft_totals_preview_json: {
            preview: true,
            not_financial_truth: true,
            currency: payload.currency,
            line_count: payload.draft_lines_json.length,
            subtotal_reference: subtotalReference > 0 ? subtotalReference : null,
        },
    };
}
