/**
 * Recurring cycle generated draft — dedicated review case (not retainer setup aggregate).
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import {
  generateIncomeDocumentPreview,
  resumeIncomeDocumentDraftFromContext,
} from '../income/income-document-draft-editor.service.js';
import { buildIncomeWorkspaceWizardPatchAggregate } from '../income/income-workspace-aggregate.service.js';
import { incomeWorkspacePermissionsFromContext } from '../income/income-issuer-context.service.js';
import { WORK_ENGINE_INVOICE_WIZARD_INCOME_COMMANDS } from './work-engine-invoices-document-creation.builders.js';
import { formatHebrewDateDisplay } from './work-engine-invoice-retainer.pure.js';
import { validateCycleDraftReviewRefs } from './work-engine-invoice-retainer-cycle-draft-review.pure.js';
import {
  RECURRING_WORK_ENGINE_ENTITY_TYPE,
  RECURRING_WORK_TYPE,
} from './work-engine-invoice-retainer.pure.js';
import type { WorkEngineRecurringCycleDraftReviewAggregate } from './work-engine-invoice-retainer.types.js';

function assertEditAccess(ctx: RequestContext): void {
  const perms = incomeWorkspacePermissionsFromContext(ctx);
  if (!perms.view) throw forbidden('income.view required');
  if (!perms.issue_on_behalf) throw forbidden('income.issue_on_behalf required');
  if (!perms.edit) throw forbidden('income.edit required');
}

export async function openRecurringCycleDraftForReview(params: {
  ctx: RequestContext;
  representedClientId: string;
  profileId: string;
  cycleId: string;
  generatedDraftId: string;
  periodKey?: string | null;
  linkedWorkItemId?: string | null;
}): Promise<WorkEngineRecurringCycleDraftReviewAggregate> {
  assertEditAccess(params.ctx);
  const orgId = params.ctx.organizationId;
  if (!orgId) throw badRequest('Organization context required');

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('income_recurring_document_profiles')
    .select('id, organization_id, represented_client_id')
    .eq('organization_id', orgId)
    .eq('id', params.profileId)
    .eq('represented_client_id', params.representedClientId)
    .maybeSingle();
  throwIfSupabaseError(profileErr, 'loadRecurringProfileForCycleDraftReview');
  if (!profile) throw notFound('Recurring profile not found');

  const { data: cycle, error: cycleErr } = await supabaseAdmin
    .from('income_recurring_document_cycles')
    .select('id, recurring_profile_id, scheduled_document_date, generated_draft_id')
    .eq('organization_id', orgId)
    .eq('id', params.cycleId)
    .eq('recurring_profile_id', params.profileId)
    .maybeSingle();
  throwIfSupabaseError(cycleErr, 'loadRecurringCycleForDraftReview');
  const cycleRow = cycle as {
    id: string;
    recurring_profile_id: string;
    scheduled_document_date: string;
    generated_draft_id: string | null;
  } | null;
  if (!cycleRow) throw notFound('Recurring cycle not found');

  const { data: draft, error: draftErr } = await supabaseAdmin
    .from('income_document_drafts')
    .select('id, organization_id, represented_client_id, issuer_business_id, status')
    .eq('organization_id', orgId)
    .eq('id', params.generatedDraftId)
    .maybeSingle();
  throwIfSupabaseError(draftErr, 'loadGeneratedDraftForCycleReview');
  const draftRow = draft as {
    id: string;
    organization_id: string;
    represented_client_id: string | null;
    issuer_business_id: string;
    status: string;
  } | null;
  if (!draftRow) throw notFound('Generated draft not found');
  if (draftRow.status !== 'draft') throw badRequest('Generated draft is not editable');

  let workItemPeriodKey: string | null = null;
  let workItemSourceEntityId: string | null = null;
  if (params.linkedWorkItemId) {
    const { data: workItem, error: workItemErr } = await supabaseAdmin
      .from('work_items')
      .select('id, org_id, period_key, work_type, source_entity_id, source_entity_type')
      .eq('org_id', orgId)
      .eq('id', params.linkedWorkItemId)
      .maybeSingle();
    throwIfSupabaseError(workItemErr, 'loadWorkItemForCycleDraftReview');
    const workItemRow = workItem as {
      id: string;
      org_id: string;
      period_key: string;
      work_type: string;
      source_entity_id: string;
      source_entity_type: string;
    } | null;
    if (!workItemRow) throw notFound('Linked work item not found');
    if (workItemRow.work_type !== RECURRING_WORK_TYPE) {
      throw badRequest('Linked work item is not a recurring invoice review task');
    }
    if (workItemRow.source_entity_type !== RECURRING_WORK_ENGINE_ENTITY_TYPE) {
      throw badRequest('Linked work item source is invalid');
    }
    workItemPeriodKey = workItemRow.period_key;
    workItemSourceEntityId = workItemRow.source_entity_id;
  }

  const validation = validateCycleDraftReviewRefs({
    profile_id: params.profileId,
    cycle_profile_id: cycleRow.recurring_profile_id,
    cycle_id: cycleRow.id,
    requested_cycle_id: params.cycleId,
    cycle_generated_draft_id: cycleRow.generated_draft_id,
    requested_draft_id: params.generatedDraftId,
    draft_organization_id: draftRow.organization_id,
    expected_organization_id: orgId,
    draft_represented_client_id: draftRow.represented_client_id,
    expected_represented_client_id: params.representedClientId,
    period_key: params.periodKey ?? null,
    linked_work_item_id: params.linkedWorkItemId ?? null,
    work_item_period_key: workItemPeriodKey,
    work_item_source_entity_id: workItemSourceEntityId,
  });
  if (!validation.ok) throw badRequest(`Invalid cycle draft review request: ${validation.reason}`);

  const resumed = await resumeIncomeDocumentDraftFromContext(params.ctx, {
    draft_id: params.generatedDraftId,
  });
  const previewOverlay = await generateIncomeDocumentPreview(resumed.scope, {
    draft_id: params.generatedDraftId,
  });
  const income_workspace_aggregate = await buildIncomeWorkspaceWizardPatchAggregate(
    resumed.scope,
    previewOverlay,
    resumed.result.recipientOverlay,
    resumed.result.starting_step_key,
    { includeBrandingProfile: true },
  );

  const canSaveDraft = Boolean(WORK_ENGINE_INVOICE_WIZARD_INCOME_COMMANDS.save_draft);
  const documentTypeLabel =
    income_workspace_aggregate.document_details_step?.document_preview?.document_type_label ??
    income_workspace_aggregate.document_details_step?.header?.title ??
    'מסמך';
  const aggregate: WorkEngineRecurringCycleDraftReviewAggregate = {
    aggregate_key: 'work_engine_recurring_cycle_draft_review_aggregate',
    represented_client_id: params.representedClientId,
    profile_id: params.profileId,
    cycle_id: params.cycleId,
    generated_draft_id: params.generatedDraftId,
    period_key: params.periodKey ?? '',
    linked_work_item_id: params.linkedWorkItemId ?? null,
    scheduled_document_date_display: formatHebrewDateDisplay(cycleRow.scheduled_document_date),
    title: documentTypeLabel,
    initial_view: 'document_preview',
    edit_action: {
      visible: true,
      label: 'עריכה',
      disabled_reason: null,
    },
    income_workspace_aggregate,
    income_commands: { ...WORK_ENGINE_INVOICE_WIZARD_INCOME_COMMANDS },
    preview_action: {
      visible: false,
      label: 'תצוגה מקדימה',
      disabled_reason: null,
    },
    allowed_actions: [
      'open_recurring_cycle_draft_for_review',
      'edit_recurring_cycle_draft',
      ...(canSaveDraft ? ['save_income_document_draft'] : []),
    ],
  };

  await writeAudit({
    organizationId: orgId,
    actorUserId: params.ctx.user?.id ?? null,
    moduleCode: 'work_engine',
    entityType: 'income_recurring_document_cycle',
    entityId: params.cycleId,
    action: AUDIT_ACTIONS.INCOME_RECURRING_PROFILE_CYCLE_DRAFT_REVIEW_OPENED,
    payload: {
      profile_id: params.profileId,
      generated_draft_id: params.generatedDraftId,
      period_key: params.periodKey ?? null,
      linked_work_item_id: params.linkedWorkItemId ?? null,
    },
  });

  return aggregate;
}
