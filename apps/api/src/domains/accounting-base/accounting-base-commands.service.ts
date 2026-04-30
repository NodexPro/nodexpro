import type { RequestContext } from '../../shared/context.js';
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, forbidden } from '../../shared/errors.js';
import { assertOrgInContext } from './accounting-base.guards.js';
import {
  buildAccountingCategoriesWorkspaceAggregate,
  buildAccountingEntryDetailsAggregate,
  buildAccountingEntriesWorkspaceAggregate,
  buildAccountingPeriodsWorkspaceAggregate,
  buildAccountingSummaryWorkspaceAggregate,
  type AccountingCategoriesWorkspaceAggregate,
  type AccountingEntryDetailsAggregate,
  type AccountingEntriesWorkspaceAggregate,
  type AccountingPeriodsWorkspaceAggregate,
  type AccountingSummaryWorkspaceAggregate,
} from './accounting-base-read-models.service.js';
import { forCommandCreateCategory, forCommandGetCategory, forCommandUpdateCategory } from './category.service.js';
import { forCommandCreateEntry, forCommandGetEntry, forCommandUpdateEntry } from './entry.service.js';
import { forCommandCreateLink, forCommandDeleteLink } from './link.service.js';
import { forCommandCreatePeriod, forCommandGetPeriod, forCommandUpdatePeriod } from './period.service.js';
import { forSystemRecomputeDerivedSummaries } from './summary.service.js';

export type AccountingBaseCommandType =
  | 'create_period'
  | 'lock_period'
  | 'close_period'
  | 'create_entry'
  | 'update_draft_entry'
  | 'finalize_entry'
  | 'archive_entry'
  | 'create_category'
  | 'update_category'
  | 'deactivate_category'
  | 'link_entry_to_entity'
  | 'unlink_entry_from_entity'
  | 'recompute_summary';

type CommandPayload = Record<string, unknown>;
type LinkTargetType = 'document' | 'client' | 'module_entity' | 'other' | 'accounting_entry';

const PERMISSIONS = {
  PERIOD_MANAGE: 'accounting_base.period.manage',
  ENTRY_WRITE: 'accounting_base.entry.write',
  CATEGORY_MANAGE: 'accounting_base.category.manage',
  LINK_MANAGE: 'accounting_base.link.manage',
  SUMMARY_RECOMPUTE: 'accounting_base.summary.recompute',
} as const;

type RefreshedAggregateEnvelope =
  | {
      aggregate_key: 'accounting_entries_workspace_aggregate';
      aggregate: AccountingEntriesWorkspaceAggregate;
    }
  | {
      aggregate_key: 'accounting_entry_details_aggregate';
      aggregate: AccountingEntryDetailsAggregate;
    }
  | {
      aggregate_key: 'accounting_periods_workspace_aggregate';
      aggregate: AccountingPeriodsWorkspaceAggregate;
    }
  | {
      aggregate_key: 'accounting_categories_workspace_aggregate';
      aggregate: AccountingCategoriesWorkspaceAggregate;
    }
  | {
      aggregate_key: 'accounting_summary_workspace_aggregate';
      aggregate: AccountingSummaryWorkspaceAggregate;
    };

export type AccountingBaseCommandResponse = {
  ok: true;
  command: AccountingBaseCommandType;
  refreshed: RefreshedAggregateEnvelope;
  additional_refreshed?: RefreshedAggregateEnvelope[];
};

type CommandRefreshTarget = {
  primary:
    | 'accounting_entries_workspace_aggregate'
    | 'accounting_entry_details_aggregate'
    | 'accounting_periods_workspace_aggregate'
    | 'accounting_categories_workspace_aggregate'
    | 'accounting_summary_workspace_aggregate';
  entryId?: string;
};

function parsePayload(input: unknown): CommandPayload {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as CommandPayload) : {};
}

function requirePermission(ctx: RequestContext, code: string): void {
  const perms = ctx.membership?.permissions ?? [];
  if (!perms.includes(code)) {
    throw forbidden('Insufficient permission');
  }
}

function reqString(payload: CommandPayload, key: string): string {
  const val = String(payload[key] ?? '').trim();
  if (!val) throw badRequest(`${key} required`);
  return val;
}

function reqNumber(payload: CommandPayload, key: string): number {
  const num = Number(payload[key]);
  if (!Number.isFinite(num)) throw badRequest(`${key} required`);
  return num;
}

function reqLinkTargetType(payload: CommandPayload, key: string): LinkTargetType {
  const raw = reqString(payload, key) as LinkTargetType;
  const allowed: LinkTargetType[] = ['document', 'client', 'module_entity', 'other', 'accounting_entry'];
  if (!allowed.includes(raw)) {
    throw badRequest(`Unsupported ${key}: ${raw}`);
  }
  return raw;
}

async function audit(
  ctx: RequestContext,
  organizationId: string,
  entityType: string,
  entityId: string | null,
  action: string,
  payload: Record<string, unknown>
): Promise<void> {
  await writeAudit({
    organizationId,
    actorUserId: ctx.user.id,
    moduleCode: 'accounting_base',
    entityType,
    entityId,
    action,
    payload,
  });
}

async function assertLinkTargetTenantSafe(
  organizationId: string,
  targetType: LinkTargetType,
  targetId: string
): Promise<void> {
  if (targetType === 'client') {
    const { data } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('id', targetId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (!data) throw badRequest('Invalid link target: client not found in organization');
    return;
  }

  if (targetType === 'document') {
    const { data } = await supabaseAdmin
      .from('file_assets')
      .select('id')
      .eq('id', targetId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (!data) throw badRequest('Invalid link target: document not found in organization');
    return;
  }

  if (targetType === 'accounting_entry') {
    const { data } = await supabaseAdmin
      .from('accounting_entries')
      .select('id')
      .eq('id', targetId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (!data) throw badRequest('Invalid link target: accounting entry not found in organization');
    return;
  }

  // module_entity/other: enforce non-empty ID, tenant-safe resolution is deferred
  // to the owning module once integration is introduced.
  if (!targetId.trim()) throw badRequest('target_entity_id required');
}

async function handleCreatePeriod(ctx: RequestContext, organizationId: string, payload: CommandPayload): Promise<CommandRefreshTarget> {
  requirePermission(ctx, PERMISSIONS.PERIOD_MANAGE);
  await forCommandCreatePeriod(ctx, organizationId, {
    period_start: reqString(payload, 'period_start'),
    period_end: reqString(payload, 'period_end'),
    period_label: reqString(payload, 'period_label'),
    base_currency: reqString(payload, 'base_currency'),
    status: 'open',
  });
  await audit(ctx, organizationId, 'accounting_period', null, AUDIT_ACTIONS.ACCOUNTING_BASE_PERIOD_CREATED, payload);
  return { primary: 'accounting_periods_workspace_aggregate' };
}

async function handleLockPeriod(ctx: RequestContext, organizationId: string, payload: CommandPayload): Promise<CommandRefreshTarget> {
  requirePermission(ctx, PERMISSIONS.PERIOD_MANAGE);
  const periodId = reqString(payload, 'period_id');
  const period = await forCommandGetPeriod(ctx, organizationId, periodId);
  if (period.status !== 'open') throw conflict('Only open period can be locked');
  await forCommandUpdatePeriod(ctx, organizationId, periodId, { status: 'locked' });
  await audit(ctx, organizationId, 'accounting_period', periodId, AUDIT_ACTIONS.ACCOUNTING_BASE_PERIOD_LOCKED, payload);
  return { primary: 'accounting_periods_workspace_aggregate' };
}

async function handleClosePeriod(ctx: RequestContext, organizationId: string, payload: CommandPayload): Promise<CommandRefreshTarget> {
  requirePermission(ctx, PERMISSIONS.PERIOD_MANAGE);
  const periodId = reqString(payload, 'period_id');
  const period = await forCommandGetPeriod(ctx, organizationId, periodId);
  if (period.status !== 'locked') throw conflict('Only locked period can be closed');
  await forCommandUpdatePeriod(ctx, organizationId, periodId, {
    status: 'closed',
    closed_at: new Date().toISOString(),
    closed_by: ctx.user.id,
  });
  await audit(ctx, organizationId, 'accounting_period', periodId, AUDIT_ACTIONS.ACCOUNTING_BASE_PERIOD_CLOSED, payload);
  return { primary: 'accounting_periods_workspace_aggregate' };
}

async function ensurePeriodWritableForEntry(ctx: RequestContext, organizationId: string, periodId: string): Promise<void> {
  const period = await forCommandGetPeriod(ctx, organizationId, periodId);
  if (period.status === 'closed') throw conflict('Closed period cannot be mutated');
}

async function handleCreateEntry(ctx: RequestContext, organizationId: string, payload: CommandPayload): Promise<CommandRefreshTarget> {
  requirePermission(ctx, PERMISSIONS.ENTRY_WRITE);
  const periodId = reqString(payload, 'period_id');
  await ensurePeriodWritableForEntry(ctx, organizationId, periodId);

  const created = await forCommandCreateEntry(ctx, organizationId, {
    period_id: periodId,
    category_id: reqString(payload, 'category_id'),
    client_id: payload.client_id == null ? null : String(payload.client_id),
    entry_type: reqString(payload, 'entry_type'),
    status: 'active',
    posting_state: 'draft',
    description: payload.description == null ? null : String(payload.description),
    entry_date: reqString(payload, 'entry_date'),
    amount: reqNumber(payload, 'amount'),
    currency: reqString(payload, 'currency'),
    direction: reqString(payload, 'direction') as 'debit' | 'credit',
    source_type: payload.source_type == null ? null : String(payload.source_type),
  });

  await audit(ctx, organizationId, 'accounting_entry', null, AUDIT_ACTIONS.ACCOUNTING_BASE_ENTRY_CREATED, payload);
  return { primary: 'accounting_entries_workspace_aggregate', entryId: created.id };
}

async function handleUpdateDraftEntry(ctx: RequestContext, organizationId: string, payload: CommandPayload): Promise<CommandRefreshTarget> {
  requirePermission(ctx, PERMISSIONS.ENTRY_WRITE);
  const entryId = reqString(payload, 'entry_id');
  const entry = await forCommandGetEntry(ctx, organizationId, entryId);
  if (entry.posting_state !== 'draft') throw conflict('Only draft entry can be updated');
  await ensurePeriodWritableForEntry(ctx, organizationId, entry.period_id);

  const patch: Record<string, unknown> = {};
  const keys = ['period_id', 'category_id', 'client_id', 'entry_type', 'description', 'entry_date', 'amount', 'currency', 'direction', 'source_type'];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      patch[key] = payload[key];
    }
  }
  await forCommandUpdateEntry(ctx, organizationId, entryId, patch);
  await audit(ctx, organizationId, 'accounting_entry', entryId, AUDIT_ACTIONS.ACCOUNTING_BASE_ENTRY_DRAFT_UPDATED, payload);
  return { primary: 'accounting_entries_workspace_aggregate', entryId };
}

async function handleFinalizeEntry(ctx: RequestContext, organizationId: string, payload: CommandPayload): Promise<CommandRefreshTarget> {
  requirePermission(ctx, PERMISSIONS.ENTRY_WRITE);
  const entryId = reqString(payload, 'entry_id');
  const entry = await forCommandGetEntry(ctx, organizationId, entryId);
  if (entry.posting_state !== 'draft') throw conflict('Only draft entry can be finalized');
  await ensurePeriodWritableForEntry(ctx, organizationId, entry.period_id);

  await forCommandUpdateEntry(ctx, organizationId, entryId, {
    posting_state: 'finalized',
    finalized_at: new Date().toISOString(),
    finalized_by: ctx.user.id,
  });
  await audit(ctx, organizationId, 'accounting_entry', entryId, AUDIT_ACTIONS.ACCOUNTING_BASE_ENTRY_FINALIZED, payload);
  return { primary: 'accounting_entries_workspace_aggregate', entryId };
}

async function handleArchiveEntry(ctx: RequestContext, organizationId: string, payload: CommandPayload): Promise<CommandRefreshTarget> {
  requirePermission(ctx, PERMISSIONS.ENTRY_WRITE);
  const entryId = reqString(payload, 'entry_id');
  const entry = await forCommandGetEntry(ctx, organizationId, entryId);
  if (entry.status === 'archived') throw conflict('Entry already archived');
  await ensurePeriodWritableForEntry(ctx, organizationId, entry.period_id);

  await forCommandUpdateEntry(ctx, organizationId, entryId, { status: 'archived' });
  await audit(ctx, organizationId, 'accounting_entry', entryId, AUDIT_ACTIONS.ACCOUNTING_BASE_ENTRY_ARCHIVED, payload);
  return { primary: 'accounting_entries_workspace_aggregate', entryId };
}

async function handleCreateCategory(ctx: RequestContext, organizationId: string, payload: CommandPayload): Promise<CommandRefreshTarget> {
  requirePermission(ctx, PERMISSIONS.CATEGORY_MANAGE);
  await forCommandCreateCategory(ctx, organizationId, {
    code: reqString(payload, 'code'),
    name: reqString(payload, 'name'),
    category_type: reqString(payload, 'category_type'),
    status: 'active',
    parent_category_id: payload.parent_category_id == null ? null : String(payload.parent_category_id),
  });
  await audit(ctx, organizationId, 'accounting_category', null, AUDIT_ACTIONS.ACCOUNTING_BASE_CATEGORY_CREATED, payload);
  return { primary: 'accounting_categories_workspace_aggregate' };
}

async function handleUpdateCategory(ctx: RequestContext, organizationId: string, payload: CommandPayload): Promise<CommandRefreshTarget> {
  requirePermission(ctx, PERMISSIONS.CATEGORY_MANAGE);
  const categoryId = reqString(payload, 'category_id');
  await forCommandGetCategory(ctx, organizationId, categoryId);

  const patch: Record<string, unknown> = {};
  const keys = ['code', 'name', 'category_type', 'parent_category_id'];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      patch[key] = payload[key];
    }
  }
  await forCommandUpdateCategory(ctx, organizationId, categoryId, patch);
  await audit(ctx, organizationId, 'accounting_category', categoryId, AUDIT_ACTIONS.ACCOUNTING_BASE_CATEGORY_UPDATED, payload);
  return { primary: 'accounting_categories_workspace_aggregate' };
}

async function handleDeactivateCategory(ctx: RequestContext, organizationId: string, payload: CommandPayload): Promise<CommandRefreshTarget> {
  requirePermission(ctx, PERMISSIONS.CATEGORY_MANAGE);
  const categoryId = reqString(payload, 'category_id');
  await forCommandGetCategory(ctx, organizationId, categoryId);
  await forCommandUpdateCategory(ctx, organizationId, categoryId, { status: 'inactive' });
  await audit(ctx, organizationId, 'accounting_category', categoryId, AUDIT_ACTIONS.ACCOUNTING_BASE_CATEGORY_DEACTIVATED, payload);
  return { primary: 'accounting_categories_workspace_aggregate' };
}

async function handleLinkEntryToEntity(ctx: RequestContext, organizationId: string, payload: CommandPayload): Promise<CommandRefreshTarget> {
  requirePermission(ctx, PERMISSIONS.LINK_MANAGE);
  const entryId = reqString(payload, 'entry_id');
  await forCommandGetEntry(ctx, organizationId, entryId);
  const targetType = reqLinkTargetType(payload, 'target_entity_type');
  const targetId = reqString(payload, 'target_entity_id');
  await assertLinkTargetTenantSafe(organizationId, targetType, targetId);

  await forCommandCreateLink(ctx, organizationId, {
    accounting_entry_id: entryId,
    target_entity_type: targetType,
    target_entity_id: targetId,
    relation_type: reqString(payload, 'relation_type'),
  });
  await audit(ctx, organizationId, 'accounting_entry_link', null, AUDIT_ACTIONS.ACCOUNTING_BASE_ENTRY_LINKED, payload);
  return { primary: 'accounting_entry_details_aggregate', entryId };
}

async function handleUnlinkEntryFromEntity(ctx: RequestContext, organizationId: string, payload: CommandPayload): Promise<CommandRefreshTarget> {
  requirePermission(ctx, PERMISSIONS.LINK_MANAGE);
  const linkId = reqString(payload, 'link_id');
  const { data: linkRow } = await supabaseAdmin
    .from('accounting_entry_links')
    .select('accounting_entry_id')
    .eq('id', linkId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  await forCommandDeleteLink(ctx, organizationId, linkId);
  await audit(ctx, organizationId, 'accounting_entry_link', linkId, AUDIT_ACTIONS.ACCOUNTING_BASE_ENTRY_UNLINKED, payload);
  if (linkRow?.accounting_entry_id) {
    return {
      primary: 'accounting_entry_details_aggregate',
      entryId: linkRow.accounting_entry_id as string,
    };
  }
  return { primary: 'accounting_entries_workspace_aggregate' };
}

async function handleRecomputeSummary(
  ctx: RequestContext,
  organizationId: string,
  payload: CommandPayload
): Promise<CommandRefreshTarget> {
  requirePermission(ctx, PERMISSIONS.SUMMARY_RECOMPUTE);
  const period_id =
    payload.period_id == null || String(payload.period_id).trim() === '' ? undefined : String(payload.period_id).trim();
  await forSystemRecomputeDerivedSummaries(ctx, organizationId, { period_id });
  await audit(ctx, organizationId, 'accounting_summary', null, AUDIT_ACTIONS.ACCOUNTING_BASE_SUMMARY_RECOMPUTED, payload);
  return { primary: 'accounting_summary_workspace_aggregate' };
}

async function buildRefreshedEnvelope(
  ctx: RequestContext,
  organizationId: string,
  target: CommandRefreshTarget
): Promise<RefreshedAggregateEnvelope> {
  if (target.primary === 'accounting_periods_workspace_aggregate') {
    const aggregate = await buildAccountingPeriodsWorkspaceAggregate(ctx, organizationId);
    return { aggregate_key: 'accounting_periods_workspace_aggregate', aggregate };
  }
  if (target.primary === 'accounting_categories_workspace_aggregate') {
    const aggregate = await buildAccountingCategoriesWorkspaceAggregate(ctx, organizationId);
    return { aggregate_key: 'accounting_categories_workspace_aggregate', aggregate };
  }
  if (target.primary === 'accounting_summary_workspace_aggregate') {
    const aggregate = await buildAccountingSummaryWorkspaceAggregate(ctx, organizationId);
    return { aggregate_key: 'accounting_summary_workspace_aggregate', aggregate };
  }
  if (target.primary === 'accounting_entry_details_aggregate') {
    if (!target.entryId) throw badRequest('entry_id required for entry details aggregate');
    const aggregate = await buildAccountingEntryDetailsAggregate(ctx, organizationId, target.entryId);
    return { aggregate_key: 'accounting_entry_details_aggregate', aggregate };
  }
  const aggregate = await buildAccountingEntriesWorkspaceAggregate(ctx, organizationId);
  return { aggregate_key: 'accounting_entries_workspace_aggregate', aggregate };
}

export async function executeAccountingBaseCommand(
  ctx: RequestContext,
  organizationId: string,
  body: { type?: string; payload?: Record<string, unknown> }
): Promise<AccountingBaseCommandResponse> {
  assertOrgInContext(ctx, organizationId);
  const type = String(body.type ?? '').trim() as AccountingBaseCommandType;
  const payload = parsePayload(body.payload);

  if (!type) throw badRequest('type required');

  let refreshTarget: CommandRefreshTarget;
  if (type === 'create_period') refreshTarget = await handleCreatePeriod(ctx, organizationId, payload);
  else if (type === 'lock_period') refreshTarget = await handleLockPeriod(ctx, organizationId, payload);
  else if (type === 'close_period') refreshTarget = await handleClosePeriod(ctx, organizationId, payload);
  else if (type === 'create_entry') refreshTarget = await handleCreateEntry(ctx, organizationId, payload);
  else if (type === 'update_draft_entry') refreshTarget = await handleUpdateDraftEntry(ctx, organizationId, payload);
  else if (type === 'finalize_entry') refreshTarget = await handleFinalizeEntry(ctx, organizationId, payload);
  else if (type === 'archive_entry') refreshTarget = await handleArchiveEntry(ctx, organizationId, payload);
  else if (type === 'create_category') refreshTarget = await handleCreateCategory(ctx, organizationId, payload);
  else if (type === 'update_category') refreshTarget = await handleUpdateCategory(ctx, organizationId, payload);
  else if (type === 'deactivate_category') refreshTarget = await handleDeactivateCategory(ctx, organizationId, payload);
  else if (type === 'link_entry_to_entity') refreshTarget = await handleLinkEntryToEntity(ctx, organizationId, payload);
  else if (type === 'unlink_entry_from_entity') refreshTarget = await handleUnlinkEntryFromEntity(ctx, organizationId, payload);
  else if (type === 'recompute_summary') refreshTarget = await handleRecomputeSummary(ctx, organizationId, payload);
  else throw badRequest(`Unknown accounting base command type: ${type}`);

  const refreshed = await buildRefreshedEnvelope(ctx, organizationId, refreshTarget);
  const additional_refreshed: RefreshedAggregateEnvelope[] = [];

  if (
    refreshTarget.primary === 'accounting_entries_workspace_aggregate' &&
    refreshTarget.entryId
  ) {
    additional_refreshed.push(
      await buildRefreshedEnvelope(ctx, organizationId, {
        primary: 'accounting_entry_details_aggregate',
        entryId: refreshTarget.entryId,
      })
    );
  }

  return {
    ok: true,
    command: type,
    refreshed,
    ...(additional_refreshed.length ? { additional_refreshed } : {}),
  };
}
