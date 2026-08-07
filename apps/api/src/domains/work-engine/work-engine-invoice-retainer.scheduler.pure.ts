/**
 * Pure helpers for recurring document scheduler retry / cycle-key semantics.
 *
 * last_scheduler_cycle_key means: this period was successfully generated.
 * It must never be stamped on a failed attempt.
 */

export function isRecurringSchedulerPeriodProcessed(
  lastSchedulerCycleKey: string | null | undefined,
  cycleKey: string,
): boolean {
  return Boolean(cycleKey) && lastSchedulerCycleKey === cycleKey;
}

export type RecurringGenerationFailedProfileUpdate = {
  last_generation_failed_at: string;
  last_generation_error_code: string;
  last_generation_error_message: string;
};

/** Failure metadata only — never includes last_scheduler_cycle_key. */
export function buildRecurringGenerationFailedProfileUpdate(params: {
  failedAtIso: string;
  errorCode: string;
  errorMessage: string;
}): RecurringGenerationFailedProfileUpdate {
  return {
    last_generation_failed_at: params.failedAtIso,
    last_generation_error_code: params.errorCode,
    last_generation_error_message: params.errorMessage.slice(0, 2000),
  };
}

export type RecurringGenerationSuccessProfileUpdate = {
  last_generated_draft_id: string;
  last_generated_at: string;
  last_scheduler_cycle_key: string;
  last_generation_failed_at: null;
  last_generation_error_code: null;
  last_generation_error_message: null;
  next_document_date: string;
  service_period_start: string;
  service_period_end: string;
  unit_price_before_vat_reference: number;
};

/** Success path stamps cycle key and may advance next_document_date. */
export function buildRecurringGenerationSuccessProfileUpdate(params: {
  draftId: string;
  generatedAtIso: string;
  cycleKey: string;
  nextDocumentDate: string;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  unitPriceBeforeVatReference: number;
}): RecurringGenerationSuccessProfileUpdate {
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
export function shouldReuseExistingCycleDraft(params: {
  cycleGeneratedDraftId: string | null | undefined;
  draftStatus: string | null | undefined;
}): boolean {
  const draftId = String(params.cycleGeneratedDraftId ?? '').trim();
  return Boolean(draftId) && params.draftStatus === 'draft';
}
