/**
 * INV-1 P9 — Work Engine consumption of Income document-sent facts.
 *
 * Completes matching recurring_document_send_followup work items when Income
 * emits income.document_sent_by_email / income.document_sent_by_docflow.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { matchesRecurringSendFollowupWorkItem } from './work-engine-income-document-sent-fact.pure.js';
import { RECURRING_SEND_FOLLOWUP_WORK_TYPE, recurringProfileWorkPeriodKey, } from './work-engine-invoice-retainer.pure.js';
async function loadRetainerCyclesForIncomeDocument(params) {
    const byDocument = await supabaseAdmin
        .from('income_recurring_document_cycles')
        .select('id, recurring_profile_id, scheduled_document_date, generated_draft_id, generated_document_id')
        .eq('organization_id', params.orgId)
        .eq('generated_document_id', params.incomeDocumentId);
    throwIfSupabaseError(byDocument.error, 'loadRetainerCyclesByDocument');
    const cycles = new Map();
    for (const row of (byDocument.data ?? [])) {
        cycles.set(row.id, row);
    }
    const { data: documentRow, error: documentErr } = await supabaseAdmin
        .from('income_documents')
        .select('source_draft_id')
        .eq('organization_id', params.orgId)
        .eq('id', params.incomeDocumentId)
        .maybeSingle();
    throwIfSupabaseError(documentErr, 'loadIncomeDocumentSourceDraft');
    const sourceDraftId = documentRow
        ?.source_draft_id;
    if (sourceDraftId) {
        const byDraft = await supabaseAdmin
            .from('income_recurring_document_cycles')
            .select('id, recurring_profile_id, scheduled_document_date, generated_draft_id, generated_document_id')
            .eq('organization_id', params.orgId)
            .eq('generated_draft_id', sourceDraftId);
        throwIfSupabaseError(byDraft.error, 'loadRetainerCyclesByDraft');
        for (const row of (byDraft.data ?? [])) {
            cycles.set(row.id, row);
        }
    }
    return [...cycles.values()];
}
export async function findActiveRecurringSendFollowupWorkItem(params) {
    const periodKey = recurringProfileWorkPeriodKey(params.recurringProfileId, params.scheduledDocumentDate);
    const { data, error } = await supabaseAdmin
        .from('work_items')
        .select('*')
        .eq('org_id', params.orgId)
        .eq('client_id', params.clientId)
        .eq('module_key', 'income')
        .eq('work_type', RECURRING_SEND_FOLLOWUP_WORK_TYPE)
        .eq('period_key', periodKey)
        .not('work_state', 'in', '(done,archived)')
        .maybeSingle();
    if (error)
        throw error;
    const row = data ?? null;
    if (row &&
        !matchesRecurringSendFollowupWorkItem(row, {
            recurringProfileId: params.recurringProfileId,
            periodKey,
        })) {
        return null;
    }
    return row;
}
export async function completeRecurringDocumentSendFollowupWorkItem(params) {
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
export async function consumeIncomeDocumentSentFact(params) {
    const cycles = await loadRetainerCyclesForIncomeDocument({
        orgId: params.orgId,
        incomeDocumentId: params.incomeDocumentId,
    });
    let completedWorkItemId = null;
    let followupCompleted = false;
    for (const cycle of cycles) {
        const periodKey = recurringProfileWorkPeriodKey(cycle.recurring_profile_id, cycle.scheduled_document_date);
        const followupItem = await findActiveRecurringSendFollowupWorkItem({
            orgId: params.orgId,
            clientId: params.clientId,
            recurringProfileId: cycle.recurring_profile_id,
            scheduledDocumentDate: cycle.scheduled_document_date,
        });
        if (!followupItem)
            continue;
        const completed = await completeRecurringDocumentSendFollowupWorkItem({
            orgId: params.orgId,
            workItem: followupItem,
            actorUserId: params.actorUserId,
            reasonCode: 'recurring_document_send_followup_completed',
            metadata: {
                recurring_profile_id: cycle.recurring_profile_id,
                cycle_id: cycle.id,
                income_document_id: params.incomeDocumentId,
                draft_id: cycle.generated_draft_id,
                period_key: periodKey,
                event_id: params.eventId,
                event_type: params.eventType,
                channel: params.payload.channel ?? null,
                delivery_attempt_id: params.payload.delivery_attempt_id ?? null,
            },
        });
        completedWorkItemId = completed.id;
        if (followupItem.work_state !== 'done' && followupItem.work_state !== 'archived') {
            followupCompleted = true;
        }
        break;
    }
    return {
        completedWorkItemId,
        processingOutcome: 'income_document_sent_fact_consumed',
        cyclesMatched: cycles.length,
        followupCompleted,
    };
}
