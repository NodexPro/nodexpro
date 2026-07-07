/**
 * Stage 11B — Client Operations → Work Engine bridge.
 *
 * Emits standardized work_events via `intakeWorkEvent` only.
 * Does NOT write work_items, reminders, SLA, or DocFlow.
 */

import type { RequestContext } from '../../shared/context.js';
import { businessYmd } from '../../shared/business-time.js';
import { intakeWorkEvent } from '../work-engine/work-engine.event-intake.service.js';
import {
  PLATFORM_EVENT_CLIENT_OPERATIONS_ANNUAL_REPORT_DOCUMENTS_MISSING,
  PLATFORM_EVENT_CLIENT_OPERATIONS_CAPITAL_DECLARATION_DOCUMENTS_MISSING,
  PLATFORM_EVENT_CLIENT_OPERATIONS_PAYROLL_MATERIAL_MISSING,
  PLATFORM_EVENT_CLIENT_OPERATIONS_VAT_MATERIAL_MISSING,
  type PlatformEventClientOperationsType,
} from '../../shared/platform-event-catalog.js';

const SOURCE_MODULE = 'client_operations';
const SCHEMA_VERSION = 1;

export type ClientOperationsWorkEventType = PlatformEventClientOperationsType;

const EVENT_TO_WORK_TYPE: Readonly<Record<ClientOperationsWorkEventType, string>> = {
  [PLATFORM_EVENT_CLIENT_OPERATIONS_ANNUAL_REPORT_DOCUMENTS_MISSING]: 'annual_report_docs',
  [PLATFORM_EVENT_CLIENT_OPERATIONS_CAPITAL_DECLARATION_DOCUMENTS_MISSING]: 'capital_declaration_docs',
  [PLATFORM_EVENT_CLIENT_OPERATIONS_PAYROLL_MATERIAL_MISSING]: 'payroll_material',
  [PLATFORM_EVENT_CLIENT_OPERATIONS_VAT_MATERIAL_MISSING]: 'vat_material',
};

export type ClientOperationsMaterialMissingSignal = {
  ctx: RequestContext;
  orgId: string;
  clientId: string;
  eventType: ClientOperationsWorkEventType;
  periodKey: string;
  sourceEntityId: string;
  payloadJson?: Record<string, unknown>;
};

export function clientOperationsPeriodKey(scope: 'annual_report' | 'capital_declaration' | 'payroll' | 'vat', raw: string): string {
  const suffix = raw.trim();
  return `client_operations:${scope}:${suffix}`;
}

export function annualReportPeriodKey(now: Date = new Date()): string {
  return clientOperationsPeriodKey('annual_report', businessYmd(now).slice(0, 4));
}

export function capitalDeclarationPeriodKey(now: Date = new Date()): string {
  return clientOperationsPeriodKey('capital_declaration', businessYmd(now).slice(0, 4));
}

export function payrollMaterialPeriodKey(monthKey: string): string {
  return clientOperationsPeriodKey('payroll', monthKey);
}

export function vatMaterialPeriodKey(monthKey: string): string {
  return clientOperationsPeriodKey('vat', monthKey);
}

/**
 * Fire-and-forget intake. Idempotent via Work Engine dedup tuple.
 */
export async function emitClientOperationsMaterialMissing(
  signal: ClientOperationsMaterialMissingSignal,
): Promise<void> {
  const workType = EVENT_TO_WORK_TYPE[signal.eventType];
  if (!workType || !signal.periodKey) return;

  try {
    await intakeWorkEvent({ kind: 'office_request', ctx: signal.ctx }, {
      org_id: signal.orgId,
      client_id: signal.clientId,
      source_module: SOURCE_MODULE,
      source_entity_type: 'client_operations_material',
      source_entity_id: signal.sourceEntityId,
      event_type: signal.eventType,
      work_type: workType,
      period_key: signal.periodKey,
      occurred_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION,
      emitted_by_type: 'system',
      emitted_by_id: null,
      payload: signal.payloadJson ?? {},
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[client_operations → work_engine] intake failed', {
      org_id: signal.orgId,
      client_id: signal.clientId,
      event_type: signal.eventType,
      period_key: signal.periodKey,
      error: (err as { message?: string })?.message ?? String(err),
    });
  }
}

export async function syncAnnualScopeMaterialWorkEvent(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  scope: 'annual_report' | 'capital_declaration',
  hasMissingDocs: boolean,
): Promise<void> {
  if (!hasMissingDocs) return;

  const periodKey =
    scope === 'capital_declaration' ? capitalDeclarationPeriodKey() : annualReportPeriodKey();
  const eventType: ClientOperationsWorkEventType =
    scope === 'capital_declaration'
      ? PLATFORM_EVENT_CLIENT_OPERATIONS_CAPITAL_DECLARATION_DOCUMENTS_MISSING
      : PLATFORM_EVENT_CLIENT_OPERATIONS_ANNUAL_REPORT_DOCUMENTS_MISSING;

  await emitClientOperationsMaterialMissing({
    ctx,
    orgId,
    clientId,
    eventType,
    periodKey,
    sourceEntityId: `${clientId}::${scope}::${periodKey}`,
    payloadJson: { scope, missing_material: true },
  });
}

export async function syncPayrollMaterialWorkEvent(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  payrollPeriodKey: string,
): Promise<void> {
  const pk = payrollMaterialPeriodKey(payrollPeriodKey);
  await emitClientOperationsMaterialMissing({
    ctx,
    orgId,
    clientId,
    eventType: PLATFORM_EVENT_CLIENT_OPERATIONS_PAYROLL_MATERIAL_MISSING,
    periodKey: pk,
    sourceEntityId: `${clientId}::payroll::${pk}`,
    payloadJson: { payroll_period_key: payrollPeriodKey, missing_material: true },
  });
}

export async function syncVatMaterialWorkEvent(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  vatPeriodKey: string,
): Promise<void> {
  const pk = vatMaterialPeriodKey(vatPeriodKey);
  await emitClientOperationsMaterialMissing({
    ctx,
    orgId,
    clientId,
    eventType: PLATFORM_EVENT_CLIENT_OPERATIONS_VAT_MATERIAL_MISSING,
    periodKey: pk,
    sourceEntityId: `${clientId}::vat::${pk}`,
    payloadJson: { vat_period_key: vatPeriodKey, missing_material: true },
  });
}
