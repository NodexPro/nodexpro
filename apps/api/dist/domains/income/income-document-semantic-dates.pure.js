/**
 * Canonical income document dates for read models / issued HTML.
 *
 * DB columns on income_documents:
 *   issue_date → תאריך המסמך (document date)
 *   due_date   → תאריך לתשלום (payment due)
 *
 * Does not write or swap stored rows.
 */
export function calendarDateIso(raw) {
    if (raw == null)
        return null;
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(raw).trim());
    return match ? match[1] : null;
}
export function formatIncomeCalendarDateHe(raw) {
    const iso = calendarDateIso(raw);
    if (!iso)
        return '—';
    const [year, month, day] = iso.split('-');
    if (!year || !month || !day)
        return '—';
    return `${day}/${month}/${year}`;
}
/**
 * Map stored columns onto semantic display roles.
 * When both calendar dates exist and due_date is earlier than issue_date,
 * the stored pair is inverted relative to document-date ≤ payment-due;
 * the read model exposes the earlier date as document date and the later
 * as payment due without mutating income_documents.
 */
export function resolveIncomeDocumentSemanticDates(params) {
    const issue = calendarDateIso(params.issue_date);
    const due = calendarDateIso(params.due_date);
    if (issue && due && due < issue) {
        return { document_date: due, due_date: issue };
    }
    return { document_date: issue, due_date: due };
}
