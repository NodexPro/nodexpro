/**
 * Client Operations — annual report / capital declaration operational target dates.
 * Batch loaders + named commands. Caller returns refreshed registry aggregate.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import { isSupabaseMissingColumnError } from '../../shared/supabase-errors.js';
import { isOperationalPeriodKey } from './client-operations-operational-period.pure.js';
import {
  checklistFileIdsForFilingYear,
  supportsAnnualDocumentTaxYearColumns,
  uploadAnnualReportDocument,
} from './client-annual-report-tab.service.js';
import {
  annualFilingUsesTabTaxYear,
  buildAnnualReportCell,
  buildCapitalDeclarationCell,
  isCanonicalIsoDate,
  linkedFileKindLabelKey,
  nextCapitalDeclarationSequenceNo,
  resolveAnnualReportTaxYearForOperationalPeriod,
  type AnnualCapitalLinkedFile,
  type AnnualCapitalSubmissionFileKind,
  type AnnualReportOperationalDateCell,
  type CapitalDeclarationOperationalDateCell,
} from './client-operations-annual-capital-operational.pure.js';

export type AnnualYearInstanceRow = {
  id: string;
  client_id: string;
  tax_year: number;
  operational_target_date: string | null;
  status: string;
};

export type CapitalDeclarationInstanceRow = {
  id: string;
  client_id: string;
  tax_year: number | null;
  operational_target_date: string | null;
  status: string;
  label_he: string | null;
  sequence_no: number;
};

export type AnnualSubmissionFactRow = {
  id: string;
  client_id: string;
  tax_year: number;
  submitted_on: string;
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

/** Batch: annual year instances for org + clientIds + tax_year. */
export async function loadAnnualReportYearInstancesForClients(input: {
  organizationId: string;
  clientIds: string[];
  taxYear: number;
}): Promise<Map<string, AnnualYearInstanceRow>> {
  const out = new Map<string, AnnualYearInstanceRow>();
  if (input.clientIds.length === 0) return out;
  const { data, error } = await supabaseAdmin
    .from('client_annual_report_year_instances')
    .select('id, client_id, tax_year, operational_target_date, status')
    .eq('organization_id', input.organizationId)
    .eq('tax_year', input.taxYear)
    .in('client_id', input.clientIds);
  assertQueryError(error, 'Failed to load annual report year instances');
  for (const raw of data ?? []) {
    const row = raw as AnnualYearInstanceRow;
    out.set(String(row.client_id), {
      id: String(row.id),
      client_id: String(row.client_id),
      tax_year: Number(row.tax_year),
      operational_target_date: row.operational_target_date
        ? String(row.operational_target_date).slice(0, 10)
        : null,
      status: String(row.status),
    });
  }
  return out;
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
    .select('id, client_id, tax_year, operational_target_date, status, label_he, sequence_no')
    .eq('organization_id', input.organizationId)
    .eq('status', 'open')
    .in('client_id', input.clientIds);
  let rows = data as Array<Record<string, unknown>> | null;
  if (error && isSupabaseMissingColumnError(error, 'sequence_no')) {
    const retry = await supabaseAdmin
      .from('client_capital_declaration_instances')
      .select('id, client_id, tax_year, operational_target_date, status, label_he')
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
    .select('id, client_id, tax_year, operational_target_date, status, label_he, sequence_no, completed_at')
    .eq('organization_id', input.organizationId)
    .eq('status', 'completed')
    .not('operational_target_date', 'is', null)
    .in('client_id', input.clientIds)
    .order('completed_at', { ascending: false });
  let completedRows = data as Array<Record<string, unknown>> | null;
  if (error && isSupabaseMissingColumnError(error, 'sequence_no')) {
    const retry = await supabaseAdmin
      .from('client_capital_declaration_instances')
      .select('id, client_id, tax_year, operational_target_date, status, label_he, completed_at')
      .eq('organization_id', input.organizationId)
      .eq('status', 'completed')
      .not('operational_target_date', 'is', null)
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

export async function loadAnnualSubmissionFactsForClients(input: {
  organizationId: string;
  clientIds: string[];
  tabScope: 'annual_report' | 'capital_declaration';
}): Promise<AnnualSubmissionFactRow[]> {
  if (!input.clientIds.length) return [];
  let { data, error } = await supabaseAdmin
    .from('client_annual_submission_rows')
    .select('id, client_id, tax_year, submitted_on, tab_scope, capital_declaration_instance_id')
    .eq('organization_id', input.organizationId)
    .eq('tab_scope', input.tabScope)
    .in('client_id', input.clientIds)
    .order('created_at', { ascending: true });
  let submissionRows = data as Array<Record<string, unknown>> | null;
  if (error && isSupabaseMissingColumnError(error, 'capital_declaration_instance_id')) {
    const retry = await supabaseAdmin
      .from('client_annual_submission_rows')
      .select('id, client_id, tax_year, submitted_on, tab_scope')
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
  instancesByClientId: Map<string, AnnualYearInstanceRow>;
  canEdit: boolean;
  submissionsByClientId?: Map<string, AnnualSubmissionFactRow[]>;
  filesBySubmissionId?: Map<string, AnnualCapitalLinkedFile[]>;
}): Map<string, AnnualReportOperationalDateCell> {
  const out = new Map<string, AnnualReportOperationalDateCell>();
  for (const clientId of input.clientIds) {
    const inst = input.instancesByClientId.get(clientId) ?? null;
    const submissions = input.submissionsByClientId?.get(clientId) ?? [];
    const tabSubmission = submissions.find((row) => row.tax_year === input.taxYear) ?? null;
    out.set(
      clientId,
      buildAnnualReportCell({
        taxYear: input.taxYear,
        instanceId: inst?.id ?? null,
        operationalTargetDate: inst?.operational_target_date ?? null,
        canEdit: input.canEdit,
        submissions: submissions.map((row) => ({
          tax_year: row.tax_year,
          submitted_on: row.submitted_on,
        })),
        filesForTabYear: tabSubmission
          ? input.filesBySubmissionId?.get(tabSubmission.id) ?? []
          : [],
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
  openByClientId: Map<string, CapitalDeclarationInstanceRow>;
  completedByClientId?: Map<string, CapitalDeclarationInstanceRow>;
  canEdit: boolean;
  submittedOnByInstanceId?: Map<string, string>;
  filesByInstanceId?: Map<string, AnnualCapitalLinkedFile[]>;
}): Map<string, CapitalDeclarationOperationalDateCell> {
  const out = new Map<string, CapitalDeclarationOperationalDateCell>();
  for (const clientId of input.clientIds) {
    const open = input.openByClientId.get(clientId) ?? null;
    const completed = input.completedByClientId?.get(clientId) ?? null;
    const visibleId = open?.id ?? completed?.id ?? null;
    out.set(
      clientId,
      buildCapitalDeclarationCell({
        openInstance: open
          ? {
              id: open.id,
              tax_year: open.tax_year,
              operational_target_date: open.operational_target_date,
              sequence_no: open.sequence_no,
            }
          : null,
        datedCompletedInstance: completed
          ? {
              id: completed.id,
              tax_year: completed.tax_year,
              operational_target_date: completed.operational_target_date,
              sequence_no: completed.sequence_no,
            }
          : null,
        canEdit: input.canEdit,
        submittedOn: visibleId ? input.submittedOnByInstanceId?.get(visibleId) ?? null : null,
        files: visibleId ? input.filesByInstanceId?.get(visibleId) ?? [] : [],
      }),
    );
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
  const taxYear = resolveAnnualReportTaxYearForOperationalPeriod(input.operationalPeriodKey);
  const date = dateOrNull(input.operationalTargetDate);
  const nowIso = new Date().toISOString();
  const actorId = input.ctx.user.id;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('client_annual_report_year_instances')
    .select('id')
    .eq('organization_id', orgId)
    .eq('client_id', input.clientId)
    .eq('tax_year', taxYear)
    .maybeSingle();
  assertQueryError(existingError, 'Failed to load annual report year instance');

  let instanceId: string;
  if (existing?.id) {
    instanceId = String(existing.id);
    const { error } = await supabaseAdmin
      .from('client_annual_report_year_instances')
      .update({
        operational_target_date: date,
        updated_at: nowIso,
        updated_by: actorId,
      })
      .eq('organization_id', orgId)
      .eq('id', instanceId);
    assertQueryError(error, 'Failed to update annual report year instance');
  } else {
    const { data, error } = await supabaseAdmin
      .from('client_annual_report_year_instances')
      .insert({
        organization_id: orgId,
        client_id: input.clientId,
        tax_year: taxYear,
        operational_target_date: date,
        status: 'open',
        created_by: actorId,
        updated_by: actorId,
      })
      .select('id')
      .single();
    assertQueryError(error, 'Failed to create annual report year instance');
    if (!data) throw new AppError(500, 'Annual report year instance missing after insert', 'SUPABASE_ERROR');
    instanceId = String((data as { id: string }).id);
  }

  await audit(input.ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_ANNUAL_REPORT_OPERATIONAL_TARGET_DATE_SET, instanceId, {
    client_id: input.clientId,
    operational_period_key: input.operationalPeriodKey,
    tax_year: taxYear,
    operational_target_date: date,
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
  if (!open?.id) throw badRequest('No open capital declaration instance for this client');

  const instanceId = String(open.id);
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
  const out: Array<{ file_asset_id: string; source_kind: AnnualCapitalSubmissionFileKind }> = [];
  for (const file of input.files) {
    if (file.file_asset_id) {
      out.push({ file_asset_id: file.file_asset_id, source_kind: file.kind === 'checklist' ? 'additional' : file.kind });
      continue;
    }
    if (!file.file_base64 || !file.file_name) continue;
    const uploaded = await uploadAnnualReportDocument(input.ctx, input.orgId, input.clientId, {
      file_base64: file.file_base64,
      file_name: file.file_name,
      mime_type: file.mime_type,
      tab_scope: input.tabScope,
    });
    out.push({
      file_asset_id: uploaded.file_asset_id,
      source_kind: file.kind === 'checklist' ? 'additional' : file.kind,
    });
  }
  return out;
}

async function loadChecklistFileLinks(input: {
  orgId: string;
  clientId: string;
  tabScope: 'annual_report' | 'capital_declaration';
  taxYear?: number;
}): Promise<Array<{ file_asset_id: string; source_kind: 'checklist' }>> {
  const yearColumnSupported = await supportsAnnualDocumentTaxYearColumns();
  const { data, error } = await supabaseAdmin
    .from('client_annual_document_rows')
    .select(yearColumnSupported ? 'file_asset_id, tax_year' : 'file_asset_id')
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
  for (const file of input.files) {
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
  }
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
  const incoming = await uploadIncomingFilingFiles({
    ctx: input.ctx,
    orgId,
    clientId: input.clientId,
    tabScope: 'annual_report',
    files: parseIncomingFilingFiles(input.files),
  });
  const checklist = await loadChecklistFileLinks({
    orgId,
    clientId: input.clientId,
    tabScope: 'annual_report',
    taxYear,
  });
  const existing = await findAnnualSubmissionForTaxYear({ orgId, clientId: input.clientId, taxYear });
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
  await audit(input.ctx, AUDIT_ACTIONS.CLIENT_OPERATIONS_ANNUAL_REPORT_FILED, submissionId, {
    client_id: input.clientId,
    tax_year: taxYear,
    tab_tax_year: tabTaxYear,
    submitted_on: submittedOn,
    created,
  });
  return { submission_id: submissionId, tax_year: taxYear, submitted_on: submittedOn, created };
}

export async function fileClientOperationsCapitalDeclaration(input: {
  ctx: RequestContext;
  clientId: string;
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
    throw badRequest('No capital declaration requirement to file', 'CAPITAL_FILING_INSTANCE_REQUIRED');
  }

  const incoming = await uploadIncomingFilingFiles({
    ctx: input.ctx,
    orgId,
    clientId: input.clientId,
    tabScope: 'capital_declaration',
    files: parseIncomingFilingFiles(input.files),
  });
  const checklist = await loadChecklistFileLinks({
    orgId,
    clientId: input.clientId,
    tabScope: 'capital_declaration',
  });
  const existingSubmission = await findCapitalSubmissionForInstance({
    orgId,
    clientId: input.clientId,
    instanceId,
  });
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
  });
  return { instance_id: instanceId, submission_id: submissionId, submitted_on: submittedOn };
}
