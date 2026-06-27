/**
 * Work Engine — retainer recurring document scheduler bridge.
 *
 * Emits retainer work events through `intakeWorkEvent` only (no direct work_items writes).
 */
import { randomUUID } from 'node:crypto';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { intakeWorkEvent } from './work-engine.event-intake.service.js';
import { RECURRING_APPROVED_EVENT_TYPE, RECURRING_FAILURE_EVENT_TYPE, RECURRING_FAILURE_WORK_TYPE, RECURRING_SEND_FOLLOWUP_EVENT_TYPE, RECURRING_SEND_FOLLOWUP_WORK_TYPE, RECURRING_WORK_ENGINE_ENTITY_TYPE, RECURRING_WORK_ENGINE_SCHEMA_VERSION, RECURRING_WORK_ENGINE_SOURCE_MODULE, RECURRING_WORK_EVENT_TYPE, RECURRING_WORK_TYPE, recurringProfileWorkPeriodKey, } from './work-engine-invoice-retainer.pure.js';
function buildDraftCreatedIntakePayload(signal) {
    const periodKey = recurringProfileWorkPeriodKey(signal.recurringProfileId, signal.scheduledDocumentDate);
    return {
        org_id: signal.organizationId,
        client_id: signal.representedClientId,
        source_module: RECURRING_WORK_ENGINE_SOURCE_MODULE,
        source_entity_type: RECURRING_WORK_ENGINE_ENTITY_TYPE,
        source_entity_id: signal.recurringProfileId,
        event_type: RECURRING_WORK_EVENT_TYPE,
        period_key: periodKey,
        occurred_at: new Date().toISOString(),
        schema_version: RECURRING_WORK_ENGINE_SCHEMA_VERSION,
        emitted_by_type: 'system',
        emitted_by_id: null,
        event_id: randomUUID(),
        idempotency_key: `retainer:draft:${signal.recurringProfileId}:${signal.scheduledDocumentDate}`,
        payload: {
            organization_id: signal.organizationId,
            represented_client_id: signal.representedClientId,
            end_customer_id: signal.endCustomerId,
            recurring_profile_id: signal.recurringProfileId,
            draft_id: signal.draftId,
            document_type: signal.documentType,
            scheduled_document_date: signal.scheduledDocumentDate,
            service_period_start: signal.servicePeriodStart,
            service_period_end: signal.servicePeriodEnd,
            work_type: RECURRING_WORK_TYPE,
        },
    };
}
function buildGenerationFailedIntakePayload(signal) {
    const periodKey = recurringProfileWorkPeriodKey(signal.recurringProfileId, signal.scheduledDocumentDate);
    return {
        org_id: signal.organizationId,
        client_id: signal.representedClientId,
        source_module: RECURRING_WORK_ENGINE_SOURCE_MODULE,
        source_entity_type: RECURRING_WORK_ENGINE_ENTITY_TYPE,
        source_entity_id: signal.recurringProfileId,
        event_type: RECURRING_FAILURE_EVENT_TYPE,
        period_key: periodKey,
        occurred_at: new Date().toISOString(),
        schema_version: RECURRING_WORK_ENGINE_SCHEMA_VERSION,
        emitted_by_type: 'system',
        emitted_by_id: null,
        event_id: randomUUID(),
        idempotency_key: `retainer:failed:${signal.recurringProfileId}:${signal.scheduledDocumentDate}`,
        payload: {
            organization_id: signal.organizationId,
            represented_client_id: signal.representedClientId,
            end_customer_id: signal.endCustomerId,
            recurring_profile_id: signal.recurringProfileId,
            error_code: signal.errorCode,
            error_message: signal.errorMessage,
            scheduled_document_date: signal.scheduledDocumentDate,
            work_type: RECURRING_FAILURE_WORK_TYPE,
        },
    };
}
async function auditBridgeFailure(signal, eventType, error) {
    try {
        await writeAudit({
            organizationId: signal.organizationId,
            actorUserId: signal.ctx.user?.id ?? null,
            moduleCode: 'work_engine',
            entityType: RECURRING_WORK_ENGINE_ENTITY_TYPE,
            entityId: signal.recurringProfileId,
            action: AUDIT_ACTIONS.INCOME_WORK_ENGINE_BRIDGE_INTAKE_FAILED,
            payload: { event_type: eventType, error },
        });
    }
    catch {
        // best-effort
    }
}
export async function emitRecurringDocumentDraftCreatedWorkEvent(signal) {
    const body = buildDraftCreatedIntakePayload(signal);
    try {
        return await intakeWorkEvent({ kind: 'office_request', ctx: signal.ctx }, body);
    }
    catch (err) {
        const msg = err?.message ?? String(err);
        await auditBridgeFailure(signal, RECURRING_WORK_EVENT_TYPE, msg);
        return null;
    }
}
export async function emitRecurringGenerationFailedWorkEvent(signal) {
    const body = buildGenerationFailedIntakePayload(signal);
    try {
        return await intakeWorkEvent({ kind: 'office_request', ctx: signal.ctx }, body);
    }
    catch (err) {
        const msg = err?.message ?? String(err);
        await auditBridgeFailure(signal, RECURRING_FAILURE_EVENT_TYPE, msg);
        return null;
    }
}
function buildDocumentApprovedIntakePayload(signal) {
    const periodKey = recurringProfileWorkPeriodKey(signal.recurringProfileId, signal.scheduledDocumentDate);
    return {
        org_id: signal.organizationId,
        client_id: signal.representedClientId,
        source_module: RECURRING_WORK_ENGINE_SOURCE_MODULE,
        source_entity_type: RECURRING_WORK_ENGINE_ENTITY_TYPE,
        source_entity_id: signal.recurringProfileId,
        event_type: RECURRING_APPROVED_EVENT_TYPE,
        period_key: periodKey,
        occurred_at: signal.approvedAt,
        schema_version: RECURRING_WORK_ENGINE_SCHEMA_VERSION,
        emitted_by_type: signal.ctx.user?.id ? 'user' : 'system',
        emitted_by_id: signal.ctx.user?.id ?? null,
        event_id: randomUUID(),
        idempotency_key: `retainer:approved:${signal.recurringProfileId}:${signal.scheduledDocumentDate}`,
        payload: {
            organization_id: signal.organizationId,
            represented_client_id: signal.representedClientId,
            end_customer_id: signal.endCustomerId,
            recurring_profile_id: signal.recurringProfileId,
            cycle_id: signal.cycleId,
            draft_id: signal.draftId,
            scheduled_document_date: signal.scheduledDocumentDate,
            approved_at: signal.approvedAt,
        },
    };
}
function buildSendFollowupDueIntakePayload(signal) {
    const periodKey = recurringProfileWorkPeriodKey(signal.recurringProfileId, signal.scheduledDocumentDate);
    return {
        org_id: signal.organizationId,
        client_id: signal.representedClientId,
        source_module: RECURRING_WORK_ENGINE_SOURCE_MODULE,
        source_entity_type: RECURRING_WORK_ENGINE_ENTITY_TYPE,
        source_entity_id: signal.recurringProfileId,
        event_type: RECURRING_SEND_FOLLOWUP_EVENT_TYPE,
        period_key: periodKey,
        occurred_at: new Date().toISOString(),
        schema_version: RECURRING_WORK_ENGINE_SCHEMA_VERSION,
        emitted_by_type: 'system',
        emitted_by_id: null,
        event_id: randomUUID(),
        idempotency_key: `retainer:send_followup:${signal.recurringProfileId}:${signal.scheduledDocumentDate}`,
        payload: {
            organization_id: signal.organizationId,
            represented_client_id: signal.representedClientId,
            end_customer_id: signal.endCustomerId,
            recurring_profile_id: signal.recurringProfileId,
            cycle_id: signal.cycleId,
            draft_id: signal.draftId,
            scheduled_document_date: signal.scheduledDocumentDate,
            approved_at: signal.approvedAt,
            reason_code: signal.reasonCode,
            work_type: RECURRING_SEND_FOLLOWUP_WORK_TYPE,
        },
    };
}
/** Audit-only intake — no work_item mapping (pending_mapping outcome). */
export async function emitRecurringDocumentApprovedWorkEvent(signal) {
    const body = buildDocumentApprovedIntakePayload(signal);
    try {
        return await intakeWorkEvent({ kind: 'office_request', ctx: signal.ctx }, body);
    }
    catch (err) {
        const msg = err?.message ?? String(err);
        await auditBridgeFailure(signal, RECURRING_APPROVED_EVENT_TYPE, msg);
        return null;
    }
}
export async function emitRecurringDocumentSendFollowupDueWorkEvent(signal) {
    const body = buildSendFollowupDueIntakePayload(signal);
    try {
        return await intakeWorkEvent({ kind: 'office_request', ctx: signal.ctx }, body);
    }
    catch (err) {
        const msg = err?.message ?? String(err);
        await auditBridgeFailure(signal, RECURRING_SEND_FOLLOWUP_EVENT_TYPE, msg);
        return null;
    }
}
