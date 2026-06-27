/**
 * Retainer recurring document lifecycle — review completion + approval events.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { RECURRING_WORK_ENGINE_ENTITY_TYPE, RECURRING_WORK_TYPE, recurringProfileWorkPeriodKey, } from './work-engine-invoice-retainer.pure.js';
import { matchesRecurringInvoiceReviewWorkItem } from './work-engine-invoice-retainer-lifecycle.pure.js';
import { emitRecurringDocumentApprovedWorkEvent, } from './work-engine-invoice-retainer-bridge.js';
async function loadCycleForApproval(params) {
    let q = supabaseAdmin
        .from('income_recurring_document_cycles')
        .select('id, organization_id, recurring_profile_id, scheduled_document_date, generated_draft_id, generated_document_id, status, approved_at')
        .eq('organization_id', params.orgId)
        .eq('recurring_profile_id', params.profileId);
    if (params.cycleId)
        q = q.eq('id', params.cycleId);
    else if (params.draftId)
        q = q.eq('generated_draft_id', params.draftId);
    else if (params.scheduledDocumentDate) {
        q = q.eq('scheduled_document_date', params.scheduledDocumentDate);
    }
    else {
        throw badRequest('draft_id, scheduled_document_date, or cycle_id is required');
    }
    const { data, error } = await q.maybeSingle();
    throwIfSupabaseError(error, 'loadRecurringCycleForApproval');
    const row = data;
    if (!row)
        throw notFound('Recurring cycle not found');
    if (row.status !== 'draft_created') {
        throw badRequest('Only draft_created cycles can be approved');
    }
    if (!row.generated_draft_id) {
        throw badRequest('Cycle has no generated draft to approve');
    }
    const { data: profile, error: profileErr } = await supabaseAdmin
        .from('income_recurring_document_profiles')
        .select('id, represented_client_id')
        .eq('organization_id', params.orgId)
        .eq('id', params.profileId)
        .eq('represented_client_id', params.representedClientId)
        .maybeSingle();
    throwIfSupabaseError(profileErr, 'loadRecurringProfileForApproval');
    if (!profile)
        throw notFound('Recurring profile not found');
    return row;
}
export async function findActiveRecurringInvoiceReviewWorkItem(params) {
    const periodKey = recurringProfileWorkPeriodKey(params.recurringProfileId, params.scheduledDocumentDate);
    const { data, error } = await supabaseAdmin
        .from('work_items')
        .select('*')
        .eq('org_id', params.orgId)
        .eq('client_id', params.clientId)
        .eq('module_key', 'income')
        .eq('work_type', RECURRING_WORK_TYPE)
        .eq('period_key', periodKey)
        .not('work_state', 'in', '(done,archived)')
        .maybeSingle();
    if (error)
        throw error;
    const row = data ?? null;
    if (row &&
        !matchesRecurringInvoiceReviewWorkItem(row, {
            recurringProfileId: params.recurringProfileId,
            periodKey,
        })) {
        return null;
    }
    return row;
}
export async function completeRecurringInvoiceReviewWorkItem(params) {
    const current = params.workItem;
    if (current.work_state === 'done' || current.work_state === 'archived') {
        return current;
    }
    const newVersion = current.version + 1;
    const { data, error } = await supabaseAdmin
        .from('work_items')
        .update({ work_state: 'done', version: newVersion })
        .eq('org_id', params.orgId)
        .eq('id', current.id)
        .eq('version', current.version)
        .select('*')
        .single();
    if (error)
        throw error;
    const updated = data;
    const { error: transitionErr } = await supabaseAdmin.from('work_transitions').insert({
        org_id: params.orgId,
        work_item_id: current.id,
        from_state: current.work_state,
        to_state: 'done',
        transition_kind: 'automation',
        action_code: params.reasonCode,
        actor_type: params.actorUserId ? 'user' : 'system',
        actor_user_id: params.actorUserId,
        reason_text: null,
        metadata_json: params.metadata,
        expected_version: current.version,
        resulting_version: newVersion,
    });
    if (transitionErr)
        throw transitionErr;
    await writeAudit({
        organizationId: params.orgId,
        actorUserId: params.actorUserId,
        moduleCode: 'work_engine',
        entityType: 'work_item',
        entityId: current.id,
        action: AUDIT_ACTIONS.WORK_ITEM_STATE_CHANGED,
        payload: {
            from_state: current.work_state,
            to_state: 'done',
            reason_code: params.reasonCode,
            ...params.metadata,
        },
    });
    return updated;
}
export async function approveRecurringDocumentDraft(params) {
    const cycle = await loadCycleForApproval({
        orgId: params.orgId,
        profileId: params.profileId,
        representedClientId: params.representedClientId,
        draftId: params.draftId,
        scheduledDocumentDate: params.scheduledDocumentDate,
        cycleId: params.cycleId,
    });
    if (cycle.approved_at) {
        throw badRequest('Recurring cycle was already approved');
    }
    const periodKey = recurringProfileWorkPeriodKey(params.profileId, cycle.scheduled_document_date);
    const reviewItem = await findActiveRecurringInvoiceReviewWorkItem({
        orgId: params.orgId,
        clientId: params.representedClientId,
        recurringProfileId: params.profileId,
        scheduledDocumentDate: cycle.scheduled_document_date,
    });
    let completedWorkItemId = null;
    if (reviewItem) {
        const completed = await completeRecurringInvoiceReviewWorkItem({
            orgId: params.orgId,
            workItem: reviewItem,
            actorUserId: params.ctx.user?.id ?? null,
            reasonCode: 'recurring_draft_review_completed',
            metadata: {
                recurring_profile_id: params.profileId,
                cycle_id: cycle.id,
                draft_id: cycle.generated_draft_id,
                period_key: periodKey,
            },
        });
        completedWorkItemId = completed.id;
    }
    const approvedAt = new Date().toISOString();
    const { error: cycleErr } = await supabaseAdmin
        .from('income_recurring_document_cycles')
        .update({
        approved_at: approvedAt,
        approved_by_user_id: params.ctx.user?.id ?? null,
    })
        .eq('id', cycle.id)
        .eq('organization_id', params.orgId)
        .is('approved_at', null);
    throwIfSupabaseError(cycleErr, 'approveRecurringCycle');
    const { data: profile, error: profileErr } = await supabaseAdmin
        .from('income_recurring_document_profiles')
        .select('end_customer_id')
        .eq('organization_id', params.orgId)
        .eq('id', params.profileId)
        .maybeSingle();
    throwIfSupabaseError(profileErr, 'loadProfileEndCustomer');
    await emitRecurringDocumentApprovedWorkEvent({
        ctx: params.ctx,
        organizationId: params.orgId,
        representedClientId: params.representedClientId,
        endCustomerId: String(profile.end_customer_id),
        recurringProfileId: params.profileId,
        draftId: cycle.generated_draft_id,
        scheduledDocumentDate: cycle.scheduled_document_date,
        cycleId: cycle.id,
        approvedAt,
    });
    await writeAudit({
        organizationId: params.orgId,
        actorUserId: params.ctx.user?.id ?? null,
        moduleCode: 'work_engine',
        entityType: RECURRING_WORK_ENGINE_ENTITY_TYPE,
        entityId: params.profileId,
        action: AUDIT_ACTIONS.INCOME_RECURRING_PROFILE_CYCLE_APPROVED,
        payload: {
            cycle_id: cycle.id,
            draft_id: cycle.generated_draft_id,
            period_key: periodKey,
            work_item_id: completedWorkItemId,
            approved_at: approvedAt,
        },
    });
    return {
        cycle_id: cycle.id,
        work_item_id: completedWorkItemId,
        approved_at: approvedAt,
    };
}
