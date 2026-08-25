/**
 * Pure helpers for Income client document management panel grouping.
 */
/**
 * Canonical visual action-slot order for Invoice CDM rows (both populations).
 * Retainer slot is present only when the panel includes retainer actions.
 */
export const INCOME_CDM_CANONICAL_ACTION_SLOT_KEYS_BASE = [
    'open_branding_studio',
    'open_end_customers',
    'open_reports',
    'open_income_ledger_card',
    'open_email_history',
];
export const INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_RETAINER = 'open_invoice_retainer_setup';
export const INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_MORE = 'more';
/** Work Engine invoices tab: replaces `more` with new-document action. */
export const INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_NEW_DOCUMENT = 'open_new_income_document';
export function incomeCdmCanonicalActionSlotKeys(includeRetainer, options) {
    const trailing = options?.newDocumentInsteadOfMore
        ? INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_NEW_DOCUMENT
        : INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_MORE;
    return [
        ...INCOME_CDM_CANONICAL_ACTION_SLOT_KEYS_BASE,
        ...(includeRetainer ? [INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_RETAINER] : []),
        trailing,
    ];
}
export function incomeCdmActionKeysMatchCanonical(actionKeys, includeRetainer, options) {
    const expected = incomeCdmCanonicalActionSlotKeys(includeRetainer, options);
    if (actionKeys.length !== expected.length)
        return false;
    return actionKeys.every((key, index) => key === expected[index]);
}
/** Stable dual-identity key: parent office client + end customer. */
export function endCustomerPopulationKey(params) {
    return `${params.representedClientId}::${params.incomeCustomerId}`;
}
/** Zero document-management counters for an office client with no stats row. */
export function zeroOfficeClientDocumentStat(representedClientId) {
    return {
        represented_client_id: representedClientId,
        total_documents_count: 0,
        draft_documents_count: 0,
        quote_count: 0,
        deal_count: 0,
        tax_invoice_count: 0,
        receipt_count: 0,
        credit_count: 0,
        quote_issued_count: 0,
        deal_issued_count: 0,
        tax_invoice_issued_count: 0,
        tax_invoice_receipt_issued_count: 0,
        receipt_issued_count: 0,
        credit_issued_count: 0,
        last_document_date: null,
        last_activity_at: null,
        unpaid_reference: null,
        currency: null,
    };
}
/**
 * Office section population: start from ALL eligible office clients, left-join stats.
 * Does not invent membership — `officeClients` must already be the canonical Core list.
 */
export function mergeOfficeClientsWithDocumentStats(officeClients, statsByClientId, zeroStat) {
    return officeClients.map((client) => {
        const clientId = String(client.id);
        return {
            clientId,
            stat: statsByClientId.get(clientId) ?? zeroStat(clientId),
        };
    });
}
/**
 * Group end-customer rows by explicit parent represented client.
 * Parent labels must already be backend-resolved on each row.
 */
export function groupEndCustomerRowsByParent(rows) {
    const order = [];
    const map = new Map();
    for (const row of rows) {
        const parentId = row.parent_represented_client_id;
        const existing = map.get(parentId);
        if (!existing) {
            order.push(parentId);
            map.set(parentId, {
                parent_client_display_name: row.parent_client_display_name,
                rows: [row],
            });
            continue;
        }
        existing.rows.push(row);
    }
    return order.map((parentId) => {
        const g = map.get(parentId);
        return {
            parent_represented_client_id: parentId,
            parent_client_display_name: g.parent_client_display_name,
            total_customers: g.rows.length,
            rows: g.rows,
        };
    });
}
function isExplicitSelfMode(row) {
    return row.acting_mode === 'self';
}
function isLegacyOfficeRepresentativeRow(row) {
    return (!row.acting_mode &&
        row.represented_client_id != null &&
        row.represented_client_id === row.issuer_business_id);
}
/**
 * Resolve the single office-client issuer-scope key for a document/draft.
 * Returns null for self mode, cross-client mismatches, or non-office rows.
 * Does not decide office-row vs end-customer counters — see
 * `classifyDocumentPopulationForCounters` / `resolveOfficeClientCounterGroupKey`.
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
function hasEndCustomerRecipient(row) {
    const id = row.income_customer_id;
    return id != null && String(id).trim() !== '';
}
/**
 * Office-client COUNTER / office-row document scope key.
 * Same issuer scope as resolveOfficeClientGroupKey, but excludes documents that
 * already have an end-customer recipient (Test3 → Chicago must not inflate Test3 office cubes).
 */
export function resolveOfficeClientCounterGroupKey(row) {
    if (hasEndCustomerRecipient(row))
        return null;
    return resolveOfficeClientGroupKey(row);
}
/**
 * Pure counter composition for office-client vs end-customer populations.
 * Mirrors SQL directional rules (panel_stats vs end_customer_stats).
 */
export function classifyDocumentPopulationForCounters(row) {
    const issuerScopeKey = resolveOfficeClientGroupKey({
        represented_client_id: row.represented_client_id,
        issuer_business_id: row.issuer_business_id,
        acting_mode: row.acting_mode,
    });
    if (!issuerScopeKey)
        return { population: 'excluded' };
    const customerId = row.income_customer_id != null && String(row.income_customer_id).trim() !== ''
        ? String(row.income_customer_id).trim()
        : null;
    if (customerId) {
        return {
            population: 'office_client_customer',
            represented_client_id: issuerScopeKey,
            income_customer_id: customerId,
        };
    }
    return { population: 'office_client', represented_client_id: issuerScopeKey };
}
function emptyCounterBucket() {
    return { quote: 0, deal_invoice: 0, tax_invoice: 0, receipt: 0, credit_tax_invoice: 0 };
}
function bumpCounter(bucket, documentType) {
    if (documentType === 'quote')
        bucket.quote += 1;
    else if (documentType === 'deal_invoice')
        bucket.deal_invoice += 1;
    else if (documentType === 'tax_invoice' || documentType === 'tax_invoice_receipt') {
        bucket.tax_invoice += 1;
    }
    else if (documentType === 'receipt')
        bucket.receipt += 1;
    else if (documentType === 'credit_tax_invoice')
        bucket.credit_tax_invoice += 1;
}
/**
 * Aggregate fixture documents into office-client and end-customer counter maps.
 * Used by focused directional-scope tests (no DB).
 */
export function aggregateDirectionalDocumentCounters(docs) {
    const office_clients = new Map();
    const office_client_customers = new Map();
    for (const doc of docs) {
        const classified = classifyDocumentPopulationForCounters(doc);
        if (classified.population === 'excluded')
            continue;
        if (classified.population === 'office_client') {
            const bucket = office_clients.get(classified.represented_client_id) ?? emptyCounterBucket();
            bumpCounter(bucket, doc.document_type);
            office_clients.set(classified.represented_client_id, bucket);
            continue;
        }
        const key = endCustomerPopulationKey({
            representedClientId: classified.represented_client_id,
            incomeCustomerId: classified.income_customer_id,
        });
        const bucket = office_client_customers.get(key) ?? emptyCounterBucket();
        bumpCounter(bucket, doc.document_type);
        office_client_customers.set(key, bucket);
    }
    return { office_clients, office_client_customers };
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
