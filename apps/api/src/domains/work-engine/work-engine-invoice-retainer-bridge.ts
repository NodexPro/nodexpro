/**
 * Work Engine — retainer recurring document scheduler bridge.
 *
 * Emits retainer work events through `intakeWorkEvent` only (no direct work_items writes).
 */

import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { intakeWorkEvent } from './work-engine.event-intake.service.js';
import type { IntakeWorkEventMeta } from './work-engine.types.js';
import {
  RECURRING_FAILURE_EVENT_TYPE,
  RECURRING_FAILURE_WORK_TYPE,
  RECURRING_WORK_ENGINE_ENTITY_TYPE,
  RECURRING_WORK_ENGINE_SCHEMA_VERSION,
  RECURRING_WORK_ENGINE_SOURCE_MODULE,
  RECURRING_WORK_EVENT_TYPE,
  RECURRING_WORK_TYPE,
  recurringProfileWorkPeriodKey,
} from './work-engine-invoice-retainer.pure.js';

export type RecurringDraftCreatedSignal = {
  ctx: RequestContext;
  organizationId: string;
  representedClientId: string;
  endCustomerId: string;
  recurringProfileId: string;
  draftId: string;
  documentType: string;
  scheduledDocumentDate: string;
  servicePeriodStart: string;
  servicePeriodEnd: string;
};

export type RecurringGenerationFailedSignal = {
  ctx: RequestContext;
  organizationId: string;
  representedClientId: string;
  endCustomerId: string;
  recurringProfileId: string;
  errorCode: string;
  errorMessage: string;
  scheduledDocumentDate: string;
};

function buildDraftCreatedIntakePayload(signal: RecurringDraftCreatedSignal): Record<string, unknown> {
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

function buildGenerationFailedIntakePayload(
  signal: RecurringGenerationFailedSignal,
): Record<string, unknown> {
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

async function auditBridgeFailure(
  signal: RecurringDraftCreatedSignal | RecurringGenerationFailedSignal,
  eventType: string,
  error: string,
): Promise<void> {
  try {
    await writeAudit({
      organizationId: signal.organizationId,
      actorUserId: signal.ctx.user.id,
      moduleCode: 'work_engine',
      entityType: RECURRING_WORK_ENGINE_ENTITY_TYPE,
      entityId: signal.recurringProfileId,
      action: AUDIT_ACTIONS.INCOME_WORK_ENGINE_BRIDGE_INTAKE_FAILED,
      payload: { event_type: eventType, error },
    });
  } catch {
    // best-effort
  }
}

export async function emitRecurringDocumentDraftCreatedWorkEvent(
  signal: RecurringDraftCreatedSignal,
): Promise<IntakeWorkEventMeta | null> {
  const body = buildDraftCreatedIntakePayload(signal);
  try {
    return await intakeWorkEvent({ kind: 'office_request', ctx: signal.ctx }, body);
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? String(err);
    await auditBridgeFailure(signal, RECURRING_WORK_EVENT_TYPE, msg);
    return null;
  }
}

export async function emitRecurringGenerationFailedWorkEvent(
  signal: RecurringGenerationFailedSignal,
): Promise<IntakeWorkEventMeta | null> {
  const body = buildGenerationFailedIntakePayload(signal);
  try {
    return await intakeWorkEvent({ kind: 'office_request', ctx: signal.ctx }, body);
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? String(err);
    await auditBridgeFailure(signal, RECURRING_FAILURE_EVENT_TYPE, msg);
    return null;
  }
}
