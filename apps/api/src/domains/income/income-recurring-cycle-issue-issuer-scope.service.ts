/**
 * Resolve + apply authoritative office issuer scope for recurring-cycle issue.
 * Trusted sources: draft / cycle / profile (org-scoped). Frontend IDs are references only.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import type { ActiveIncomeIssuerScope } from './income.guards.js';
import { reqUuid } from './income.guards.js';
import {
  applyOfficialIncomeIssuerContext,
  ensureOrgIncomeIssuerProfile,
  resolveIncomeIssuerBusinessDisplay,
} from './income-issuer-context.service.js';
import { loadActiveIncomeIssuerScope } from './income-issuer-scope.service.js';
import type { RecurringCycleReviewCommandContext } from '../work-engine/work-engine-invoice-retainer-cycle-draft-review-context.pure.js';
import {
  HEBREW_RECURRING_ISSUER_MISMATCH,
  resolveDraftIssuerRepairPlan,
} from './income-recurring-cycle-issue-issuer-scope.pure.js';

export type RecurringCycleIssueIssuerContextTruth = {
  represented_client_id: string;
  issuer_business_id: string;
  acting_mode: 'office_representative';
  label: string;
};

export { HEBREW_RECURRING_ISSUER_MISMATCH, resolveDraftIssuerRepairPlan };

function issuerMismatchError(): Error {
  return badRequest(HEBREW_RECURRING_ISSUER_MISMATCH, 'INCOME_RECURRING_ISSUER_SCOPE_MISMATCH');
}

async function loadTrustedRecurringIssueGraph(params: {
  orgId: string;
  draftId: string;
  review: RecurringCycleReviewCommandContext;
}): Promise<{
  profileClientId: string;
  draft: {
    id: string;
    organization_id: string;
    represented_client_id: string | null;
    issuer_business_id: string;
    status: string;
  };
}> {
  const profileId = reqUuid(params.review.profile_id, 'profile_id');
  const cycleId = reqUuid(params.review.cycle_id, 'cycle_id');
  const generatedDraftId = reqUuid(params.review.generated_draft_id, 'generated_draft_id');
  const refClientId = reqUuid(params.review.represented_client_id, 'represented_client_id');

  if (params.draftId !== generatedDraftId) {
    throw issuerMismatchError();
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('income_recurring_document_profiles')
    .select('id, organization_id, represented_client_id')
    .eq('organization_id', params.orgId)
    .eq('id', profileId)
    .maybeSingle();
  throwIfSupabaseError(profileErr, 'loadRecurringProfileForIssueIssuerScope');
  if (!profile) throw notFound('Recurring profile not found');
  const profileClientId = String(
    (profile as { represented_client_id: string }).represented_client_id,
  );
  if (profileClientId !== refClientId) {
    throw issuerMismatchError();
  }

  const { data: cycle, error: cycleErr } = await supabaseAdmin
    .from('income_recurring_document_cycles')
    .select('id, recurring_profile_id, generated_draft_id')
    .eq('organization_id', params.orgId)
    .eq('id', cycleId)
    .eq('recurring_profile_id', profileId)
    .maybeSingle();
  throwIfSupabaseError(cycleErr, 'loadRecurringCycleForIssueIssuerScope');
  if (!cycle) throw notFound('Recurring cycle not found');
  const cycleGeneratedDraftId =
    (cycle as { generated_draft_id: string | null }).generated_draft_id ?? null;
  if (cycleGeneratedDraftId !== generatedDraftId) {
    throw issuerMismatchError();
  }

  const { data: draft, error: draftErr } = await supabaseAdmin
    .from('income_document_drafts')
    .select('id, organization_id, represented_client_id, issuer_business_id, status')
    .eq('organization_id', params.orgId)
    .eq('id', generatedDraftId)
    .maybeSingle();
  throwIfSupabaseError(draftErr, 'loadDraftForIssueIssuerScope');
  if (!draft) throw notFound('Income document draft not found');

  return {
    profileClientId,
    draft: draft as {
      id: string;
      organization_id: string;
      represented_client_id: string | null;
      issuer_business_id: string;
      status: string;
    },
  };
}

async function repairDraftIssuerIdentityIfNeeded(params: {
  orgId: string;
  actorUserId: string;
  draft: {
    id: string;
    represented_client_id: string | null;
    issuer_business_id: string;
  };
  profileClientId: string;
}): Promise<{ represented_client_id: string; issuer_business_id: string }> {
  const plan = resolveDraftIssuerRepairPlan({
    profileClientId: params.profileClientId,
    draftRepresentedClientId: params.draft.represented_client_id,
    draftIssuerBusinessId: params.draft.issuer_business_id,
  });
  if (plan.kind === 'reject') throw issuerMismatchError();
  if (plan.kind === 'ok') {
    return {
      represented_client_id: plan.represented_client_id,
      issuer_business_id: plan.issuer_business_id,
    };
  }

  const { error } = await supabaseAdmin
    .from('income_document_drafts')
    .update({
      represented_client_id: plan.represented_client_id,
      issuer_business_id: plan.issuer_business_id,
      acting_mode: 'office_representative',
    })
    .eq('organization_id', params.orgId)
    .eq('id', params.draft.id);
  throwIfSupabaseError(error, 'repairDraftIssuerIdentityForRecurringIssue');

  await writeAudit({
    organizationId: params.orgId,
    actorUserId: params.actorUserId,
    moduleCode: 'income',
    entityType: 'income_document_draft',
    entityId: params.draft.id,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_DRAFT_UPDATED,
    payload: {
      action: 'repair_recurring_issue_issuer_identity',
      previous_represented_client_id: params.draft.represented_client_id,
      previous_issuer_business_id: params.draft.issuer_business_id,
      represented_client_id: plan.represented_client_id,
      issuer_business_id: plan.issuer_business_id,
    },
  });

  return {
    represented_client_id: plan.represented_client_id,
    issuer_business_id: plan.issuer_business_id,
  };
}

/**
 * When recurring_cycle_review is present: validate trusted graph, repair draft if safe,
 * apply official office issuer context, return refreshed ActiveIncomeIssuerScope.
 */
export async function resolveAndApplyRecurringCycleIssueIssuerScope(
  ctx: RequestContext,
  params: {
    draftId: string;
    review: RecurringCycleReviewCommandContext;
  },
): Promise<ActiveIncomeIssuerScope> {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Organization context required');
  if (!ctx.user?.id) throw forbidden('Actor required');

  const graph = await loadTrustedRecurringIssueGraph({
    orgId,
    draftId: params.draftId,
    review: params.review,
  });

  const identity = await repairDraftIssuerIdentityIfNeeded({
    orgId,
    actorUserId: ctx.user.id,
    draft: graph.draft,
    profileClientId: graph.profileClientId,
  });

  await applyOfficialIncomeIssuerContext(
    ctx,
    {
      acting_mode: 'office_representative',
      issuer_business_id: identity.issuer_business_id,
      represented_client_id: identity.represented_client_id,
    },
    { source: 'recurring_cycle_issue_issuer_resolve' },
  );

  return loadActiveIncomeIssuerScope(ctx);
}

async function loadTrustedDraftForIssuerResolve(params: {
  orgId: string;
  draftId: string;
}): Promise<{
  id: string;
  represented_client_id: string | null;
  issuer_business_id: string;
} | null> {
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select('id, represented_client_id, issuer_business_id')
    .eq('organization_id', params.orgId)
    .eq('id', params.draftId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadTrustedDraftForIssuerResolve');
  if (!data) return null;
  return data as {
    id: string;
    represented_client_id: string | null;
    issuer_business_id: string;
  };
}

/**
 * Resolve authoritative represented-client identity for an office draft.
 * Prefer linked recurring cycle/profile when the draft is cycle-generated;
 * otherwise use the draft's own org-scoped identity.
 */
async function resolveAuthoritativeOfficeClientIdForDraft(params: {
  orgId: string;
  draft: {
    id: string;
    represented_client_id: string | null;
    issuer_business_id: string;
  };
}): Promise<string> {
  const { data: cycle, error: cycleErr } = await supabaseAdmin
    .from('income_recurring_document_cycles')
    .select('id, recurring_profile_id, generated_draft_id')
    .eq('organization_id', params.orgId)
    .eq('generated_draft_id', params.draft.id)
    .maybeSingle();
  throwIfSupabaseError(cycleErr, 'loadCycleByGeneratedDraftForIssuerResolve');

  if (cycle) {
    const profileId = String((cycle as { recurring_profile_id: string }).recurring_profile_id);
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('income_recurring_document_profiles')
      .select('id, represented_client_id')
      .eq('organization_id', params.orgId)
      .eq('id', profileId)
      .maybeSingle();
    throwIfSupabaseError(profileErr, 'loadProfileForGeneratedDraftIssuerResolve');
    if (!profile) throw notFound('Recurring profile not found');
    return String((profile as { represented_client_id: string }).represented_client_id);
  }

  const draftRep = params.draft.represented_client_id;
  if (draftRep) return draftRep;
  // Office-shaped issuer without represented: only accept when issuer is a client id that we can authorize.
  if (params.draft.issuer_business_id) return params.draft.issuer_business_id;
  throw issuerMismatchError();
}

/**
 * Wizard / ordinary issue path: when the trusted draft is office-scoped, apply official
 * office issuer context from draft (+ cycle/profile if linked) so a stale workspace
 * self/other-client mode cannot block authorized issue.
 *
 * Self drafts (no represented client and no linked cycle) are left unchanged —
 * they continue to use the active Income issuer scope.
 */
export async function resolveAndApplyIssuerScopeFromTrustedOfficeDraftIfNeeded(
  ctx: RequestContext,
  params: { draftId: string },
): Promise<ActiveIncomeIssuerScope | null> {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Organization context required');
  if (!ctx.user?.id) throw forbidden('Actor required');

  const draft = await loadTrustedDraftForIssuerResolve({
    orgId,
    draftId: params.draftId,
  });
  if (!draft) throw notFound('Income document draft not found');

  const { data: linkedCycle } = await supabaseAdmin
    .from('income_recurring_document_cycles')
    .select('id')
    .eq('organization_id', orgId)
    .eq('generated_draft_id', draft.id)
    .maybeSingle();

  // Self drafts use the org issuer profile id. Anything else (client id / cycle draft)
  // is office-shaped even when represented_client_id was left null by a legacy generator.
  const orgIssuer = await ensureOrgIncomeIssuerProfile(orgId);
  const isOfficeDraft =
    draft.represented_client_id != null ||
    linkedCycle != null ||
    draft.issuer_business_id !== orgIssuer.id;
  if (!isOfficeDraft) {
    return null;
  }

  const profileClientId = await resolveAuthoritativeOfficeClientIdForDraft({
    orgId,
    draft,
  });

  const identity = await repairDraftIssuerIdentityIfNeeded({
    orgId,
    actorUserId: ctx.user.id,
    draft,
    profileClientId,
  });

  await applyOfficialIncomeIssuerContext(
    ctx,
    {
      acting_mode: 'office_representative',
      issuer_business_id: identity.issuer_business_id,
      represented_client_id: identity.represented_client_id,
    },
    { source: 'trusted_office_draft_issue_issuer_resolve' },
  );

  return loadActiveIncomeIssuerScope(ctx);
}

/** Trusted cycle+profile refs for a generated draft (wizard issue without FE review payload). */
export async function loadRecurringCycleReviewRefsByGeneratedDraft(params: {
  orgId: string;
  draftId: string;
}): Promise<RecurringCycleReviewCommandContext | null> {
  const { data: cycle, error: cycleErr } = await supabaseAdmin
    .from('income_recurring_document_cycles')
    .select('id, recurring_profile_id, generated_draft_id')
    .eq('organization_id', params.orgId)
    .eq('generated_draft_id', params.draftId)
    .maybeSingle();
  throwIfSupabaseError(cycleErr, 'loadCycleByGeneratedDraftForIssueCase');
  if (!cycle) return null;
  const profileId = String((cycle as { recurring_profile_id: string }).recurring_profile_id);
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('income_recurring_document_profiles')
    .select('id, represented_client_id')
    .eq('organization_id', params.orgId)
    .eq('id', profileId)
    .maybeSingle();
  throwIfSupabaseError(profileErr, 'loadProfileByGeneratedDraftForIssueCase');
  if (!profile) return null;
  return {
    represented_client_id: String((profile as { represented_client_id: string }).represented_client_id),
    profile_id: profileId,
    cycle_id: String((cycle as { id: string }).id),
    generated_draft_id: params.draftId,
  };
}

/**
 * Prepare official office issuer context for cycle draft review open/refresh
 * (same official Income write path; issue remains independently secure).
 */
export async function applyOfficialOfficeIssuerContextForRepresentedClient(
  ctx: RequestContext,
  representedClientId: string,
  source: string,
): Promise<void> {
  await applyOfficialIncomeIssuerContext(
    ctx,
    {
      acting_mode: 'office_representative',
      issuer_business_id: representedClientId,
      represented_client_id: representedClientId,
    },
    { source },
  );
}

/**
 * Safe draft identity repair + official office issuer prepare for review open/refresh.
 * Does not trust frontend issuer ids; uses validated represented client from cycle/profile refs.
 */
export async function prepareRecurringCycleReviewIssuerScope(
  ctx: RequestContext,
  params: {
    representedClientId: string;
    draft: {
      id: string;
      represented_client_id: string | null;
      issuer_business_id: string;
    };
    source: string;
  },
): Promise<void> {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Organization context required');
  if (!ctx.user?.id) throw forbidden('Actor required');

  await repairDraftIssuerIdentityIfNeeded({
    orgId,
    actorUserId: ctx.user.id,
    draft: params.draft,
    profileClientId: params.representedClientId,
  });

  await applyOfficialOfficeIssuerContextForRepresentedClient(
    ctx,
    params.representedClientId,
    params.source,
  );
}

export async function buildRecurringCycleIssuerContextTruth(params: {
  orgId: string;
  representedClientId: string;
}): Promise<RecurringCycleIssueIssuerContextTruth> {
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, legal_name, is_archived')
    .eq('organization_id', params.orgId)
    .eq('id', params.representedClientId)
    .maybeSingle();
  const row = client as {
    id: string;
    display_name: string;
    legal_name: string | null;
    is_archived: boolean;
  } | null;
  const orgIssuer = await ensureOrgIncomeIssuerProfile(params.orgId);
  const label = resolveIncomeIssuerBusinessDisplay({
    acting_mode: 'office_representative',
    orgIssuerProfile: orgIssuer,
    client: row,
  });
  return {
    represented_client_id: params.representedClientId,
    issuer_business_id: params.representedClientId,
    acting_mode: 'office_representative',
    label,
  };
}
