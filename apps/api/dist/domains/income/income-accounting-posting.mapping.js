/**
 * INC-5 — Income document type → Accounting Base posting plan (pure mapping).
 */
export function resolveIncomeAccountingPostingPlan(documentType) {
    switch (documentType) {
        case 'receipt':
            return {
                requires_posting: true,
                posting_status_when_skipped: 'not_required',
                display_status_when_skipped: 'not_required',
                entries: [
                    {
                        entry_type: 'income',
                        direction: 'credit',
                        role: 'payment_received',
                        description_suffix: 'Payment received',
                        source_type: 'income_document:receipt',
                    },
                ],
            };
        case 'tax_invoice':
            return {
                requires_posting: true,
                posting_status_when_skipped: 'not_required',
                display_status_when_skipped: 'not_required',
                entries: [
                    {
                        entry_type: 'income',
                        direction: 'credit',
                        role: 'receivable',
                        description_suffix: 'Revenue / receivable',
                        source_type: 'income_document:tax_invoice',
                    },
                ],
            };
        case 'tax_invoice_receipt':
            return {
                requires_posting: true,
                posting_status_when_skipped: 'not_required',
                display_status_when_skipped: 'not_required',
                entries: [
                    {
                        entry_type: 'income',
                        direction: 'credit',
                        role: 'combined_invoice_receipt',
                        description_suffix: 'Tax invoice with payment received',
                        source_type: 'income_document:tax_invoice_receipt',
                    },
                ],
            };
        case 'credit_tax_invoice':
            return {
                requires_posting: true,
                posting_status_when_skipped: 'not_required',
                display_status_when_skipped: 'not_required',
                entries: [
                    {
                        entry_type: 'refund',
                        direction: 'debit',
                        role: 'refund',
                        description_suffix: 'Credit tax invoice (refund)',
                        source_type: 'income_document:credit_tax_invoice',
                    },
                ],
            };
        case 'deal_invoice':
            return {
                requires_posting: false,
                posting_status_when_skipped: 'not_required',
                display_status_when_skipped: 'not_posted_non_final_document',
                entries: [],
            };
        case 'quote':
            return {
                requires_posting: false,
                posting_status_when_skipped: 'not_required',
                display_status_when_skipped: 'not_posted_quote',
                entries: [],
            };
        default:
            return {
                requires_posting: false,
                posting_status_when_skipped: 'not_required',
                display_status_when_skipped: 'not_required',
                entries: [],
            };
    }
}
export function buildAccountingPostingSignature(incomeDocumentId) {
    return `income_document:${incomeDocumentId}`;
}
export function accountingDisplayStatusLabel(status) {
    const labels = {
        posted: 'Posted to Accounting Base',
        pending: 'Accounting posting pending',
        failed: 'Accounting posting failed',
        not_required: 'Accounting not required',
        not_posted_quote: 'Quote — not posted',
        not_posted_non_final_document: 'Deal invoice — not finalized in Accounting Base',
    };
    return labels[status];
}
export function accountingPostingStatusLabel(status) {
    const labels = {
        posted: 'Posted',
        pending: 'Pending',
        failed: 'Failed',
        not_required: 'Not required',
    };
    return labels[status];
}
export function resolveAccountingDisplayStatus(documentType, postingStatus) {
    if (postingStatus === 'posted')
        return 'posted';
    if (postingStatus === 'failed')
        return 'failed';
    if (postingStatus === 'pending')
        return 'pending';
    const plan = resolveIncomeAccountingPostingPlan(documentType);
    if (!plan.requires_posting)
        return plan.display_status_when_skipped;
    return 'not_required';
}
export function extractPostingAmountFromTotals(totalsSnapshot, linesSnapshot) {
    const preview = totalsSnapshot?.subtotal_reference;
    if (typeof preview === 'number' && Number.isFinite(preview) && preview > 0) {
        return preview;
    }
    let sum = 0;
    for (const line of linesSnapshot) {
        if (line && typeof line === 'object' && !Array.isArray(line)) {
            const amount = Number(line.amount_reference);
            if (Number.isFinite(amount) && amount > 0)
                sum += amount;
        }
    }
    return sum;
}
