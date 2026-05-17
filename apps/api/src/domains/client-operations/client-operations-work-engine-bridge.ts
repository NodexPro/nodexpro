/**
 * Stage 11B — Client Operations → Work Engine bridge.
 *
 * Emits standardized work_events via `intakeWorkEvent` only.
 * Does NOT write work_items, reminders, SLA, or DocFlow.
 */

import type { RequestContext } from '../../shared/context.js';
import { businessYmd } from '../../shared/business-time.js';
import { intakeWorkEvent } from '../work-engine/work-engine.event-intake.service.js';

const SOURCE_MODULE = 'client_operations';
const SCHEMA_VERSION = 1;

export type ClientOperationsWorkEventType =
  | 'client_operations.annual_report_documents_missing'
  | 'client_operations.capital_declaration_documents_missing'
  | 'client_operations.payroll_material_missing'
  | 'client_operations.vat_material_missing';

const EVENT_TO_WORK_TYPE: Readonly<Record<ClientOperationsWorkEventType, string>> = {
  'client_operations.annual_report_documents_missing': 'annual_report_docs',
  'client_operations.capital_declaration_documents_missing': 'capital_declaration_docs',
  'client_operations.payroll_material_missing': 'payroll_material',
  'client_operations.vat_material_missing': 'vat_material',
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
      ? 'client_operations.capital_declaration_documents_missing'
      : 'client_operations.annual_report_documents_missing';

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
    eventType: 'client_operations.payroll_material_missing',
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
    eventType: 'client_operations.vat_material_missing',
    periodKey: pk,
    sourceEntityId: `${clientId}::vat::${pk}`,
    payloadJson: { vat_period_key: vatPeriodKey, missing_material: true },
  });
}
