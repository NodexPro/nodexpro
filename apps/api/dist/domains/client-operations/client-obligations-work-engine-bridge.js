/**
 * Stage 3C — Client Obligations → Work Engine bridge.
 *
 * SAFE, ADDITIVE-ONLY bridge that emits a single Work Engine event when a
 * client_obligations row transitions INTO `status='missing_data'` for an
 * `obligation_type` that maps to a Stage 3B allowlisted event_type.
 *
 * STRICT RULES:
 *   - This module does NOT write to work_items, work_transitions, work_events
 *     or any Work Engine table directly. The ONLY entry point is
 *     `intakeWorkEvent(...)` from work-engine.event-intake.service.ts.
 *   - This module does NOT change any client_obligations / client_tasks /
 *     client_operational_profiles behavior. The existing recompute flow is
 *     preserved verbatim; this bridge is invoked only after a successful
 *     upsert and is fire-and-forget.
 *   - This module never throws back into the caller. Any Work Engine intake
 *     failure is logged but swallowed so the obligation recompute flow
 *     continues unchanged.
 *   - NO financial truth. NO country-specific deadlines. NO SLA logic.
 *   - The obligation_type → event_type mapping is intentionally a thin
 *     lookup; allowed event_types are owned by Work Engine's Stage 3B
 *     mapper allowlist. Adding entries here without a corresponding mapper
 *     entry will result in `pending_mapping` (audited, no work_item).
 */
import { intakeWorkEvent } from '../work-engine/work-engine.event-intake.service.js';
const SOURCE_MODULE = 'client_obligations';
const SOURCE_ENTITY_TYPE = 'client_obligation';
const SCHEMA_VERSION = 1;
/**
 * Stage 3C allowlist: obligation_type → event_type the Work Engine mapper
 * understands. Anything not present here is silently NOT emitted (no event,
 * no audit, no error). Must stay in sync with the allowlist in
 * `apps/api/src/domains/work-engine/work-engine.event-mapping.service.ts`.
 */
const OBLIGATION_TYPE_TO_EVENT_TYPE = {
    payroll_data: 'payroll.documents_missing',
    vat_report: 'vat.documents_missing',
    annual_report: 'annual_report.documents_missing',
};
export function mapObligationTypeToWorkEngineEvent(obligationType) {
    return OBLIGATION_TYPE_TO_EVENT_TYPE[obligationType] ?? null;
}
/**
 * Emit a Work Engine event for an obligation that JUST became `missing_data`.
 *
 * The caller is responsible for the transition gate
 * (`existingStatus !== 'missing_data' && new status === 'missing_data'`).
 * This helper only checks the obligation_type → event_type allowlist and
 * routes to Work Engine intake. Idempotency at the Work Engine layer makes
 * accidental re-emissions a no-op.
 *
 * Returns void in all cases. Failures are logged, never re-thrown — this
 * bridge is strictly additive and must not impact obligation recompute.
 */
export async function emitObligationDocumentsMissingIfMapped(signal) {
    const eventType = mapObligationTypeToWorkEngineEvent(signal.obligationType);
    if (!eventType)
        return;
    if (!signal.periodKey)
        return;
    // Deterministic source_entity_id so the Work Engine intake idempotency
    // tuple (org_id, source_module, source_entity_id, event_type, period_key)
    // is stable across recomputes / night-pass / on-demand command paths.
    const sourceEntityId = `${signal.clientId}::${signal.obligationType}::${signal.periodKey}`;
    try {
        await intakeWorkEvent({ kind: 'office_request', ctx: signal.ctx }, {
            org_id: signal.orgId,
            client_id: signal.clientId,
            source_module: SOURCE_MODULE,
            source_entity_type: SOURCE_ENTITY_TYPE,
            source_entity_id: sourceEntityId,
            event_type: eventType,
            period_key: signal.periodKey,
            occurred_at: new Date().toISOString(),
            schema_version: SCHEMA_VERSION,
            emitted_by_type: 'system',
            emitted_by_id: null,
            payload: {
                obligation_type: signal.obligationType,
                due_date: signal.dueDate,
                blocking_reason: signal.blockingReason,
            },
        });
    }
    catch (err) {
        // Stage 3C is additive: any Work Engine failure must not break the
        // existing obligation recompute path. Log to stderr and continue.
        // eslint-disable-next-line no-console
        console.warn('[client_obligations → work_engine] intake failed for obligation event', {
            org_id: signal.orgId,
            client_id: signal.clientId,
            obligation_type: signal.obligationType,
            period_key: signal.periodKey,
            event_type: eventType,
            error: err?.message ?? String(err),
        });
    }
}
