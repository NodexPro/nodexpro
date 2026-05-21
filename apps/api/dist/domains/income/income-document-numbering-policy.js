/**
 * Israel fallback income document numbering policy (INC-8.5).
 * TEMPORARY_COUNTRY_PACK_PENDING — series ranges are IL fallback until Country Pack owns numbering.
 */
export const IL_NUMBERING_POLICY_KEY = 'il_series_v1';
/** Sentinel year bucket — IL series is not calendar-year based. */
export const IL_NUMBERING_SERIES_YEAR = 0;
const IL_SERIES_POLICIES = {
    quote: {
        policy_key: IL_NUMBERING_POLICY_KEY,
        document_type: 'quote',
        first_number: 1000,
        range_start: 1000,
        range_end: 1999,
        overflow_next: null,
        overflow_strategy: 'continue_after_range',
    },
    deal_invoice: {
        policy_key: IL_NUMBERING_POLICY_KEY,
        document_type: 'deal_invoice',
        first_number: 2000,
        range_start: 2000,
        range_end: 2999,
        overflow_next: null,
        overflow_strategy: 'continue_after_range',
    },
    receipt: {
        policy_key: IL_NUMBERING_POLICY_KEY,
        document_type: 'receipt',
        first_number: 3000,
        range_start: 3000,
        range_end: 3999,
        overflow_next: null,
        overflow_strategy: 'continue_after_range',
    },
    tax_invoice: {
        policy_key: IL_NUMBERING_POLICY_KEY,
        document_type: 'tax_invoice',
        first_number: 4000,
        range_start: 4000,
        range_end: 4999,
        overflow_next: null,
        overflow_strategy: 'continue_after_range',
    },
    tax_invoice_receipt: {
        policy_key: IL_NUMBERING_POLICY_KEY,
        document_type: 'tax_invoice_receipt',
        first_number: 5000,
        range_start: 5000,
        range_end: 5999,
        overflow_next: null,
        overflow_strategy: 'continue_after_range',
    },
    credit_tax_invoice: {
        policy_key: IL_NUMBERING_POLICY_KEY,
        document_type: 'credit_tax_invoice',
        first_number: 6000,
        range_start: 6000,
        range_end: 6999,
        overflow_next: 61111,
        overflow_strategy: 'overflow_jump',
    },
};
export function resolveIlSeriesPolicy(documentType) {
    const policy = IL_SERIES_POLICIES[documentType];
    if (!policy) {
        return {
            policy_key: IL_NUMBERING_POLICY_KEY,
            document_type: documentType,
            first_number: 1,
            range_start: 1,
            range_end: null,
            overflow_next: null,
            overflow_strategy: 'todo_policy',
        };
    }
    return policy;
}
/**
 * Compute next sequence number from current (0 = never allocated in IL bucket).
 */
export function computeNextIlSeriesNumber(currentNumber, policy) {
    if (currentNumber <= 0) {
        return { next_number: policy.first_number, overflow_applied: false };
    }
    if (policy.overflow_strategy === 'overflow_jump' &&
        policy.range_end != null &&
        policy.overflow_next != null &&
        currentNumber === policy.range_end) {
        return { next_number: policy.overflow_next, overflow_applied: true };
    }
    const candidate = currentNumber + 1;
    if (policy.range_end != null && candidate > policy.range_end) {
        if (policy.overflow_next != null && currentNumber < policy.overflow_next) {
            return { next_number: policy.overflow_next, overflow_applied: true };
        }
        return { next_number: candidate, overflow_applied: false };
    }
    return { next_number: candidate, overflow_applied: false };
}
export function formatIlSeriesDocumentNumber(sequenceNumber) {
    return String(sequenceNumber);
}
