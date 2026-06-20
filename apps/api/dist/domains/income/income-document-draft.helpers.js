import { badRequest } from '../../shared/errors.js';
import { optionalJsonObject, optionalString } from './income.guards.js';
import { normalizeDraftLines } from './income-document-draft-lines.pure.js';
import { computeDraftTotalsPreview, parseDocumentSettingsJson, } from './income-document-draft-totals.pure.js';
import { incomeDraftVatFallbackResolution } from './income-draft-vat-fallback.pure.js';
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
        document_date: parseOptionalDate(body.document_date ?? body.issue_date, 'document_date'),
        payment_received_json: optionalJsonObject(body.payment_received_json, 'payment_received_json'),
        notes: optionalString(body.notes),
        currency: optionalString(body.currency) ?? 'ILS',
        language: parseLanguage(body.language),
    };
}
export async function validateDraftAgainstDocumentTypeRules(payload, docType) {
    const warnings = [];
    if (docType.requires_payment_received && !payload.payment_received_json) {
        warnings.push({
            code: 'payment_received_recommended',
            message: 'נדרשים פרטי תשלום שהתקבל עבור סוג מסמך זה',
        });
    }
    if (docType.requires_due_date && !payload.due_date) {
        warnings.push({
            code: 'due_date_recommended',
            message: 'יש להזין תאריך לתשלום עבור סוג מסמך זה',
        });
    }
    if (!payload.income_customer_id && !payload.one_time_customer_snapshot_json) {
        warnings.push({
            code: 'customer_required',
            message: 'יש לבחור לקוח הכנסה או להזין פרטי לקוח חד-פעמי',
        });
    }
    const lines = normalizeDraftLines(payload.draft_lines_json);
    const settings = parseDocumentSettingsJson(payload.document_settings_json ?? null);
    const documentDate = payload.document_date ?? new Date().toISOString().slice(0, 10);
    const totals = await computeDraftTotalsPreview(lines, payload.currency, settings, incomeDraftVatFallbackResolution(), documentDate);
    return {
        validation_warnings_json: warnings,
        draft_totals_preview_json: totals,
    };
}
