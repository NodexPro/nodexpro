/**
 * Work Engine recurring document scheduler — NOT IMPLEMENTED.
 *
 * Planned behavior when enabled:
 * 1. When today >= next_document_date - advance_days, create income document draft
 * 2. Link draft to recurring profile
 * 3. Emit recurring_document_draft_created work event
 * 4. Create work_item work_type=recurring_invoice_review, state=waiting_human
 * 5. No automatic issue/send — accountant approval required
 */
export const WORK_ENGINE_RECURRING_DOCUMENT_SCHEDULER_STATUS = 'scheduler_pending';
export async function runWorkEngineRecurringDocumentScheduler() {
    return { status: WORK_ENGINE_RECURRING_DOCUMENT_SCHEDULER_STATUS };
}
