/**
 * Pure helpers for recurring document scheduler retry / cycle-key semantics.
 *
 * last_scheduler_cycle_key means: this period was successfully generated.
 * It must never be stamped on a failed attempt.
 */
export function isRecurringSchedulerPeriodProcessed(lastSchedulerCycleKey, cycleKey) {
    return Boolean(cycleKey) && lastSchedulerCycleKey === cycleKey;
}
/** Failure metadata only — never includes last_scheduler_cycle_key. */
export function buildRecurringGenerationFailedProfileUpdate(params) {
    return {
        last_generation_failed_at: params.failedAtIso,
        last_generation_error_code: params.errorCode,
        last_generation_error_message: params.errorMessage.slice(0, 2000),
    };
}
/** Success path stamps cycle key and may advance next_document_date. */
export function buildRecurringGenerationSuccessProfileUpdate(params) {
    return {
        last_generated_draft_id: params.draftId,
        last_generated_at: params.generatedAtIso,
        last_scheduler_cycle_key: params.cycleKey,
        last_generation_failed_at: null,
        last_generation_error_code: null,
        last_generation_error_message: null,
        next_document_date: params.nextDocumentDate,
        service_period_start: params.servicePeriodStart,
        service_period_end: params.servicePeriodEnd,
        unit_price_before_vat_reference: params.unitPriceBeforeVatReference,
    };
}
/** Safe reuse: failed/pending cycle already points at an active draft. */
export function shouldReuseExistingCycleDraft(params) {
    const draftId = String(params.cycleGeneratedDraftId ?? '').trim();
    return Boolean(draftId) && params.draftStatus === 'draft';
}
