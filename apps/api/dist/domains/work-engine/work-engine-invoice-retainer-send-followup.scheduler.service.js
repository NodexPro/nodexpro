/**
 * Retainer send-follow-up scheduler — approved drafts not delivered after grace period.
 */
import { supabaseAdmin } from '../../db/client.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { emitRecurringDocumentSendFollowupDueWorkEvent } from './work-engine-invoice-retainer-bridge.js';
import { hasRecurringDocumentDeliveryRecord } from './work-engine-invoice-retainer-delivery.read.js';
import { isRecurringSendFollowupDue } from './work-engine-invoice-retainer-lifecycle.pure.js';
import { RECURRING_SEND_FOLLOWUP_WORK_TYPE, recurringProfileWorkPeriodKey, } from './work-engine-invoice-retainer.pure.js';
const DEFAULT_BATCH_SIZE = 50;
function resolveCycleProfile(row) {
    const profile = row.income_recurring_document_profiles;
    if (Array.isArray(profile))
        return profile[0];
    return profile;
}
export async function scanRecurringDocumentSendFollowupsForOrg(params) {
    const nowIso = params.nowIso ?? new Date().toISOString();
    const batchSize = params.batchSize ?? DEFAULT_BATCH_SIZE;
    const summary = {
        cycles_scanned: 0,
        followups_emitted: 0,
    };
    const { data, error } = await supabaseAdmin
        .from('income_recurring_document_cycles')
        .select(`
      id,
      organization_id,
      recurring_profile_id,
      scheduled_document_date,
      generated_draft_id,
      generated_document_id,
      approved_at,
      income_recurring_document_profiles!inner (
        represented_client_id,
        end_customer_id
      )
    `)
        .eq('organization_id', params.orgId)
        .not('approved_at', 'is', null)
        .not('status', 'in', '(cancelled,failed)')
        .order('approved_at', { ascending: true })
        .limit(batchSize);
    throwIfSupabaseError(error, 'loadApprovedCyclesForSendFollowup');
    const rows = (data ?? []);
    summary.cycles_scanned = rows.length;
    for (const row of rows) {
        const profile = resolveCycleProfile(row);
        const hasDelivery = await hasRecurringDocumentDeliveryRecord({
            organizationId: params.orgId,
            representedClientId: profile.represented_client_id,
            generatedDraftId: row.generated_draft_id,
            generatedDocumentId: row.generated_document_id,
        });
        if (!isRecurringSendFollowupDue({
            approvedAtIso: row.approved_at,
            nowIso,
            hasDeliveryRecord: hasDelivery,
        })) {
            continue;
        }
        const alreadyTracked = await hasSendFollowupWorkItemForCycle({
            orgId: params.orgId,
            clientId: profile.represented_client_id,
            recurringProfileId: row.recurring_profile_id,
            scheduledDocumentDate: row.scheduled_document_date,
        });
        if (alreadyTracked)
            continue;
        if (!row.generated_draft_id)
            continue;
        if (params.dryRun) {
            summary.followups_emitted += 1;
            continue;
        }
        const intake = await emitRecurringDocumentSendFollowupDueWorkEvent({
            ctx: params.schedulerCtx,
            organizationId: params.orgId,
            representedClientId: profile.represented_client_id,
            endCustomerId: profile.end_customer_id,
            recurringProfileId: row.recurring_profile_id,
            draftId: row.generated_draft_id,
            scheduledDocumentDate: row.scheduled_document_date,
            cycleId: row.id,
            approvedAt: row.approved_at,
            reasonCode: 'document_not_sent_after_approval',
        });
        if (intake?.work_item_id)
            summary.followups_emitted += 1;
    }
    return summary;
}
async function hasSendFollowupWorkItemForCycle(params) {
    const periodKey = recurringProfileWorkPeriodKey(params.recurringProfileId, params.scheduledDocumentDate);
    const { data, error } = await supabaseAdmin
        .from('work_items')
        .select('id')
        .eq('org_id', params.orgId)
        .eq('client_id', params.clientId)
        .eq('module_key', 'income')
        .eq('work_type', RECURRING_SEND_FOLLOWUP_WORK_TYPE)
        .eq('period_key', periodKey)
        .limit(1);
    if (error)
        throw error;
    return (data ?? []).length > 0;
}
