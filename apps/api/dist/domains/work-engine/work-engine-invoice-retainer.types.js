/**
 * Work Engine invoice retainer — types.
 */
export const WORK_ENGINE_INVOICE_RETAINER_SETUP_AGGREGATE_KEY = 'work_engine_invoice_retainer_setup_aggregate';
export const WORK_ENGINE_INVOICE_RETAINER_COMMANDS = {
    create: 'create_income_recurring_document_profile',
    update: 'update_income_recurring_document_profile',
    pause: 'pause_income_recurring_document_profile',
    resume: 'resume_income_recurring_document_profile',
    cancel: 'cancel_income_recurring_document_profile',
    preview: 'preview_income_recurring_document_profile_settings',
    approveDraft: 'approve_recurring_document_draft',
    openCycleDraftReview: 'open_recurring_cycle_draft_for_review',
    openCycleOverride: 'open_recurring_cycle_override_for_edit',
    previewCycleOverride: 'preview_recurring_cycle_override',
    saveCycleOverride: 'save_recurring_cycle_override',
    deleteCycleOverride: 'delete_recurring_cycle_override',
};
export const WORK_ENGINE_RECURRING_CYCLE_OVERRIDE_AGGREGATE_KEY = 'work_engine_recurring_cycle_override_aggregate';
export const WORK_ENGINE_RECURRING_CYCLE_DRAFT_REVIEW_AGGREGATE_KEY = 'work_engine_recurring_cycle_draft_review_aggregate';
