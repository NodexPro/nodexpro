import { badRequest } from '../../shared/errors.js';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value) {
    return UUID_RE.test(value);
}
export function reqUuid(value, field) {
    const s = String(value ?? '').trim();
    if (!isUuid(s))
        throw badRequest(`${field} must be a valid UUID`);
    return s;
}
export function optionalUuid(value, field) {
    if (value === null || value === undefined || value === '')
        return null;
    return reqUuid(value, field);
}
export function reqNonEmptyString(value, field) {
    const s = String(value ?? '').trim();
    if (!s)
        throw badRequest(`${field} is required`);
    return s;
}
export function optionalString(value) {
    if (value === null || value === undefined)
        return null;
    const s = String(value).trim();
    return s || null;
}
export function optionalJsonObject(value, field) {
    if (value === null || value === undefined)
        return null;
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw badRequest(`${field} must be a JSON object`);
    }
    return value;
}
export function reqJsonArray(value, field) {
    if (!Array.isArray(value))
        throw badRequest(`${field} must be a JSON array`);
    return value;
}
const DOCUMENT_TYPES = new Set([
    'receipt',
    'tax_invoice',
    'tax_invoice_receipt',
    'credit_tax_invoice',
    'deal_invoice',
    'quote',
]);
export function parseIncomeDocumentType(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const s = String(value).trim();
    if (!DOCUMENT_TYPES.has(s)) {
        throw badRequest('document_type is invalid');
    }
    return s;
}
export function parseIncomeItemType(value) {
    const s = String(value ?? '').trim();
    if (s !== 'service' && s !== 'product')
        throw badRequest('item_type must be service or product');
    return s;
}
export function optionalPriceReference(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0)
        throw badRequest('default_unit_price_reference must be a non-negative number');
    return n;
}
/** Backend issuer scope match — UI must not re-filter. */
export function assertRowMatchesIssuerScope(scope, row) {
    if (row.organization_id !== scope.org_id) {
        throw badRequest('Resource is outside organization scope');
    }
    if (row.issuer_business_id !== scope.issuer_business_id) {
        throw badRequest('Resource is outside active issuer scope');
    }
    const rowRep = row.represented_client_id ?? null;
    const scopeRep = scope.represented_client_id ?? null;
    if (rowRep !== scopeRep) {
        throw badRequest('Resource is outside active represented client scope');
    }
}
