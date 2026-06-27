/**
 * Work Engine event mapping layer (Stage 3B).
 *
 * Backend-only allowlist that maps a small, explicit set of event_type strings
 * to the workflow contract:
 *   { module_key, work_type, initial_state, period_key required? }
 *
 * STRICT RULES:
 *   - Backend NEVER invents a mapping. Only event_type values present in
 *     SAFE_EVENT_MAPPINGS resolve. Anything else stays pending_mapping.
 *   - Mapper does NOT compute legal period_key, due dates, SLA, or any
 *     country-specific rules. Period semantics belong to Country Pack /
 *     Owner Legal Control Panel; the emitter must supply period_key.
 *   - This file contains NO financial truth, NO frontend, NO UI logic, NO
 *     runtime coupling to DocFlow / client_tasks / obligations. It is pure dispatch
 *     metadata.
 *   - Extending the allowlist requires an explicit backend change here.
 *     UI/frontend cannot extend it.
 *
 * Source of truth for the workflow contract: docs/work-engine-domain-model.md,
 * docs/work-engine-state-machine.md, docs/work-engine-dedup-policy.md.
 */
/**
 * Stage 3B allowlist.
 *
 * Adding a new entry is a deliberate architectural decision: it implicitly
 * grants emitters the ability to create work_items in that workflow domain.
 * Review checklist before adding:
 *   1. Is `work_type` canonical and stable? (No "v2" / "new" suffixes.)
 *   2. Is `initial_state` semantically correct for this trigger? (e.g. an
 *      "office must act" event should NOT start in `waiting_client`.)
 *   3. Is `module_key` already a known workflow domain? (Don't introduce a
 *      module key here that no aggregate / read-model knows about.)
 *   4. Does the emitter ship `period_key` reliably?
 */
const SAFE_EVENT_MAPPINGS = {
    'payroll.documents_missing': {
        module_key: 'payroll',
        work_type: 'payroll_document_collection',
        initial_state: 'waiting_client',
        requires_period_key: true,
    },
    'vat.documents_missing': {
        module_key: 'vat',
        work_type: 'vat_document_collection',
        initial_state: 'waiting_client',
        requires_period_key: true,
    },
    'annual_report.documents_missing': {
        module_key: 'annual_report',
        work_type: 'annual_report_document_collection',
        initial_state: 'waiting_client',
        requires_period_key: true,
    },
    'client_operations.annual_report_documents_missing': {
        module_key: 'client_operations',
        work_type: 'annual_report_docs',
        initial_state: 'waiting_client',
        requires_period_key: true,
    },
    'client_operations.capital_declaration_documents_missing': {
        module_key: 'client_operations',
        work_type: 'capital_declaration_docs',
        initial_state: 'waiting_client',
        requires_period_key: true,
    },
    'client_operations.payroll_material_missing': {
        module_key: 'client_operations',
        work_type: 'payroll_material',
        initial_state: 'waiting_client',
        requires_period_key: true,
    },
    'client_operations.vat_material_missing': {
        module_key: 'client_operations',
        work_type: 'vat_material',
        initial_state: 'waiting_client',
        requires_period_key: true,
    },
    'docflow.thread_needs_attention': {
        module_key: 'docflow',
        work_type: 'docflow_thread_followup',
        initial_state: 'waiting_human',
        requires_period_key: true,
    },
    /** INC-8 — Income invoice overdue → collection follow-up (display/reference payload only). */
    'income.invoice_overdue': {
        module_key: 'income',
        work_type: 'invoice_collection_followup',
        initial_state: 'waiting_client',
        requires_period_key: true,
    },
    /** Retainer Phase 1 — generated draft awaits accountant review (no auto issue/send). */
    recurring_document_draft_created: {
        module_key: 'income',
        work_type: 'recurring_invoice_review',
        initial_state: 'waiting_human',
        requires_period_key: true,
    },
    /** Retainer Phase 1 — scheduler draft generation failed for a cycle. */
    recurring_generation_failed: {
        module_key: 'income',
        work_type: 'recurring_generation_failed',
        initial_state: 'new',
        requires_period_key: true,
    },
    /** Retainer — approved draft not sent via DocFlow after grace period. */
    recurring_document_send_followup_due: {
        module_key: 'income',
        work_type: 'recurring_document_send_followup',
        initial_state: 'waiting_human',
        requires_period_key: true,
    },
};
export const MAPPING_REASON = {
    UNKNOWN_EVENT_MAPPING: 'unknown_event_mapping',
    MISSING_PERIOD_KEY: 'missing_period_key',
};
/** Outcomes where the event row exists but no work_item was linked yet. */
export const PENDING_MAPPING_PROCESSING_OUTCOMES = [
    'accepted_pending_mapping',
    MAPPING_REASON.UNKNOWN_EVENT_MAPPING,
    MAPPING_REASON.MISSING_PERIOD_KEY,
];
/** Stable list of event_type values backend will currently resolve. */
export function knownEventTypes() {
    return Object.keys(SAFE_EVENT_MAPPINGS);
}
/**
 * Pure function: no I/O, no DB access, no audit. The intake service decides
 * how to persist the outcome and how to audit. The mapper only answers:
 *   - "is this event_type in the allowlist?"
 *   - "are required envelope fields present?"
 *
 * It does NOT validate `period_key` format (the intake validator does that).
 * It only checks presence vs. allowlist's requirement.
 */
export function resolveEventMapping(input) {
    const mapping = SAFE_EVENT_MAPPINGS[input.event_type];
    if (!mapping) {
        const pending = {
            resolved: false,
            reason: MAPPING_REASON.UNKNOWN_EVENT_MAPPING,
        };
        return pending;
    }
    if (mapping.requires_period_key && !input.period_key) {
        const pending = {
            resolved: false,
            reason: MAPPING_REASON.MISSING_PERIOD_KEY,
            missing_fields: ['period_key'],
        };
        return pending;
    }
    const resolved = {
        resolved: true,
        module_key: mapping.module_key,
        work_type: mapping.work_type,
        initial_state: mapping.initial_state,
    };
    return resolved;
}
