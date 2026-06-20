/**
 * Retainer recurring document cycles — persistence for child draft/document history.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
export const RECURRING_CYCLE_STATUS_LABELS = {
    pending: 'ממתין',
    draft_created: 'טיוטה נוצרה',
    issued: 'הופק',
    cancelled: 'בוטל',
    failed: 'נכשל',
};
async function nextCycleNumber(orgId, profileId) {
    const { data, error } = await supabaseAdmin
        .from('income_recurring_document_cycles')
        .select('cycle_number')
        .eq('organization_id', orgId)
        .eq('recurring_profile_id', profileId)
        .order('cycle_number', { ascending: false })
        .limit(1)
        .maybeSingle();
    throwIfSupabaseError(error, 'loadRecurringCycleNumber');
    const current = Number(data?.cycle_number ?? 0);
    return current + 1;
}
async function findCycleByScheduledDate(orgId, profileId, scheduledDocumentDate) {
    const { data, error } = await supabaseAdmin
        .from('income_recurring_document_cycles')
        .select('id, cycle_number, scheduled_document_date, draft_creation_date, generated_draft_id, generated_document_id, status, failure_reason')
        .eq('organization_id', orgId)
        .eq('recurring_profile_id', profileId)
        .eq('scheduled_document_date', scheduledDocumentDate)
        .maybeSingle();
    throwIfSupabaseError(error, 'loadRecurringCycleByDate');
    return data ?? null;
}
export async function recordRecurringCycleDraftCreated(params) {
    const existing = await findCycleByScheduledDate(params.organizationId, params.recurringProfileId, params.scheduledDocumentDate);
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
        const cycleId = String(data.id);
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
    const cycleId = String(data.id);
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
export async function recordRecurringCycleFailed(params) {
    const failureReason = params.failureReason.slice(0, 2000);
    const existing = await findCycleByScheduledDate(params.organizationId, params.recurringProfileId, params.scheduledDocumentDate);
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
        const row = data;
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
    const cycleId = String(data.id);
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
export async function loadRecurringProfileCycles(orgId, profileId) {
    const { data, error } = await supabaseAdmin
        .from('income_recurring_document_cycles')
        .select('id, cycle_number, scheduled_document_date, draft_creation_date, generated_draft_id, generated_document_id, status, failure_reason')
        .eq('organization_id', orgId)
        .eq('recurring_profile_id', profileId)
        .order('cycle_number', { ascending: false })
        .limit(200);
    throwIfSupabaseError(error, 'loadRecurringProfileCycles');
    return (data ?? []);
}
export async function loadDocumentNumbersById(orgId, documentIds) {
    const map = new Map();
    if (documentIds.length === 0)
        return map;
    const { data, error } = await supabaseAdmin
        .from('income_documents')
        .select('id, document_number')
        .eq('organization_id', orgId)
        .in('id', documentIds);
    throwIfSupabaseError(error, 'loadRecurringCycleDocumentNumbers');
    for (const row of data ?? []) {
        const r = row;
        if (r.document_number)
            map.set(r.id, r.document_number);
    }
    return map;
}
export async function linkRecurringCycleIssuedDocument(params) {
    const { data, error } = await supabaseAdmin
        .from('income_recurring_document_cycles')
        .select('id, recurring_profile_id')
        .eq('organization_id', params.organizationId)
        .eq('generated_draft_id', params.draftId)
        .maybeSingle();
    throwIfSupabaseError(error, 'loadRecurringCycleForIssueLink');
    const row = data;
    if (!row)
        return;
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
