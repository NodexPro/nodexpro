/**
 * Retainer recurring document cycles — persistence for child draft/document history.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';

export type RecurringCycleStatus =
  | 'pending'
  | 'draft_created'
  | 'issued'
  | 'cancelled'
  | 'failed';

export const RECURRING_CYCLE_STATUS_LABELS: Record<RecurringCycleStatus, string> = {
  pending: 'ממתין',
  draft_created: 'טיוטה נוצרה',
  issued: 'הופק',
  cancelled: 'בוטל',
  failed: 'נכשל',
};

type RawCycleRow = {
  id: string;
  cycle_number: number;
  scheduled_document_date: string;
  draft_creation_date: string;
  generated_draft_id: string | null;
  generated_document_id: string | null;
  status: RecurringCycleStatus;
  failure_reason: string | null;
};

async function nextCycleNumber(orgId: string, profileId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('income_recurring_document_cycles')
    .select('cycle_number')
    .eq('organization_id', orgId)
    .eq('recurring_profile_id', profileId)
    .order('cycle_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadRecurringCycleNumber');
  const current = Number((data as { cycle_number?: number } | null)?.cycle_number ?? 0);
  return current + 1;
}

async function findCycleByScheduledDate(
  orgId: string,
  profileId: string,
  scheduledDocumentDate: string,
): Promise<RawCycleRow | null> {
  const { data, error } = await supabaseAdmin
    .from('income_recurring_document_cycles')
    .select(
      'id, cycle_number, scheduled_document_date, draft_creation_date, generated_draft_id, generated_document_id, status, failure_reason',
    )
    .eq('organization_id', orgId)
    .eq('recurring_profile_id', profileId)
    .eq('scheduled_document_date', scheduledDocumentDate)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadRecurringCycleByDate');
  return (data as RawCycleRow | null) ?? null;
}

export async function recordRecurringCycleDraftCreated(params: {
  organizationId: string;
  recurringProfileId: string;
  scheduledDocumentDate: string;
  draftCreationDate: string;
  generatedDraftId: string;
}): Promise<string> {
  const existing = await findCycleByScheduledDate(
    params.organizationId,
    params.recurringProfileId,
    params.scheduledDocumentDate,
  );

  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('income_recurring_document_cycles')
      .update({
        status: 'draft_created',
        generated_draft_id: params.generatedDraftId,
        failure_reason: null,
        draft_creation_date: params.draftCreationDate,
      })
      .eq('id', existing.id)
      .eq('organization_id', params.organizationId)
      .select('id')
      .single();
    throwIfSupabaseError(error, 'updateRecurringCycleDraftCreated');
    const cycleId = String((data as { id: string }).id);

    await writeAudit({
      organizationId: params.organizationId,
      actorUserId: null,
      moduleCode: 'work_engine',
      entityType: 'income_recurring_document_cycle',
      entityId: cycleId,
      action: AUDIT_ACTIONS.INCOME_RECURRING_PROFILE_CYCLE_CREATED,
      payload: {
        recurring_profile_id: params.recurringProfileId,
        cycle_number: existing.cycle_number,
        scheduled_document_date: params.scheduledDocumentDate,
        draft_creation_date: params.draftCreationDate,
        generated_draft_id: params.generatedDraftId,
        status: 'draft_created',
      },
    });

    return cycleId;
  }

  const cycleNumber = await nextCycleNumber(params.organizationId, params.recurringProfileId);
  const { data, error } = await supabaseAdmin
    .from('income_recurring_document_cycles')
    .insert({
      organization_id: params.organizationId,
      recurring_profile_id: params.recurringProfileId,
      cycle_number: cycleNumber,
      scheduled_document_date: params.scheduledDocumentDate,
      draft_creation_date: params.draftCreationDate,
      generated_draft_id: params.generatedDraftId,
      status: 'draft_created',
    })
    .select('id')
    .single();
  throwIfSupabaseError(error, 'insertRecurringCycleDraftCreated');
  const cycleId = String((data as { id: string }).id);

  await writeAudit({
    organizationId: params.organizationId,
    actorUserId: null,
    moduleCode: 'work_engine',
    entityType: 'income_recurring_document_cycle',
    entityId: cycleId,
    action: AUDIT_ACTIONS.INCOME_RECURRING_PROFILE_CYCLE_CREATED,
    payload: {
      recurring_profile_id: params.recurringProfileId,
      cycle_number: cycleNumber,
      scheduled_document_date: params.scheduledDocumentDate,
      draft_creation_date: params.draftCreationDate,
      generated_draft_id: params.generatedDraftId,
      status: 'draft_created',
    },
  });

  return cycleId;
}

export async function recordRecurringCycleFailed(params: {
  organizationId: string;
  recurringProfileId: string;
  scheduledDocumentDate: string;
  draftCreationDate: string;
  failureReason: string;
}): Promise<string> {
  const failureReason = params.failureReason.slice(0, 2000);
  const existing = await findCycleByScheduledDate(
    params.organizationId,
    params.recurringProfileId,
    params.scheduledDocumentDate,
  );

  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('income_recurring_document_cycles')
      .update({
        status: 'failed',
        failure_reason: failureReason,
        draft_creation_date: params.draftCreationDate,
      })
      .eq('id', existing.id)
      .eq('organization_id', params.organizationId)
      .select('id, cycle_number')
      .single();
    throwIfSupabaseError(error, 'updateRecurringCycleFailed');
    const row = data as { id: string; cycle_number: number };
    const cycleId = String(row.id);

    await writeAudit({
      organizationId: params.organizationId,
      actorUserId: null,
      moduleCode: 'work_engine',
      entityType: 'income_recurring_document_cycle',
      entityId: cycleId,
      action: AUDIT_ACTIONS.INCOME_RECURRING_PROFILE_CYCLE_FAILED,
      payload: {
        recurring_profile_id: params.recurringProfileId,
        cycle_number: row.cycle_number,
        scheduled_document_date: params.scheduledDocumentDate,
        draft_creation_date: params.draftCreationDate,
        failure_reason: failureReason,
        status: 'failed',
      },
    });

    return cycleId;
  }

  const cycleNumber = await nextCycleNumber(params.organizationId, params.recurringProfileId);
  const { data, error } = await supabaseAdmin
    .from('income_recurring_document_cycles')
    .insert({
      organization_id: params.organizationId,
      recurring_profile_id: params.recurringProfileId,
      cycle_number: cycleNumber,
      scheduled_document_date: params.scheduledDocumentDate,
      draft_creation_date: params.draftCreationDate,
      status: 'failed',
      failure_reason: failureReason,
    })
    .select('id')
    .single();
  throwIfSupabaseError(error, 'insertRecurringCycleFailed');
  const cycleId = String((data as { id: string }).id);

  await writeAudit({
    organizationId: params.organizationId,
    actorUserId: null,
    moduleCode: 'work_engine',
    entityType: 'income_recurring_document_cycle',
    entityId: cycleId,
    action: AUDIT_ACTIONS.INCOME_RECURRING_PROFILE_CYCLE_FAILED,
    payload: {
      recurring_profile_id: params.recurringProfileId,
      cycle_number: cycleNumber,
      scheduled_document_date: params.scheduledDocumentDate,
      draft_creation_date: params.draftCreationDate,
      failure_reason: failureReason,
      status: 'failed',
    },
  });

  return cycleId;
}

export async function loadRecurringProfileCycles(
  orgId: string,
  profileId: string,
): Promise<RawCycleRow[]> {
  const { data, error } = await supabaseAdmin
    .from('income_recurring_document_cycles')
    .select(
      'id, cycle_number, scheduled_document_date, draft_creation_date, generated_draft_id, generated_document_id, status, failure_reason',
    )
    .eq('organization_id', orgId)
    .eq('recurring_profile_id', profileId)
    .order('cycle_number', { ascending: false })
    .limit(200);
  throwIfSupabaseError(error, 'loadRecurringProfileCycles');
  return (data ?? []) as RawCycleRow[];
}

export async function loadDocumentNumbersById(
  orgId: string,
  documentIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (documentIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select('id, document_number')
    .eq('organization_id', orgId)
    .in('id', documentIds);
  throwIfSupabaseError(error, 'loadRecurringCycleDocumentNumbers');

  for (const row of data ?? []) {
    const r = row as { id: string; document_number: string | null };
    if (r.document_number) map.set(r.id, r.document_number);
  }
  return map;
}

export async function linkRecurringCycleIssuedDocument(params: {
  organizationId: string;
  draftId: string;
  issuedDocumentId: string;
}): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('income_recurring_document_cycles')
    .select('id, recurring_profile_id')
    .eq('organization_id', params.organizationId)
    .eq('generated_draft_id', params.draftId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadRecurringCycleForIssueLink');
  const row = data as { id: string; recurring_profile_id: string } | null;
  if (!row) return;

  const { error: cycleErr } = await supabaseAdmin
    .from('income_recurring_document_cycles')
    .update({
      status: 'issued',
      generated_document_id: params.issuedDocumentId,
      failure_reason: null,
    })
    .eq('id', row.id)
    .eq('organization_id', params.organizationId);
  throwIfSupabaseError(cycleErr, 'linkRecurringCycleIssuedDocument');

  await supabaseAdmin
    .from('income_recurring_document_profiles')
    .update({ last_generated_document_id: params.issuedDocumentId })
    .eq('id', row.recurring_profile_id)
    .eq('organization_id', params.organizationId);
}

export type { RawCycleRow };
