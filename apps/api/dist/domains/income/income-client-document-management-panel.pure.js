/**
 * Pure helpers for Income client document management panel grouping.
 */
function isExplicitSelfMode(row) {
    return row.acting_mode === 'self';
}
function isLegacyOfficeRepresentativeRow(row) {
    return (!row.acting_mode &&
        row.represented_client_id != null &&
        row.represented_client_id === row.issuer_business_id);
}
/**
 * Resolve the single office-client row key for a document/draft.
 * Returns null for self mode, cross-client mismatches, or non-office rows.
 */
export function resolveOfficeClientGroupKey(row) {
    if (isExplicitSelfMode(row))
        return null;
    if (row.represented_client_id) {
        if (row.issuer_business_id !== row.represented_client_id)
            return null;
        if (row.acting_mode === 'office_representative' || isLegacyOfficeRepresentativeRow(row)) {
            return row.represented_client_id;
        }
        return null;
    }
    if (row.acting_mode === 'office_representative') {
        return row.issuer_business_id;
    }
    return null;
}
/** True when the row belongs exclusively to the given office client row. */
export function belongsToOfficeClientRow(row, officeClientId) {
    const key = resolveOfficeClientGroupKey(row);
    return key != null && key === officeClientId;
}
/** Supabase OR filter for one office client row (includes legacy null acting_mode rows). */
export function officeClientDocumentsOrFilter(officeClientId) {
    return [
        `and(represented_client_id.eq.${officeClientId},issuer_business_id.eq.${officeClientId})`,
        `and(represented_client_id.is.null,issuer_business_id.eq.${officeClientId})`,
    ].join(',');
}
/** Exclude organization self-mode rows while keeping office + legacy office rows. */
export function excludeSelfModeActingFilter() {
    return 'acting_mode.eq.office_representative,acting_mode.is.null';
}
