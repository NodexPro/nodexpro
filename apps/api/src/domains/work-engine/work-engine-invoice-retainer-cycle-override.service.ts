/**
 * Recurring cycle future overrides — commands + dedicated aggregate (projection only).
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import type { IncomeDocumentDetailsStep } from '../income/income.types.js';
import { incomeWorkspacePermissionsFromContext } from '../income/income-issuer-context.service.js';
import { loadActiveIncomeIssuerScope } from '../income/income-issuer-scope.service.js';
import { denormalizedProfileFieldsFromSnapshot } from './work-engine-invoice-retainer-draft.service.js';
import { ensureRetainerDocumentDraftWorkspace } from './work-engine-invoice-retainer-draft.service.js';
import {
  attachFutureCycleProjectionPreview,
  buildFutureCycleProjectionStep,
  renderFutureCycleProjectionPreview,
  refreshFutureCycleProjectionStepTotals,
} from './work-engine-invoice-retainer-future-cycle-projection.service.js';
import {
  buildOverrideSaveScopeDialog,
  isRecurringCycleOverrideApplyScope,
  overridePayloadFromDocumentDetailsStep,
  overridePayloadFromTemplateSnapshot,
  resolveCycleOverrideForDate,
  type RecurringCycleOverridePayload,
  type RecurringCycleOverrideRow,
  type RecurringCycleOverrideScope,
} from './work-engine-invoice-retainer-cycle-override.pure.js';
import { formatHebrewDateDisplay } from './work-engine-invoice-retainer.pure.js';
import { buildWorkEngineInvoiceRetainerSetupAggregate } from './work-engine-invoice-retainer.read-model.service.js';
import type {
  WorkEngineInvoiceRetainerCommandResponse,
  WorkEngineRecurringCycleOverrideAggregate,
} from './work-engine-invoice-retainer.types.js';

function assertEditAccess(ctx: RequestContext): void {
  const perms = incomeWorkspacePermissionsFromContext(ctx);
  if (!perms.view) throw forbidden('income.view required');
  if (!perms.issue_on_behalf) throw forbidden('income.issue_on_behalf required');
  if (!perms.edit) throw forbidden('income.edit required');
}

function parseOverridePayload(raw: unknown): RecurringCycleOverridePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as RecurringCycleOverridePayload;
  if (o.snapshot_kind !== 'recurring_cycle_override' || o.snapshot_version !== 1) return null;
  return o;
}

export async function loadRecurringCycleOverridesForProfile(params: {
  orgId: string;
  profileId: string;
}): Promise<Map<string, RecurringCycleOverrideRow>> {
  const { data, error } = await supabaseAdmin
    .from('income_recurring_cycle_overrides')
    .select('cycle_date, override_scope, override_payload')
    .eq('organization_id', params.orgId)
    .eq('recurring_profile_id', params.profileId)
    .eq('override_scope', 'single_cycle');
  throwIfSupabaseError(error, 'loadRecurringCycleOverridesForProfile');
  const map = new Map<string, RecurringCycleOverrideRow>();
  for (const row of data ?? []) {
    const payload = parseOverridePayload((row as { override_payload: unknown }).override_payload);
    if (!payload) continue;
    map.set(String((row as { cycle_date: string }).cycle_date), {
      cycle_date: String((row as { cycle_date: string }).cycle_date),
      override_scope: 'single_cycle',
      override_payload: payload,
    });
  }
  return map;
}

async function loadProfileForOverride(params: {
  orgId: string;
  representedClientId: string;
  profileId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from('income_recurring_document_profiles')
    .select(
      'id, organization_id, represented_client_id, end_customer_id, document_type, source_draft_template_id, document_template_snapshot, price_increase_enabled, price_increase_type, price_increase_value',
    )
    .eq('organization_id', params.orgId)
    .eq('id', params.profileId)
    .eq('represented_client_id', params.representedClientId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadProfileForCycleOverride');
  if (!data) throw notFound('Recurring profile not found');
  return data as {
    id: string;
    organization_id: string;
    represented_client_id: string;
    end_customer_id: string;
    document_type: 'quote' | 'deal_invoice' | 'tax_invoice';
    source_draft_template_id: string | null;
    document_template_snapshot: import('./work-engine-invoice-retainer-draft.service.js').RecurringDocumentTemplateSnapshot | null;
    price_increase_enabled: boolean;
    price_increase_type: import('./work-engine-invoice-retainer.pure.js').RecurringPriceIncreaseType | null;
    price_increase_value: number | null;
  };
}

function parseDocumentDetailsStep(body: Record<string, unknown>): IncomeDocumentDetailsStep {
  const step = body.document_details_step;
  if (!step || typeof step !== 'object') {
    throw badRequest('document_details_step is required');
  }
  return step as IncomeDocumentDetailsStep;
}

async function buildCycleOverrideAggregate(params: {
  ctx: RequestContext;
  representedClientId: string;
  profileId: string;
  cycleDate: string;
  periodKey: string;
  cycleIndex: number;
  overridesByDate: ReadonlyMap<string, RecurringCycleOverrideRow>;
  documentDetailsStep?: IncomeDocumentDetailsStep | null;
  includePreview?: boolean;
}): Promise<WorkEngineRecurringCycleOverrideAggregate> {
  const orgId = params.ctx.organizationId!;
  const profile = await loadProfileForOverride({
    orgId,
    representedClientId: params.representedClientId,
    profileId: params.profileId,
  });
  if (!profile.document_template_snapshot) {
    throw badRequest('Recurring profile has no document template snapshot');
  }

  const workspace = await ensureRetainerDocumentDraftWorkspace({
    ctx: params.ctx,
    representedClientId: params.representedClientId,
    endCustomerId: profile.end_customer_id,
    sourceDraftTemplateId: profile.source_draft_template_id,
    fallbackDocumentType: profile.document_type,
  });
  const baseStep = workspace.income_workspace_aggregate.document_details_step;
  if (!baseStep) throw badRequest('Template document step is unavailable');

  const existingOverride = resolveCycleOverrideForDate(params.cycleDate, params.overridesByDate);
  let step =
    params.documentDetailsStep ??
    (await buildFutureCycleProjectionStep({
      orgId,
      profile,
      baseStep,
      cycleDate: params.cycleDate,
      cycleIndex: params.cycleIndex,
      overridePayload: existingOverride?.override_payload ?? null,
    }));

  if (params.documentDetailsStep) {
    step = await refreshFutureCycleProjectionStepTotals({
      orgId,
      step,
      snapshot: profile.document_template_snapshot,
    });
  }

  if (params.includePreview) {
    const scope = await loadActiveIncomeIssuerScope(params.ctx);
    const preview = await renderFutureCycleProjectionPreview({ scope, profile, step });
    step = await attachFutureCycleProjectionPreview(step, preview);
  }

  return {
    aggregate_key: 'work_engine_recurring_cycle_override_aggregate',
    represented_client_id: params.representedClientId,
    profile_id: params.profileId,
    cycle_date: params.cycleDate,
    period_key: params.periodKey,
    cycle_date_display: formatHebrewDateDisplay(params.cycleDate),
    title: 'עריכת מסמך עתידי',
    override_exists: Boolean(existingOverride),
    override_scope: existingOverride?.override_scope ?? null,
    document_details_step: step,
    preview_action: {
      visible: true,
      label: 'תצוגה מקדימה',
      disabled_reason: null,
    },
    save_action: {
      visible: true,
      label: 'שמור',
      disabled_reason: null,
      apply_scope_dialog: buildOverrideSaveScopeDialog(true),
    },
    delete_action: {
      visible: Boolean(existingOverride),
      label: 'מחיקת התאמה',
      disabled_reason: existingOverride ? null : 'אין התאמה שמורה למחזור זה',
    },
    allowed_actions: [
      'open_recurring_cycle_override_for_edit',
      'preview_recurring_cycle_override',
      'save_recurring_cycle_override',
      ...(existingOverride ? ['delete_recurring_cycle_override'] : []),
    ],
  };
}

export async function openRecurringCycleOverrideForEdit(params: {
  ctx: RequestContext;
  representedClientId: string;
  profileId: string;
  cycleDate: string;
  periodKey: string;
  cycleIndex: number;
}): Promise<WorkEngineRecurringCycleOverrideAggregate> {
  assertEditAccess(params.ctx);
  const orgId = params.ctx.organizationId;
  if (!orgId) throw badRequest('Organization context required');
  const overridesByDate = await loadRecurringCycleOverridesForProfile({
    orgId,
    profileId: params.profileId,
  });
  const aggregate = await buildCycleOverrideAggregate({
    ctx: params.ctx,
    representedClientId: params.representedClientId,
    profileId: params.profileId,
    cycleDate: params.cycleDate,
    periodKey: params.periodKey,
    cycleIndex: params.cycleIndex,
    overridesByDate,
  });
  await writeAudit({
    organizationId: orgId,
    actorUserId: params.ctx.user?.id ?? null,
    moduleCode: 'work_engine',
    entityType: 'income_recurring_document_profile',
    entityId: params.profileId,
    action: AUDIT_ACTIONS.INCOME_RECURRING_CYCLE_OVERRIDE_OPENED,
    payload: {
      cycle_date: params.cycleDate,
      period_key: params.periodKey,
    },
  });
  return aggregate;
}

export async function previewRecurringCycleOverride(params: {
  ctx: RequestContext;
  representedClientId: string;
  profileId: string;
  cycleDate: string;
  periodKey: string;
  cycleIndex: number;
  documentDetailsStep: IncomeDocumentDetailsStep;
}): Promise<WorkEngineRecurringCycleOverrideAggregate> {
  assertEditAccess(params.ctx);
  const orgId = params.ctx.organizationId;
  if (!orgId) throw badRequest('Organization context required');
  const overridesByDate = await loadRecurringCycleOverridesForProfile({
    orgId,
    profileId: params.profileId,
  });
  return buildCycleOverrideAggregate({
    ctx: params.ctx,
    representedClientId: params.representedClientId,
    profileId: params.profileId,
    cycleDate: params.cycleDate,
    periodKey: params.periodKey,
    cycleIndex: params.cycleIndex,
    overridesByDate,
    documentDetailsStep: params.documentDetailsStep,
    includePreview: true,
  });
}

export async function saveRecurringCycleOverride(params: {
  ctx: RequestContext;
  representedClientId: string;
  profileId: string;
  cycleDate: string;
  periodKey: string;
  applyScope: RecurringCycleOverrideScope;
  documentDetailsStep: IncomeDocumentDetailsStep;
}): Promise<WorkEngineInvoiceRetainerCommandResponse> {
  assertEditAccess(params.ctx);
  const orgId = params.ctx.organizationId;
  const userId = params.ctx.user?.id ?? null;
  if (!orgId) throw badRequest('Organization context required');
  if (!isRecurringCycleOverrideApplyScope(params.applyScope)) {
    throw badRequest('Invalid apply_scope');
  }

  const profile = await loadProfileForOverride({
    orgId,
    representedClientId: params.representedClientId,
    profileId: params.profileId,
  });
  const overridePayload = overridePayloadFromDocumentDetailsStep(params.documentDetailsStep);

  if (params.applyScope === 'single_cycle') {
    const { error } = await supabaseAdmin.from('income_recurring_cycle_overrides').upsert(
      {
        organization_id: orgId,
        recurring_profile_id: params.profileId,
        cycle_date: params.cycleDate,
        override_scope: 'single_cycle',
        override_payload: overridePayload,
        created_by_user_id: userId,
        updated_by_user_id: userId,
      },
      { onConflict: 'organization_id,recurring_profile_id,cycle_date' },
    );
    throwIfSupabaseError(error, 'saveSingleCycleOverride');
  } else {
    const currentSnapshot = profile.document_template_snapshot;
    if (!currentSnapshot) throw badRequest('Profile template snapshot is missing');
    const nextSnapshot = {
      ...currentSnapshot,
      document_type: overridePayload.document_type,
      document_settings_json: overridePayload.document_settings_json,
      draft_lines_json: overridePayload.draft_lines_json,
      notes: overridePayload.notes,
      delivery_contact_json: overridePayload.delivery_contact_json,
      document_date: params.cycleDate,
    };
    const denormalized = denormalizedProfileFieldsFromSnapshot(nextSnapshot);
    const { error: profileErr } = await supabaseAdmin
      .from('income_recurring_document_profiles')
      .update({
        document_template_snapshot: nextSnapshot,
        document_type: denormalized.document_type,
        quantity: denormalized.quantity,
        unit_price_before_vat_reference: denormalized.unit_price_before_vat_reference,
        currency: denormalized.currency,
        discount_percent_reference: denormalized.discount_percent_reference,
        discount_amount_reference: denormalized.discount_amount_reference,
        updated_by_user_id: userId,
      })
      .eq('organization_id', orgId)
      .eq('id', params.profileId)
      .eq('represented_client_id', params.representedClientId);
    throwIfSupabaseError(profileErr, 'saveThisAndFutureOverrideProfile');

    const { error: deleteErr } = await supabaseAdmin
      .from('income_recurring_cycle_overrides')
      .delete()
      .eq('organization_id', orgId)
      .eq('recurring_profile_id', params.profileId)
      .gte('cycle_date', params.cycleDate);
    throwIfSupabaseError(deleteErr, 'clearFutureSingleCycleOverrides');
  }

  await writeAudit({
    organizationId: orgId,
    actorUserId: userId,
    moduleCode: 'work_engine',
    entityType: 'income_recurring_document_profile',
    entityId: params.profileId,
    action: AUDIT_ACTIONS.INCOME_RECURRING_CYCLE_OVERRIDE_SAVED,
    payload: {
      cycle_date: params.cycleDate,
      apply_scope: params.applyScope,
      period_key: params.periodKey,
    },
  });

  const setupAggregate = await buildWorkEngineInvoiceRetainerSetupAggregate({
    ctx: params.ctx,
    representedClientId: params.representedClientId,
    endCustomerId: profile.end_customer_id,
  });
  return {
    ok: true,
    command: 'save_recurring_cycle_override',
    work_engine_invoice_retainer_setup_aggregate: setupAggregate,
  };
}

export async function deleteRecurringCycleOverride(params: {
  ctx: RequestContext;
  representedClientId: string;
  profileId: string;
  cycleDate: string;
}): Promise<WorkEngineInvoiceRetainerCommandResponse> {
  assertEditAccess(params.ctx);
  const orgId = params.ctx.organizationId;
  if (!orgId) throw badRequest('Organization context required');
  const profile = await loadProfileForOverride({
    orgId,
    representedClientId: params.representedClientId,
    profileId: params.profileId,
  });
  const { error } = await supabaseAdmin
    .from('income_recurring_cycle_overrides')
    .delete()
    .eq('organization_id', orgId)
    .eq('recurring_profile_id', params.profileId)
    .eq('cycle_date', params.cycleDate)
    .eq('override_scope', 'single_cycle');
  throwIfSupabaseError(error, 'deleteRecurringCycleOverride');

  await writeAudit({
    organizationId: orgId,
    actorUserId: params.ctx.user?.id ?? null,
    moduleCode: 'work_engine',
    entityType: 'income_recurring_document_profile',
    entityId: params.profileId,
    action: AUDIT_ACTIONS.INCOME_RECURRING_CYCLE_OVERRIDE_DELETED,
    payload: { cycle_date: params.cycleDate },
  });

  const setupAggregate = await buildWorkEngineInvoiceRetainerSetupAggregate({
    ctx: params.ctx,
    representedClientId: params.representedClientId,
    endCustomerId: profile.end_customer_id,
  });
  return {
    ok: true,
    command: 'delete_recurring_cycle_override',
    work_engine_invoice_retainer_setup_aggregate: setupAggregate,
  };
}

export function projectedAmountFromOverrideStep(step: IncomeDocumentDetailsStep | null): string | null {
  return step?.totals_block?.grand_total_display ?? null;
}

export async function buildFutureCycleProjectionAmountDisplay(params: {
  orgId: string;
  profile: Parameters<typeof buildFutureCycleProjectionStep>[0]['profile'];
  baseStep: IncomeDocumentDetailsStep;
  cycleDate: string;
  cycleIndex: number;
  overridePayload?: RecurringCycleOverridePayload | null;
}): Promise<string | null> {
  try {
    const step = await buildFutureCycleProjectionStep(params);
    return step.totals_block.grand_total_display;
  } catch {
    return null;
  }
}
