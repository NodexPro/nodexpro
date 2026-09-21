/**
 * Client Operations — annual report / capital declaration operational target dates.
 * Batch loaders + named commands. Caller returns refreshed registry aggregate.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import { isOperationalPeriodKey } from './client-operations-operational-period.pure.js';
import {
  buildAnnualReportCell,
  buildCapitalDeclarationCell,
  isCanonicalIsoDate,
  resolveAnnualReportTaxYearForOperationalPeriod,
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
  const { data, error } = await supabaseAdmin
    .from('client_capital_declaration_instances')
    .select('id, client_id, tax_year, operational_target_date, status, label_he')
    .eq('organization_id', input.organizationId)
    .eq('status', 'open')
    .in('client_id', input.clientIds);
  assertQueryError(error, 'Failed to load open capital declaration instances');
  for (const raw of data ?? []) {
    const row = raw as CapitalDeclarationInstanceRow;
    out.set(String(row.client_id), {
      id: String(row.id),
      client_id: String(row.client_id),
      tax_year: row.tax_year == null ? null : Number(row.tax_year),
      operational_target_date: row.operational_target_date
        ? String(row.operational_target_date).slice(0, 10)
        : null,
      status: String(row.status),
      label_he: row.label_he == null ? null : String(row.label_he),
    });
  }
  return out;
}

export function projectAnnualReportCells(input: {
  clientIds: string[];
  taxYear: number;
  instancesByClientId: Map<string, AnnualYearInstanceRow>;
  canEdit: boolean;
}): Map<string, AnnualReportOperationalDateCell> {
  const out = new Map<string, AnnualReportOperationalDateCell>();
  for (const clientId of input.clientIds) {
    const inst = input.instancesByClientId.get(clientId) ?? null;
    out.set(
      clientId,
      buildAnnualReportCell({
        taxYear: input.taxYear,
        instanceId: inst?.id ?? null,
        operationalTargetDate: inst?.operational_target_date ?? null,
        canEdit: input.canEdit,
      }),
    );
  }
  return out;
}

export function projectCapitalDeclarationCells(input: {
  clientIds: string[];
  openByClientId: Map<string, CapitalDeclarationInstanceRow>;
  canEdit: boolean;
}): Map<string, CapitalDeclarationOperationalDateCell> {
  const out = new Map<string, CapitalDeclarationOperationalDateCell>();
  for (const clientId of input.clientIds) {
    const open = input.openByClientId.get(clientId) ?? null;
    out.set(
      clientId,
      buildCapitalDeclarationCell({
        openInstance: open
          ? {
              id: open.id,
              tax_year: open.tax_year,
              operational_target_date: open.operational_target_date,
            }
          : null,
        canEdit: input.canEdit,
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
  const { data, error } = await supabaseAdmin
    .from('client_capital_declaration_instances')
    .insert({
      organization_id: orgId,
      client_id: input.clientId,
      tax_year: taxYear,
      label_he: labelHe,
      status: 'open',
      operational_target_date: null,
      opened_at: nowIso,
      created_by: actorId,
      updated_by: actorId,
    })
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
