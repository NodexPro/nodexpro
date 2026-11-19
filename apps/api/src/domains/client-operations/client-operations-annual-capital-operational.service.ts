/**
 * Client Operations — annual report / capital declaration operational target dates.
 * Batch loaders + named commands. Caller returns refreshed registry aggregate.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingRpcError,
  isSupabaseMissingTableError,
} from '../../shared/supabase-errors.js';
import { isOperationalPeriodKey } from './client-operations-operational-period.pure.js';
import {
  checklistFileIdsForFilingYear,
  supportsAnnualDocumentTaxYearColumns,
  uploadAnnualReportDocument,
} from './client-annual-report-tab.service.js';
import {
  annualFilingUsesTabTaxYear,
  applyCapitalPeriodProjection,
  buildCapitalDeclarationCell,
  buildCapitalPeriodCycles,
  isCanonicalIsoDate,
  linkedFileKindLabelKey,
  mergeAnnualDateRevisions,
  nextCapitalDeclarationSequenceNo,
  operationalPeriodKeyFromEventTimestamp,
  projectAnnualCapitalCycleOntoPeriod,
  projectAnnualReportCellForOperationalPeriod,
  resolveAnnualDateCommandTaxYear,
  resolveAnnualReportTaxYearForOperationalPeriod,
  selectCoveringAnnualInstanceForPeriod,
  type AnnualDateRevision,
  type AnnualCapitalLinkedFile,
  type AnnualCapitalSubmissionFileKind,
  type AnnualReportOperationalDateCell,
  type CapitalDeclarationOperationalDateCell,
} from './client-operations-annual-capital-operational.pure.js';

const ANNUAL_DATE_SET_AUDIT_ACTION = AUDIT_ACTIONS.CLIENT_OPERATIONS_ANNUAL_REPORT_OPERATIONAL_TARGET_DATE_SET;
const ANNUAL_DATE_REVISIONS_TABLE = 'client_annual_report_year_instance_date_revisions';
const ANNUAL_DATE_SET_RPC = 'set_client_annual_report_year_instance_date';

export type AnnualYearInstanceRow = {
  id: string;
  client_id: string;
  tax_year: number;
  operational_target_date: string | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
};

export type CapitalDeclarationInstanceRow = {
  id: string;
  client_id: string;
  tax_year: number | null;
  operational_target_date: string | null;
  status: string;
  label_he: string | null;
  sequence_no: number;
  opened_at: string | null;
  completed_at: string | null;
};

export type AnnualSubmissionFactRow = {
  id: string;
  client_id: string;
  tax_year: number;
  submitted_on: string;
  created_at: string | null;
  tab_scope: string | null;
  capital_declaration_instance_id: string | null;
};

export type AnnualSubmissionFileFactRow = {
  submission_id: string;
  file_asset_id: string;
  source_kind: AnnualCapitalSubmissionFileKind;
  file_name: string | null;
};

function assertOrg(ctx: RequestContext): string {
  if (!ctx.organizationId) throw forbidden('Active organization required');
  return ctx.organizationId;
}

function assertEdit(ctx: RequestContext): void {
  if (!ctx.membership?.permissions?.includes('client_operations.edit')) {
    throw forbidden('client_operations.edit permission required');
  }
}

function assertQueryError(error: { message?: string } | null, description: string): void {
  if (error) throw new AppError(500, error.message || description, 'SUPABASE_ERROR');
}

async function audit(
  ctx: RequestContext,
  action: string,
  entityId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeAudit({
    organizationId: assertOrg(ctx),
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_operations_operational_date',
    entityId,
    action,
    payload,
  });
}

async function ensureActiveClientInOrg(orgId: string, clientId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .eq('is_archived', false)
    .maybeSingle();
  assertQueryError(error, 'Failed to validate client');
  if (!data) throw forbidden('Client not found');
}

function dateOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isCanonicalIsoDate(value)) throw badRequest('operational_target_date must be YYYY-MM-DD or null');
  return value;
}

function requiredIsoDate(value: unknown, field: string): string {
  if (!isCanonicalIsoDate(value)) throw badRequest(`${field} must be YYYY-MM-DD`);
  return value;
}

function mapCapitalInstanceRow(row: {
  id: string;
  client_id: string;
  tax_year: number | null;
  operational_target_date: string | null;
  status: string;
  label_he?: string | null;
  sequence_no?: number | null;
  opened_at?: string | null;
  completed_at?: string | null;
}): CapitalDeclarationInstanceRow {
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    tax_year: row.tax_year == null ? null : Number(row.tax_year),
    operational_target_date: row.operational_target_date
      ? String(row.operational_target_date).slice(0, 10)
      : null,
    status: String(row.status),
    label_he: row.label_he == null ? null : String(row.label_he),
    sequence_no: Number(row.sequence_no ?? 0) || 1,
    opened_at: row.opened_at ? String(row.opened_at) : null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
  };
}

function parseSourceKind(value: unknown): AnnualCapitalSubmissionFileKind {
  if (value === 'form_1301' || value === 'additional' || value === 'checklist') return value;
  return 'additional';
}

function asLinkedFile(row: AnnualSubmissionFileFactRow): AnnualCapitalLinkedFile {
  return {
    file_asset_id: row.file_asset_id,
    file_name: row.file_name,
    source_kind: row.source_kind,
    source_kind_label_key: linkedFileKindLabelKey(row.source_kind),
    can_open: true,
  };
}

/**
 * Batch: annual year instances visible for a registry month.
 * Tab tax year (any status) plus outstanding open instances of other years.
 * Tenant-scoped; GET never inserts.
 */
export async function loadAnnualReportYearInstancesForClients(input: {
  organizationId: string;
  clientIds: string[];
  taxYear: number;
}): Promise<Map<string, AnnualYearInstanceRow[]>> {
  const out = new Map<string, AnnualYearInstanceRow[]>();
  if (input.clientIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from('client_annual_report_year_instances')
    .select('id, client_id, tax_year, operational_target_date, status, created_at, updated_at')
    .eq('organization_id', input.organizationId)
    .in('client_id', input.clientIds)
    .or(`tax_year.eq.${input.taxYear},status.eq.open`);
  assertQueryError(error, 'Failed to load annual report year instances');
  for (const raw of data ?? []) {
    const row = raw as AnnualYearInstanceRow;
    const mapped: AnnualYearInstanceRow = {
      id: String(row.id),
      client_id: String(row.client_id),
      tax_year: Number(row.tax_year),
      operational_target_date: row.operational_target_date
        ? String(row.operational_target_date).slice(0, 10)
        : null,
      status: String(row.status),
      created_at: row.created_at ? String(row.created_at) : null,
      updated_at: row.updated_at ? String(row.updated_at) : null,
    };
    const list = out.get(mapped.client_id) ?? [];
    if (!list.some((existing) => existing.id === mapped.id)) list.push(mapped);
    out.set(mapped.client_id, list);
  }
  return out;
}

function mapDateRevision(input: {
  instance_id: string;
  operational_target_date: string | null;
  effective_period_key: string | null;
  recorded_at: string | null;
}): AnnualDateRevision | null {
  const instanceId = String(input.instance_id ?? '').trim();
  const recordedAt = input.recorded_at ? String(input.recorded_at) : '';
  const fromPayload = input.effective_period_key && isOperationalPeriodKey(input.effective_period_key)
    ? input.effective_period_key
    : null;
  const fromTimestamp = operationalPeriodKeyFromEventTimestamp(recordedAt);
  const effective = fromPayload ?? fromTimestamp;
  if (!instanceId || !effective || !recordedAt) return null;
  return {
    instance_id: instanceId,
    operational_target_date: input.operational_target_date
      ? String(input.operational_target_date).slice(0, 10)
      : null,
    effective_period_key: effective,
    recorded_at: recordedAt,
  };
}

async function loadAnnualDateRevisionsFromAudit(input: {
  organizationId: string;
  clientIds: string[];
  instanceIds: string[];
}): Promise<AnnualDateRevision[]> {
  if (!input.instanceIds.length) return [];
  let query = supabaseAdmin
    .from('audit_log')
    .select('entity_id, payload_json, created_at')
    .eq('organization_id', input.organizationId)
    .eq('module_code', 'client-operations')
    .eq('entity_type', 'client_operations_operational_date')
    .eq('action', ANNUAL_DATE_SET_AUDIT_ACTION)
    .order('created_at', { ascending: true });
  if (input.instanceIds.length) {
    query = query.in('entity_id', input.instanceIds);
  }
  const { data, error } = await query;
  if (error) {
    const retry = await supabaseAdmin
      .from('audit_log')
      .select('entity_id, payload_json, created_at')
      .eq('organization_id', input.organizationId)
      .eq('module_code', 'client-operations')
      .eq('action', ANNUAL_DATE_SET_AUDIT_ACTION)
      .order('created_at', { ascending: true })
      .limit(4000);
    if (retry.error) return [];
    return mapAuditDateRevisions(retry.data, {
      clientIds: new Set(input.clientIds),
      instanceIds: new Set(input.instanceIds),
    });
  }
  return mapAuditDateRevisions(data, input.instanceIds.length ? null : { clientIds: new Set(input.clientIds), instanceIds: new Set() });
}

function mapAuditDateRevisions(
  rows: unknown,
  filter: { clientIds: Set<string>; instanceIds: Set<string> } | null,
): AnnualDateRevision[] {
  const out: AnnualDateRevision[] = [];
  for (const raw of (rows as Array<Record<string, unknown>> | null) ?? []) {
    const payload = (raw.payload_json ?? {}) as Record<string, unknown>;
    const clientId = payload.client_id ? String(payload.client_id) : '';
    const instanceId = String(raw.entity_id ?? '');
    if (filter) {
      const clientOk = clientId ? filter.clientIds.has(clientId) : false;
      const instanceOk = instanceId ? filter.instanceIds.has(instanceId) : false;
      if (!clientOk && !instanceOk) continue;
    }
    const mapped = mapDateRevision({
      instance_id: instanceId,
      operational_target_date:
        payload.operational_target_date == null || payload.operational_target_date === ''
          ? null
          : String(payload.operational_target_date),
      effective_period_key:
        typeof payload.operational_period_key === 'string' ? payload.operational_period_key : null,
      recorded_at: raw.created_at ? String(raw.created_at) : null,
    });
    if (mapped) out.push(mapped);
  }
  return out;
}

async function loadAnnualDateRevisionsFromTable(input: {
  organizationId: string;
  clientIds: string[];
}): Promise<AnnualDateRevision[]> {
  if (!input.clientIds.length) return [];
  const { data, error } = await supabaseAdmin
    .from(ANNUAL_DATE_REVISIONS_TABLE)
    .select('instance_id, operational_target_date, operational_period_key, recorded_at')
    .eq('organization_id', input.organizationId)
    .in('client_id', input.clientIds)
    .order('recorded_at', { ascending: true });
  if (error && isSupabaseMissingTableError(error, ANNUAL_DATE_REVISIONS_TABLE)) {
    return [];
  }
  assertQueryError(error, 'Failed to load annual date revisions');
  const out: AnnualDateRevision[] = [];
  for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
    const mapped = mapDateRevision({
      instance_id: String(raw.instance_id ?? ''),
      operational_target_date:
        raw.operational_target_date == null ? null : String(raw.operational_target_date),
      effective_period_key:
        typeof raw.operational_period_key === 'string' ? raw.operational_period_key : null,
      recorded_at: raw.recorded_at ? String(raw.recorded_at) : null,
    });
    if (mapped) out.push(mapped);
  }
  return out;
}

/** Audit events (existing DATE_SET) + versioned rows (new writes). Never invents missing history. */
export async function loadAnnualDateRevisionsForClients(input: {
  organizationId: string;
  clientIds: string[];
  instanceIds?: string[];
}): Promise<Map<string, AnnualDateRevision[]>> {
  const out = new Map<string, AnnualDateRevision[]>();
  if (!input.clientIds.length) return out;
  const instanceIds = input.instanceIds ?? [];
  const [fromAudit, fromTable] = await Promise.all([
    loadAnnualDateRevisionsFromAudit({ ...input, instanceIds }),
    loadAnnualDateRevisionsFromTable(input),
  ]);
  const merged = mergeAnnualDateRevisions([...fromAudit, ...fromTable]);
  for (const row of merged) {
    const list = out.get(row.instance_id) ?? [];
    list.push(row);
    out.set(row.instance_id, list);
  }
  return out;
}

async function writeAnnualDateSetAudit(input: {
  ctx: RequestContext;
  instanceId: string;
  clientId: string;
  operationalPeriodKey: string;
  taxYear: number;
  operationalTargetDate: string | null;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('audit_log').insert({
    organization_id: assertOrg(input.ctx),
    actor_user_id: input.ctx.user.id,
    module_code: 'client-operations',
    entity_type: 'client_operations_operational_date',
    entity_id: input.instanceId,
    action: ANNUAL_DATE_SET_AUDIT_ACTION,
    payload_json: {
      client_id: input.clientId,
      operational_period_key: input.operationalPeriodKey,
      tax_year: input.taxYear,
      operational_target_date: input.operationalTargetDate,
    },
  });
  assertQueryError(error, 'Failed to record annual date change');
}

async function upsertAnnualYearInstanceDate(input: {
  orgId: string;
  clientId: string;
  taxYear: number;
  date: string | null;
  actorId: string;
  nowIso: string;
}): Promise<string> {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('client_annual_report_year_instances')
    .select('id, status')
    .eq('organization_id', input.orgId)
    .eq('client_id', input.clientId)
    .eq('tax_year', input.taxYear)
    .maybeSingle();
  assertQueryError(existingError, 'Failed to load annual report year instance');

  if (existing?.id) {
    const instanceId = String(existing.id);
    const reopen = String((existing as { status?: string }).status ?? '') === 'completed';
    const { error } = await supabaseAdmin
      .from('client_annual_report_year_instances')
      .update({
        operational_target_date: input.date,
        ...(reopen ? { status: 'open' } : {}),
        updated_at: input.nowIso,
        updated_by: input.actorId,
      })
      .eq('organization_id', input.orgId)
      .eq('id', instanceId);
    assertQueryError(error, 'Failed to update annual report year instance');
    return instanceId;
  }

  const { data, error } = await supabaseAdmin
    .from('client_annual_report_year_instances')
    .insert({
      organization_id: input.orgId,
      client_id: input.clientId,
      tax_year: input.taxYear,
      operational_target_date: input.date,
      status: 'open',
      created_by: input.actorId,
      updated_by: input.actorId,
    })
    .select('id')
    .single();
  assertQueryError(error, 'Failed to create annual report year instance');
  if (!data) throw new AppError(500, 'Annual report year instance missing after insert', 'SUPABASE_ERROR');
  return String((data as { id: string }).id);
}

/** Batch: open capital declaration instances for org + clientIds. */
export async function loadOpenCapitalDeclarationInstancesForClients(input: {
  organizationId: string;
  clientIds: string[];
}): Promise<Map<string, CapitalDeclarationInstanceRow>> {
  const out = new Map<string, CapitalDeclarationInstanceRow>();
  if (input.clientIds.length === 0) return out;
  let { data, error } = await supabaseAdmin
    .from('client_capital_declaration_instances')
    .select('id, client_id, tax_year, operational_target_date, status, label_he, sequence_no, opened_at, completed_at')
    .eq('organization_id', input.organizationId)
    .eq('status', 'open')
    .in('client_id', input.clientIds);
  let rows = data as Array<Record<string, unknown>> | null;
  if (error && isSupabaseMissingColumnError(error, 'sequence_no')) {
    const retry = await supabaseAdmin
      .from('client_capital_declaration_instances')
      .select('id, client_id, tax_year, operational_target_date, status, label_he, opened_at, completed_at')
      .eq('organization_id', input.organizationId)
      .eq('status', 'open')
      .in('client_id', input.clientIds);
    rows = retry.data as Array<Record<string, unknown>> | null;
    error = retry.error;
  }
  assertQueryError(error, 'Failed to load open capital declaration instances');
  for (const raw of rows ?? []) {
    const row = mapCapitalInstanceRow(raw as CapitalDeclarationInstanceRow);
    out.set(row.client_id, row);
  }
  return out;
}

export async function loadLatestDatedCompletedCapitalInstancesForClients(input: {
  organizationId: string;
  clientIds: string[];
}): Promise<Map<string, CapitalDeclarationInstanceRow>> {
  const out = new Map<string, CapitalDeclarationInstanceRow>();
  if (input.clientIds.length === 0) return out;
  let { data, error } = await supabaseAdmin
    .from('client_capital_declaration_instances')
    .select('id, client_id, tax_year, operational_target_date, status, label_he, sequence_no, opened_at, completed_at')
    .eq('organization_id', input.organizationId)
    .eq('status', 'completed')
    .in('client_id', input.clientIds)
    .order('completed_at', { ascending: false });
  let completedRows = data as Array<Record<string, unknown>> | null;
  if (error && isSupabaseMissingColumnError(error, 'sequence_no')) {
    const retry = await supabaseAdmin
      .from('client_capital_declaration_instances')
      .select('id, client_id, tax_year, operational_target_date, status, label_he, opened_at, completed_at')
      .eq('organization_id', input.organizationId)
      .eq('status', 'completed')
      .in('client_id', input.clientIds)
      .order('completed_at', { ascending: false });
    completedRows = retry.data as Array<Record<string, unknown>> | null;
    error = retry.error;
  }
  assertQueryError(error, 'Failed to load completed capital declaration instances');
  for (const raw of completedRows ?? []) {
    const row = mapCapitalInstanceRow(raw as CapitalDeclarationInstanceRow);
    if (out.has(row.client_id)) continue;
    out.set(row.client_id, row);
  }
  return out;
}

/** All open+completed capital instances for period projection (not latest-only). */
export async function loadCapitalDeclarationInstancesForClients(input: {
  organizationId: string;
  clientIds: string[];
}): Promise<Map<string, CapitalDeclarationInstanceRow[]>> {
  const out = new Map<string, CapitalDeclarationInstanceRow[]>();
  if (input.clientIds.length === 0) return out;
  let { data, error } = await supabaseAdmin
    .from('client_capital_declaration_instances')
    .select(
      'id, client_id, tax_year, operational_target_date, status, label_he, sequence_no, opened_at, completed_at',
    )
    .eq('organization_id', input.organizationId)
    .in('status', ['open', 'completed'])
    .in('client_id', input.clientIds)
    .order('opened_at', { ascending: true });
  let rows = data as Array<Record<string, unknown>> | null;
  if (error && isSupabaseMissingColumnError(error, 'sequence_no')) {
    const retry = await supabaseAdmin
      .from('client_capital_declaration_instances')
      .select(
        'id, client_id, tax_year, operational_target_date, status, label_he, opened_at, completed_at',
      )
      .eq('organization_id', input.organizationId)
      .in('status', ['open', 'completed'])
      .in('client_id', input.clientIds)
      .order('opened_at', { ascending: true });
    rows = retry.data as Array<Record<string, unknown>> | null;
    error = retry.error;
  }
  assertQueryError(error, 'Failed to load capital declaration instances');
  for (const raw of rows ?? []) {
    const row = mapCapitalInstanceRow(raw as CapitalDeclarationInstanceRow);
    const list = out.get(row.client_id) ?? [];
    list.push(row);
    out.set(row.client_id, list);
  }
  return out;
}

export async function loadAnnualSubmissionFactsForClients(input: {
  organizationId: string;
  clientIds: string[];
  tabScope: 'annual_report' | 'capital_declaration';
}): Promise<AnnualSubmissionFactRow[]> {
  if (!input.clientIds.length) return [];
  let { data, error } = await supabaseAdmin
    .from('client_annual_submission_rows')
    .select('id, client_id, tax_year, submitted_on, created_at, tab_scope, capital_declaration_instance_id')
    .eq('organization_id', input.organizationId)
    .eq('tab_scope', input.tabScope)
    .in('client_id', input.clientIds)
    .order('created_at', { ascending: true });
  let submissionRows = data as Array<Record<string, unknown>> | null;
  if (error && isSupabaseMissingColumnError(error, 'capital_declaration_instance_id')) {
    const retry = await supabaseAdmin
      .from('client_annual_submission_rows')
      .select('id, client_id, tax_year, submitted_on, created_at, tab_scope')
      .eq('organization_id', input.organizationId)
      .eq('tab_scope', input.tabScope)
      .in('client_id', input.clientIds)
      .order('created_at', { ascending: true });
    submissionRows = retry.data as Array<Record<string, unknown>> | null;
    error = retry.error;
  }
  assertQueryError(error, 'Failed to load annual submission facts');
  return ((submissionRows ?? []) as AnnualSubmissionFactRow[]).map((row) => ({
    id: String(row.id),
    client_id: String(row.client_id),
    tax_year: Number(row.tax_year),
    submitted_on: String(row.submitted_on).slice(0, 10),
    created_at: row.created_at ? String(row.created_at) : null,
    tab_scope: row.tab_scope ?? input.tabScope,
    capital_declaration_instance_id: row.capital_declaration_instance_id
      ? String(row.capital_declaration_instance_id)
      : null,
  }));
}

export async function loadAnnualSubmissionFilesForSubmissions(input: {
  organizationId: string;
  submissionIds: string[];
}): Promise<Map<string, AnnualCapitalLinkedFile[]>> {
  const out = new Map<string, AnnualCapitalLinkedFile[]>();
  if (!input.submissionIds.length) return out;
  const { data, error } = await supabaseAdmin
    .from('client_annual_submission_files')
    .select('submission_id, file_asset_id, source_kind')
    .eq('organization_id', input.organizationId)
    .in('submission_id', input.submissionIds);
  if (error && /client_annual_submission_files|does not exist|schema cache/i.test(error.message ?? '')) {
    return out;
  }
  assertQueryError(error, 'Failed to load annual submission files');
  const fileIds = [
    ...new Set(((data ?? []) as Array<{ file_asset_id: string }>).map((row) => String(row.file_asset_id))),
  ];
  const nameById = new Map<string, string | null>();
  if (fileIds.length) {
    const { data: assets, error: assetsError } = await supabaseAdmin
      .from('file_assets')
      .select('id, file_name')
      .eq('organization_id', input.organizationId)
      .in('id', fileIds);
    assertQueryError(assetsError, 'Failed to load submission file names');
    for (const asset of (assets ?? []) as Array<{ id: string; file_name: string | null }>) {
      nameById.set(String(asset.id), asset.file_name ?? null);
    }
  }
  for (const raw of data ?? []) {
    const row = raw as { submission_id: string; file_asset_id: string; source_kind: string };
    const submissionId = String(row.submission_id);
    const list = out.get(submissionId) ?? [];
    const fileAssetId = String(row.file_asset_id);
    if (list.some((file) => file.file_asset_id === fileAssetId)) continue;
    list.push(
      asLinkedFile({
        submission_id: submissionId,
        file_asset_id: fileAssetId,
        source_kind: parseSourceKind(row.source_kind),
        file_name: nameById.get(fileAssetId) ?? null,
      }),
    );
    out.set(submissionId, list);
  }
  return out;
}

export function projectAnnualReportCells(input: {
  clientIds: string[];
  taxYear: number;
  operationalPeriodKey: string;
  instancesByClientId: Map<string, AnnualYearInstanceRow[]>;
  canEdit: boolean;
  submissionsByClientId?: Map<string, AnnualSubmissionFactRow[]>;
  filesBySubmissionId?: Map<string, AnnualCapitalLinkedFile[]>;
  dateRevisionsByInstanceId?: Map<string, AnnualDateRevision[]>;
}): Map<string, AnnualReportOperationalDateCell> {
  const out = new Map<string, AnnualReportOperationalDateCell>();
  for (const clientId of input.clientIds) {
    const instances = input.instancesByClientId.get(clientId) ?? [];
    const submissions = input.submissionsByClientId?.get(clientId) ?? [];
    const revisions = instances.flatMap(
      (inst) => input.dateRevisionsByInstanceId?.get(inst.id) ?? [],
    );
    const filingConfirmedAtByTaxYear = new Map<number, string | null>();
    for (const row of submissions) {
      if (!filingConfirmedAtByTaxYear.has(row.tax_year)) {
        filingConfirmedAtByTaxYear.set(row.tax_year, row.created_at ?? null);
      }
    }
    const covering = selectCoveringAnnualInstanceForPeriod({
      operationalPeriodKey: input.operationalPeriodKey,
      tabTaxYear: input.taxYear,
      instances,
      revisionsByInstanceId: input.dateRevisionsByInstanceId,
      filingConfirmedAtByTaxYear,
    });
    const coveringSubmission = covering
      ? submissions.find((row) => row.tax_year === covering.tax_year) ?? null
      : submissions.find((row) => row.tax_year === input.taxYear) ?? null;
    out.set(
      clientId,
      projectAnnualReportCellForOperationalPeriod({
        operationalPeriodKey: input.operationalPeriodKey,
        tabTaxYear: input.taxYear,
        instances,
        revisions,
        submissions,
        filesForCoveringYear: coveringSubmission
          ? input.filesBySubmissionId?.get(coveringSubmission.id) ?? []
          : [],
        canEdit: input.canEdit,
      }),
    );
  }
  return out;
}

/** Tax-year submission facts for annual-report KPI (tab_scope annual_report). */
export async function loadAnnualReportSubmissionsForTaxYear(input: {
  organizationId: string;
  clientIds: string[];
  taxYear: number;
}): Promise<Set<string>> {
  const submitted = new Set<string>();
  if (!input.clientIds.length) return submitted;
  const { data, error } = await supabaseAdmin
    .from('client_annual_submission_rows')
    .select('client_id, tab_scope, submitted_on')
    .eq('organization_id', input.organizationId)
    .eq('tax_year', input.taxYear)
    .in('client_id', input.clientIds);
  assertQueryError(error, 'Failed to load annual report submissions');
  for (const raw of data ?? []) {
    const row = raw as { client_id: string; tab_scope?: string | null; submitted_on?: string | null };
    const scope = String(row.tab_scope ?? 'annual_report');
    if (scope && scope !== 'annual_report') continue;
    if (!row.submitted_on) continue;
    submitted.add(String(row.client_id));
  }
  return submitted;
}

export type CapitalDeclarationKpiInstance = {
  client_id: string;
  status: string;
  operational_target_date: string | null;
};

/** Dated capital-declaration instances for KPI (open current work + completed with a filing date). */
export async function loadCapitalDeclarationKpiInstances(input: {
  organizationId: string;
  clientIds: string[];
}): Promise<CapitalDeclarationKpiInstance[]> {
  if (!input.clientIds.length) return [];
  const { data, error } = await supabaseAdmin
    .from('client_capital_declaration_instances')
    .select('client_id, status, operational_target_date')
    .eq('organization_id', input.organizationId)
    .in('client_id', input.clientIds)
    .in('status', ['open', 'completed']);
  assertQueryError(error, 'Failed to load capital declaration KPI instances');
  return ((data ?? []) as CapitalDeclarationKpiInstance[]).map((row) => ({
    client_id: String(row.client_id),
    status: String(row.status),
    operational_target_date: row.operational_target_date
      ? String(row.operational_target_date).slice(0, 10)
      : null,
  }));
}

export function projectCapitalDeclarationCells(input: {
  clientIds: string[];
  operationalPeriodKey: string;
  instancesByClientId: Map<string, CapitalDeclarationInstanceRow[]>;
  canEdit: boolean;
  submittedOnByInstanceId?: Map<string, string>;
  filingConfirmedAtByInstanceId?: Map<string, string>;
  filesByInstanceId?: Map<string, AnnualCapitalLinkedFile[]>;
}): Map<string, CapitalDeclarationOperationalDateCell> {
  const out = new Map<string, CapitalDeclarationOperationalDateCell>();
  for (const clientId of input.clientIds) {
    const instances = input.instancesByClientId.get(clientId) ?? [];
    const open = instances.find((row) => row.status === 'open') ?? null;
    const cycles = buildCapitalPeriodCycles(
      instances.map((row) => ({
        id: row.id,
        operational_target_date: row.operational_target_date,
        status: row.status,
        opened_at: row.opened_at,
        completed_at: row.completed_at,
        filing_confirmed_at: input.filingConfirmedAtByInstanceId?.get(row.id) ?? null,
      })),
    );
    const projection = projectAnnualCapitalCycleOntoPeriod({
      operationalPeriodKey: input.operationalPeriodKey,
      cycles,
    });
    const covering = instances.find((row) => row.id === projection.instance_id) ?? open;
    const visibleId = covering?.id ?? null;
    const base = buildCapitalDeclarationCell({
      openInstance:
        covering?.status === 'open'
          ? {
              id: covering.id,
              tax_year: covering.tax_year,
              operational_target_date: covering.operational_target_date,
              sequence_no: covering.sequence_no,
            }
          : null,
      datedCompletedInstance:
        covering?.status === 'completed'
          ? {
              id: covering.id,
              tax_year: covering.tax_year,
              operational_target_date: covering.operational_target_date,
              sequence_no: covering.sequence_no,
            }
          : null,
      canEdit: input.canEdit,
      submittedOn: visibleId ? input.submittedOnByInstanceId?.get(visibleId) ?? null : null,
      files: visibleId ? input.filesByInstanceId?.get(visibleId) ?? [] : [],
    });
    out.set(clientId, applyCapitalPeriodProjection(base, projection, input.canEdit));
  }
  return out;
}

export async function setAnnualReportOperationalTargetDate(input: {
  ctx: RequestContext;
  clientId: string;
  operationalPeriodKey: string;
  operationalTargetDate: unknown;
}): Promise<{ instance_id: string; tax_year: number; operational_target_date: string | null }> {
  const orgId = assertOrg(input.ctx);
  assertEdit(input.ctx);
  if (!isOperationalPeriodKey(input.operationalPeriodKey)) {
    throw badRequest('operational_period_key must be YYYY-MM');
  }
  await ensureActiveClientInOrg(orgId, input.clientId);
  const tabTaxYear = resolveAnnualReportTaxYearForOperationalPeriod(input.operationalPeriodKey);
  const instancesByClient = await loadAnnualReportYearInstancesForClients({
    organizationId: orgId,
    clientIds: [input.clientId],
    taxYear: tabTaxYear,
  });
  const covering = selectCoveringAnnualInstanceForPeriod({
    operationalPeriodKey: input.operationalPeriodKey,
    tabTaxYear,
    instances: instancesByClient.get(input.clientId) ?? [],
  });
  const taxYear = resolveAnnualDateCommandTaxYear({
    tabTaxYear,
    coveringOpenInstance:
      covering && String(covering.status ?? '') === 'open' ? covering : null,
  });
  const date = dateOrNull(input.operationalTargetDate);
  const nowIso = new Date().toISOString();
  const actorId = input.ctx.user.id;

  const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(ANNUAL_DATE_SET_RPC, {
    p_organization_id: orgId,
    p_client_id: input.clientId,
    p_tax_year: taxYear,
    p_operational_period_key: input.operationalPeriodKey,
    p_operational_target_date: date,
    p_actor_id: actorId,
    p_recorded_at: nowIso,
  });
  const rpcUnavailable = isSupabaseMissingRpcError(rpcError, ANNUAL_DATE_SET_RPC);
  if (rpcError && !rpcUnavailable) {
    throw new AppError(500, rpcError.message || 'Failed to set annual report operational date', 'SUPABASE_ERROR');
  }

  const instanceId = rpcUnavailable
    ? await upsertAnnualYearInstanceDate({
        orgId,
        clientId: input.clientId,
        taxYear,
        date,
        actorId,
        nowIso,
      })
    : String(rpcData ?? '');
  if (!instanceId) {
    throw new AppError(500, 'Annual report year instance missing after date set', 'SUPABASE_ERROR');
  }

  await writeAnnualDateSetAudit({
    ctx: input.ctx,
    instanceId,
    clientId: input.clientId,
    operationalPeriodKey: input.operationalPeriodKey,
    taxYear,
    operationalTargetDate: date,
  });

  return { instance_id: instanceId, tax_year: taxYear, operational_target_date: date };
}

export async function openCapitalDeclarationInstance(input: {
  ctx: RequestContext;
  clientId: string;
  taxYear?: unknown;
  labelHe?: unknown;
}): Promise<{ instance_id: string; created: boolean }> {
  const orgId = assertOrg(input.ctx);
  assertEdit(input.ctx);
  await ensureActiveClientInOrg(orgId, input.clientId);

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('client_capital_declaration_instances')
    .select('id')
    .eq('organization_id', orgId)
    .eq('client_id', input.clientId)
    .eq('status', 'open')
    .maybeSingle();
  assertQueryError(existingError, 'Failed to load open capital declaration');
  if (existing?.id) {
    return { instance_id: String(existing.id), created: false };
  }

  let taxYear: number | null = null;
  if (input.taxYear !== undefined && input.taxYear !== null && input.taxYear !== '') {
    const ty = Number(input.taxYear);
    if (!Number.isInteger(ty) || ty < 1990 || ty > 2200) throw badRequest('tax_year invalid');
    taxYear = ty;
  }
  const labelHe =
    input.labelHe == null || input.labelHe === ''
      ? null
      : String(input.labelHe).trim().slice(0, 120) || null;

  const actorId = input.ctx.user.id;
  const nowIso = new Date().toISOString();
  const { data: existingSeq, error: seqError } = await supabaseAdmin
    .from('client_capital_declaration_instances')
    .select('sequence_no')
    .eq('organization_id', orgId)
    .eq('client_id', input.clientId);
  const sequenceReady = !(seqError && isSupabaseMissingColumnError(seqError, 'sequence_no'));
  if (sequenceReady) assertQueryError(seqError, 'Failed to load capital declaration sequence');
  const sequenceNo = nextCapitalDeclarationSequenceNo(
    ((existingSeq ?? []) as Array<{ sequence_no?: number | null }>).map((row) => Number(row.sequence_no ?? 0)),
  );
  const insertRow: Record<string, unknown> = {
    organization_id: orgId,
    client_id: input.clientId,
    tax_year: taxYear,
    label_he: labelHe,
    status: 'open',
    operational_target_date: null,
    opened_at: nowIso,
    created_by: actorId,
    updated_by: actorId,
  };
  if (sequenceReady) insertRow.sequence_no = sequenceNo;
  const { data, error } = await supabaseAdmin
    .from('client_capital_declaration_instances')
    .insert(insertRow)
    .select('id')
    .single();

  if (error) {
    const { data: raced, error: racedError } = await supabaseAdmin
      .from('client_capital_declaration_instances')
      .select('id')
      .eq('organization_id', orgId)
      .eq('client_id', input.clientId)
      .eq('status', 'open')
      .maybeSingle();
    assertQueryError(racedError, 'Failed to reload open capital declaration after conflict');
    if (raced?.id) return { instance_id: String(raced.id), created: false };
    throw new AppError(500, error.message || 'Failed to open capital declaration', 'SUPABASE_ERROR');
  }
  if (!data) throw new AppError(500, 'Capital declaration instance missing after insert', 'SUPABASE_ERROR');

  const instanceId = String((data as { id: string }).id);
  await audit(input.ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_CAPITAL_DECLARATION_INSTANCE_OPENED, instanceId, {
    client_id: input.clientId,
    tax_year: taxYear,
    label_he: labelHe,
  });
  return { instance_id: instanceId, created: true };
}

export async function setCapitalDeclarationOperationalTargetDate(input: {
  ctx: RequestContext;
  clientId: string;
  operationalPeriodKey: string;
  operationalTargetDate: unknown;
}): Promise<{ instance_id: string; operational_target_date: string | null }> {
  const orgId = assertOrg(input.ctx);
  assertEdit(input.ctx);
  if (!isOperationalPeriodKey(input.operationalPeriodKey)) {
    throw badRequest('operational_period_key must be YYYY-MM');
  }
  await ensureActiveClientInOrg(orgId, input.clientId);
  const date = dateOrNull(input.operationalTargetDate);

  const { data: open, error: openError } = await supabaseAdmin
    .from('client_capital_declaration_instances')
    .select('id')
    .eq('organization_id', orgId)
    .eq('client_id', input.clientId)
    .eq('status', 'open')
    .maybeSingle();
  assertQueryError(openError, 'Failed to load open capital declaration');
  let instanceId: string;
  if (open?.id) {
    instanceId = String(open.id);
  } else if (date == null) {
    return { instance_id: '', operational_target_date: null };
  } else {
    const opened = await openCapitalDeclarationInstance({
      ctx: input.ctx,
      clientId: input.clientId,
    });
    instanceId = opened.instance_id;
  }
  const { error } = await supabaseAdmin
    .from('client_capital_declaration_instances')
    .update({
      operational_target_date: date,
      updated_at: new Date().toISOString(),
      updated_by: input.ctx.user.id,
    })
    .eq('organization_id', orgId)
    .eq('id', instanceId)
    .eq('status', 'open');
  assertQueryError(error, 'Failed to set capital declaration operational target date');

  await audit(
    input.ctx,
    AUDIT_ACTIONS.CLIENT_OPERATIONS_CAPITAL_DECLARATION_OPERATIONAL_TARGET_DATE_SET,
    instanceId,
    {
      client_id: input.clientId,
      operational_period_key: input.operationalPeriodKey,
      operational_target_date: date,
    },
  );
  return { instance_id: instanceId, operational_target_date: date };
}

export async function completeCapitalDeclarationInstance(input: {
  ctx: RequestContext;
  clientId: string;
}): Promise<{ instance_id: string }> {
  const orgId = assertOrg(input.ctx);
  assertEdit(input.ctx);
  await ensureActiveClientInOrg(orgId, input.clientId);

  const { data: open, error: openError } = await supabaseAdmin
    .from('client_capital_declaration_instances')
    .select('id')
    .eq('organization_id', orgId)
    .eq('client_id', input.clientId)
    .eq('status', 'open')
    .maybeSingle();
  assertQueryError(openError, 'Failed to load open capital declaration');
  if (!open?.id) throw badRequest('No open capital declaration instance for this client');

  const instanceId = String(open.id);
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('client_capital_declaration_instances')
    .update({
      status: 'completed',
      completed_at: nowIso,
      updated_at: nowIso,
      updated_by: input.ctx.user.id,
    })
    .eq('organization_id', orgId)
    .eq('id', instanceId)
    .eq('status', 'open');
  assertQueryError(error, 'Failed to complete capital declaration instance');

  await audit(input.ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_CAPITAL_DECLARATION_INSTANCE_COMPLETED, instanceId, {
    client_id: input.clientId,
  });
  return { instance_id: instanceId };
}

type IncomingFilingFile = {
  kind: AnnualCapitalSubmissionFileKind;
  file_base64?: string;
  file_name?: string;
  mime_type?: string | null;
  file_asset_id?: string;
};

function parseIncomingFilingFiles(value: unknown): IncomingFilingFile[] {
  if (!Array.isArray(value)) return [];
  const out: IncomingFilingFile[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const kind = parseSourceKind(row.kind ?? row.source_kind);
    const fileAssetId = typeof row.file_asset_id === 'string' ? row.file_asset_id.trim() : '';
    if (fileAssetId) {
      out.push({ kind, file_asset_id: fileAssetId });
      continue;
    }
    const fileName = typeof row.file_name === 'string' ? row.file_name.trim() : '';
    const b64 = typeof row.file_base64 === 'string' ? row.file_base64 : '';
    if (!fileName || !b64) continue;
    out.push({
      kind,
      file_name: fileName,
      file_base64: b64,
      mime_type: typeof row.mime_type === 'string' ? row.mime_type : null,
    });
  }
  return out;
}

async function uploadIncomingFilingFiles(input: {
  ctx: RequestContext;
  orgId: string;
  clientId: string;
  tabScope: 'annual_report' | 'capital_declaration';
  files: IncomingFilingFile[];
}): Promise<Array<{ file_asset_id: string; source_kind: AnnualCapitalSubmissionFileKind }>> {
  const uploaded = await Promise.all(
    input.files.map(async (file) => {
      if (file.file_asset_id) {
        return {
          file_asset_id: file.file_asset_id,
          source_kind: (file.kind === 'checklist' ? 'additional' : file.kind) as AnnualCapitalSubmissionFileKind,
        };
      }
      if (!file.file_base64 || !file.file_name) return null;
      const saved = await uploadAnnualReportDocument(input.ctx, input.orgId, input.clientId, {
        file_base64: file.file_base64,
        file_name: file.file_name,
        mime_type: file.mime_type,
        tab_scope: input.tabScope,
      });
      return {
        file_asset_id: saved.file_asset_id,
        source_kind: (file.kind === 'checklist' ? 'additional' : file.kind) as AnnualCapitalSubmissionFileKind,
      };
    }),
  );
  return uploaded.filter((row): row is { file_asset_id: string; source_kind: AnnualCapitalSubmissionFileKind } =>
    Boolean(row),
  );
}

async function loadChecklistFileLinks(input: {
  orgId: string;
  clientId: string;
  tabScope: 'annual_report' | 'capital_declaration';
  taxYear?: number;
}): Promise<Array<{ file_asset_id: string; source_kind: 'checklist' }>> {
  const yearColumnSupported = await supportsAnnualDocumentTaxYearColumns();
  const { data, error } = yearColumnSupported
    ? await supabaseAdmin
        .from('client_annual_document_rows')
        .select('file_asset_id, tax_year')
        .eq('organization_id', input.orgId)
        .eq('client_id', input.clientId)
        .eq('tab_scope', input.tabScope)
        .not('file_asset_id', 'is', null)
    : await supabaseAdmin
        .from('client_annual_document_rows')
        .select('file_asset_id')
        .eq('organization_id', input.orgId)
        .eq('client_id', input.clientId)
        .eq('tab_scope', input.tabScope)
        .not('file_asset_id', 'is', null);
  assertQueryError(error, 'Failed to load checklist files');
  const ids = checklistFileIdsForFilingYear(
    (data ?? []) as Array<{ tax_year?: number | null; file_asset_id: string | null }>,
    {
      yearColumnSupported,
      taxYear: Number.isInteger(input.taxYear) ? Number(input.taxYear) : 0,
      tabScope: input.tabScope,
    },
  );
  return ids.map((file_asset_id) => ({ file_asset_id, source_kind: 'checklist' as const }));
}

async function upsertSubmissionFileLinks(input: {
  orgId: string;
  clientId: string;
  submissionId: string;
  actorUserId: string;
  files: Array<{ file_asset_id: string; source_kind: AnnualCapitalSubmissionFileKind }>;
}): Promise<void> {
  await Promise.all(
    input.files.map(async (file) => {
      const { error } = await supabaseAdmin.from('client_annual_submission_files').upsert(
        {
          organization_id: input.orgId,
          client_id: input.clientId,
          submission_id: input.submissionId,
          file_asset_id: file.file_asset_id,
          source_kind: file.source_kind,
          created_by: input.actorUserId,
        },
        { onConflict: 'submission_id,file_asset_id', ignoreDuplicates: true },
      );
      if (error && /client_annual_submission_files|does not exist|schema cache/i.test(error.message ?? '')) {
        throw badRequest('Annual/capital filing file links require migration 216', 'ANNUAL_CAPITAL_FILING_MIGRATION_PENDING');
      }
      assertQueryError(error, 'Failed to link submission file');
    }),
  );
}

async function findAnnualSubmissionForTaxYear(input: {
  orgId: string;
  clientId: string;
  taxYear: number;
}): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('client_annual_submission_rows')
    .select('id')
    .eq('organization_id', input.orgId)
    .eq('client_id', input.clientId)
    .eq('tab_scope', 'annual_report')
    .eq('tax_year', input.taxYear)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  assertQueryError(error, 'Failed to load annual submission for tax year');
  return data?.id ? { id: String(data.id) } : null;
}

async function findCapitalSubmissionForInstance(input: {
  orgId: string;
  clientId: string;
  instanceId: string;
}): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('client_annual_submission_rows')
    .select('id')
    .eq('organization_id', input.orgId)
    .eq('client_id', input.clientId)
    .eq('tab_scope', 'capital_declaration')
    .eq('capital_declaration_instance_id', input.instanceId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error && /capital_declaration_instance_id/i.test(error.message ?? '')) {
    return null;
  }
  assertQueryError(error, 'Failed to load capital submission for instance');
  return data?.id ? { id: String(data.id) } : null;
}

export async function fileClientOperationsAnnualReport(input: {
  ctx: RequestContext;
  clientId: string;
  operationalPeriodKey: string;
  taxYear: unknown;
  submittedOn: unknown;
  confirmOtherTaxYear?: unknown;
  files?: unknown;
}): Promise<{ submission_id: string; tax_year: number; submitted_on: string; created: boolean }> {
  const orgId = assertOrg(input.ctx);
  assertEdit(input.ctx);
  if (!isOperationalPeriodKey(input.operationalPeriodKey)) {
    throw badRequest('operational_period_key must be YYYY-MM');
  }
  await ensureActiveClientInOrg(orgId, input.clientId);
  const taxYear = Number(input.taxYear);
  if (!Number.isInteger(taxYear) || taxYear < 1990 || taxYear > 2200) {
    throw badRequest('tax_year invalid');
  }
  const tabTaxYear = resolveAnnualReportTaxYearForOperationalPeriod(input.operationalPeriodKey);
  const confirmOther = input.confirmOtherTaxYear === true || input.confirmOtherTaxYear === 'true';
  const yearGuard = annualFilingUsesTabTaxYear({
    taxYear,
    tabTaxYear,
    confirmOtherTaxYear: confirmOther,
  });
  if (!yearGuard.ok) {
    throw badRequest('Confirm filing a tax year that is not this tab year', yearGuard.code);
  }
  const submittedOn = requiredIsoDate(input.submittedOn, 'submitted_on');
  const [incoming, checklist, existing] = await Promise.all([
    uploadIncomingFilingFiles({
      ctx: input.ctx,
      orgId,
      clientId: input.clientId,
      tabScope: 'annual_report',
      files: parseIncomingFilingFiles(input.files),
    }),
    loadChecklistFileLinks({
      orgId,
      clientId: input.clientId,
      tabScope: 'annual_report',
      taxYear,
    }),
    findAnnualSubmissionForTaxYear({ orgId, clientId: input.clientId, taxYear }),
  ]);
  let submissionId: string;
  let created = false;
  if (existing) {
    submissionId = existing.id;
    const { error } = await supabaseAdmin
      .from('client_annual_submission_rows')
      .update({
        submitted_on: submittedOn,
        status: 'submitted',
      })
      .eq('organization_id', orgId)
      .eq('client_id', input.clientId)
      .eq('id', submissionId);
    assertQueryError(error, 'Failed to update annual submission');
  } else {
    const { data, error } = await supabaseAdmin
      .from('client_annual_submission_rows')
      .insert({
        organization_id: orgId,
        client_id: input.clientId,
        tab_scope: 'annual_report',
        tax_year: taxYear,
        submitted_on: submittedOn,
        status: 'submitted',
        sort_order: 0,
      })
      .select('id')
      .single();
    assertQueryError(error, 'Failed to create annual submission');
    if (!data) throw new AppError(500, 'Annual submission missing after insert', 'SUPABASE_ERROR');
    submissionId = String((data as { id: string }).id);
    created = true;
  }
  await upsertSubmissionFileLinks({
    orgId,
    clientId: input.clientId,
    submissionId,
    actorUserId: input.ctx.user.id,
    files: [...checklist, ...incoming],
  });
  if (incoming[0]?.file_asset_id) {
    await supabaseAdmin
      .from('client_annual_submission_rows')
      .update({ file_asset_id: incoming[0].file_asset_id })
      .eq('id', submissionId)
      .eq('organization_id', orgId);
  }
  await supabaseAdmin
    .from('client_annual_report_year_instances')
    .update({
      status: 'completed',
      updated_at: new Date().toISOString(),
      updated_by: input.ctx.user.id,
    })
    .eq('organization_id', orgId)
    .eq('client_id', input.clientId)
    .eq('tax_year', taxYear);
  await audit(input.ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_ANNUAL_REPORT_FILED, submissionId, {
    client_id: input.clientId,
    tax_year: taxYear,
    tab_tax_year: tabTaxYear,
    operational_period_key: input.operationalPeriodKey,
    submitted_on: submittedOn,
    created,
  });
  return { submission_id: submissionId, tax_year: taxYear, submitted_on: submittedOn, created };
}

export async function fileClientOperationsCapitalDeclaration(input: {
  ctx: RequestContext;
  clientId: string;
  operationalPeriodKey?: string;
  instanceId?: unknown;
  submittedOn: unknown;
  files?: unknown;
}): Promise<{ instance_id: string; submission_id: string; submitted_on: string }> {
  const orgId = assertOrg(input.ctx);
  assertEdit(input.ctx);
  await ensureActiveClientInOrg(orgId, input.clientId);
  const submittedOn = requiredIsoDate(input.submittedOn, 'submitted_on');
  const requestedId = typeof input.instanceId === 'string' ? input.instanceId.trim() : '';

  const { data: open, error: openError } = await supabaseAdmin
    .from('client_capital_declaration_instances')
    .select('id, status, operational_target_date, sequence_no')
    .eq('organization_id', orgId)
    .eq('client_id', input.clientId)
    .eq('status', 'open')
    .maybeSingle();
  assertQueryError(openError, 'Failed to load open capital declaration');

  let instanceId: string;
  if (open?.id) {
    instanceId = String(open.id);
    if (requestedId && requestedId !== instanceId) {
      throw badRequest('Capital filing must target the open requirement', 'CAPITAL_FILING_INSTANCE_MISMATCH');
    }
    await completeCapitalDeclarationInstance({ ctx: input.ctx, clientId: input.clientId });
  } else if (requestedId) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('client_capital_declaration_instances')
      .select('id, status')
      .eq('organization_id', orgId)
      .eq('client_id', input.clientId)
      .eq('id', requestedId)
      .maybeSingle();
    assertQueryError(existingError, 'Failed to load capital declaration instance');
    if (!existing?.id) throw badRequest('Capital declaration instance not found');
    instanceId = String(existing.id);
  } else {
    const opened = await openCapitalDeclarationInstance({
      ctx: input.ctx,
      clientId: input.clientId,
    });
    instanceId = opened.instance_id;
    await completeCapitalDeclarationInstance({ ctx: input.ctx, clientId: input.clientId });
  }

  const [incoming, checklist, existingSubmission] = await Promise.all([
    uploadIncomingFilingFiles({
      ctx: input.ctx,
      orgId,
      clientId: input.clientId,
      tabScope: 'capital_declaration',
      files: parseIncomingFilingFiles(input.files),
    }),
    loadChecklistFileLinks({
      orgId,
      clientId: input.clientId,
      tabScope: 'capital_declaration',
    }),
    findCapitalSubmissionForInstance({
      orgId,
      clientId: input.clientId,
      instanceId,
    }),
  ]);
  let submissionId: string;
  if (existingSubmission) {
    submissionId = existingSubmission.id;
    const { error } = await supabaseAdmin
      .from('client_annual_submission_rows')
      .update({
        submitted_on: submittedOn,
        status: 'submitted',
        capital_declaration_instance_id: instanceId,
      })
      .eq('organization_id', orgId)
      .eq('id', submissionId);
    assertQueryError(error, 'Failed to update capital submission');
  } else {
    const { data, error } = await supabaseAdmin
      .from('client_annual_submission_rows')
      .insert({
        organization_id: orgId,
        client_id: input.clientId,
        tab_scope: 'capital_declaration',
        tax_year: new Date(`${submittedOn}T12:00:00.000Z`).getUTCFullYear(),
        submitted_on: submittedOn,
        status: 'submitted',
        capital_declaration_instance_id: instanceId,
        sort_order: 0,
      })
      .select('id')
      .single();
    if (error && /capital_declaration_instance_id/i.test(error.message ?? '')) {
      throw badRequest('Annual/capital filing file links require migration 216', 'ANNUAL_CAPITAL_FILING_MIGRATION_PENDING');
    }
    assertQueryError(error, 'Failed to create capital submission');
    if (!data) throw new AppError(500, 'Capital submission missing after insert', 'SUPABASE_ERROR');
    submissionId = String((data as { id: string }).id);
  }
  await upsertSubmissionFileLinks({
    orgId,
    clientId: input.clientId,
    submissionId,
    actorUserId: input.ctx.user.id,
    files: [...checklist, ...incoming],
  });
  const { error: resetWorkingError } = await supabaseAdmin
    .from('client_annual_document_rows')
    .update({ received: false, file_asset_id: null })
    .eq('organization_id', orgId)
    .eq('client_id', input.clientId)
    .eq('tab_scope', 'capital_declaration');
  assertQueryError(resetWorkingError, 'Failed to reset working capital checklist after filing');
  if (incoming[0]?.file_asset_id) {
    await supabaseAdmin
      .from('client_annual_submission_rows')
      .update({ file_asset_id: incoming[0].file_asset_id })
      .eq('id', submissionId)
      .eq('organization_id', orgId);
  }
  await audit(input.ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_CAPITAL_DECLARATION_FILED, instanceId, {
    client_id: input.clientId,
    submission_id: submissionId,
    submitted_on: submittedOn,
    operational_period_key: input.operationalPeriodKey ?? null,
  });
  return { instance_id: instanceId, submission_id: submissionId, submitted_on: submittedOn };
}
