/**
 * Work Engine reminder candidate generation (Stage 10 Phase 3B-2).
 * All reminder generation logic for tenant commands lives here only.
 */
import { supabaseAdmin } from '../../db/client.js';
import { businessYmd } from '../../shared/business-time.js';
import { badRequest } from '../../shared/errors.js';
import { resolveOperationalCommunicationPolicies } from '../country-pack/operational-communication-policy.service.js';
import { renderReminderTemplate, } from '../country-pack/operational-communication-owner-payload.js';
import { assertResolvedReminderPolicy, buildReminderCandidateDedupKey, resolveCadenceStepFromWorkflow, resolveChannelOrder, resolveReminderTarget, resolveWorkflowFromPolicy, selectTemplateVersion, } from './work-engine.reminder.logic.js';
export { buildReminderCandidateDedupKey, parseGenerateReminderCandidateWorkflowType, resolveCadenceStepFromWorkflow, resolveChannelOrder, resolveReminderTarget, resolveWorkflowFromPolicy, selectTemplateVersion, } from './work-engine.reminder.logic.js';
function humanizeKey(key) {
    return key
        .split(/[_-]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}
function moduleLabel(key) {
    switch (key) {
        case 'payroll':
            return 'Payroll';
        case 'vat':
            return 'VAT';
        case 'annual_report':
            return 'Annual Report';
        case 'income_tax':
            return 'Income Tax';
        case 'national_insurance':
            return 'National Insurance';
        case 'client_obligations':
            return 'Client Obligations';
        case 'docflow':
            return 'DocFlow';
        case 'work_engine':
            return 'Work Engine';
        default:
            return humanizeKey(key);
    }
}
function workTypeLabel(key) {
    switch (key) {
        case 'payroll_document_collection':
            return 'Payroll Documents';
        case 'vat_document_collection':
            return 'VAT Documents';
        case 'annual_report_document_collection':
            return 'Annual Report Documents';
        case 'docflow_thread_followup':
            return 'Conversation';
        default:
            return humanizeKey(key);
    }
}
function slaStatusLabel(status) {
    switch (status) {
        case 'none':
            return 'No SLA';
        case 'on_track':
            return 'On track';
        case 'due_soon':
            return 'Due soon';
        case 'overdue':
            return 'Overdue';
        case 'breached':
            return 'Breached';
        default:
            return humanizeKey(status);
    }
}
function formatDueDate(dueAt) {
    if (!dueAt)
        return null;
    const d = new Date(dueAt);
    if (Number.isNaN(d.getTime()))
        return null;
    return businessYmd(d);
}
function buildPortalLink(orgId, workItemId, clientId) {
    return `/portal/orgs/${orgId}/clients/${clientId}/work-items/${workItemId}`;
}
async function loadReminderTemplateContext(orgId, workItem) {
    const clientId = workItem.client_id;
    let clientName = null;
    if (clientId) {
        const { data, error } = await supabaseAdmin
            .from('clients')
            .select('display_name')
            .eq('id', clientId)
            .eq('organization_id', orgId)
            .maybeSingle();
        if (error)
            throw error;
        clientName = data?.display_name?.trim() || clientId;
    }
    const userIds = [workItem.assigned_user_id, workItem.reviewer_user_id].filter((v) => !!v);
    const userNameById = new Map();
    if (userIds.length > 0) {
        const { data, error } = await supabaseAdmin
            .from('users')
            .select('id, full_name, email')
            .in('id', userIds);
        if (error)
            throw error;
        for (const u of data ?? []) {
            userNameById.set(String(u.id), String(u.full_name ?? '').trim() || String(u.email ?? '').trim() || String(u.id));
        }
    }
    const { data: org, error: orgErr } = await supabaseAdmin
        .from('organizations')
        .select('name')
        .eq('id', orgId)
        .maybeSingle();
    if (orgErr)
        throw orgErr;
    const dueDate = formatDueDate(workItem.due_at);
    const portalLink = clientId && workItem.id ? buildPortalLink(orgId, workItem.id, clientId) : null;
    return {
        client_name: clientName,
        assignee_name: workItem.assigned_user_id
            ? userNameById.get(workItem.assigned_user_id) ?? workItem.assigned_user_id
            : null,
        reviewer_name: workItem.reviewer_user_id
            ? userNameById.get(workItem.reviewer_user_id) ?? workItem.reviewer_user_id
            : null,
        work_type_label: workTypeLabel(workItem.work_type),
        module_label: moduleLabel(workItem.module_key),
        period_key: workItem.period_key,
        sla_status_label: slaStatusLabel(workItem.sla_status),
        due_date: dueDate,
        portal_link: portalLink,
        office_name: org?.name?.trim() || orgId,
    };
}
async function findExistingCandidateByDedup(orgId, dedupKey) {
    const { data, error } = await supabaseAdmin
        .from('work_reminder_candidates')
        .select('id')
        .eq('org_id', orgId)
        .eq('dedup_key', dedupKey)
        .maybeSingle();
    if (error)
        throw error;
    return data ? { id: String(data.id) } : null;
}
export async function generateReminderCandidate(params) {
    const workflowType = params.workflowType;
    const stepKey = params.stepKey.trim();
    if (!stepKey)
        throw badRequest('step_key is required');
    const asOfDate = businessYmd(new Date());
    const resolved = await resolveOperationalCommunicationPolicies(params.orgId, asOfDate);
    assertResolvedReminderPolicy(resolved);
    const policy = resolved.active_reminder_policy;
    const workflow = resolveWorkflowFromPolicy(policy, workflowType);
    const cadenceStep = resolveCadenceStepFromWorkflow(workflow, stepKey);
    const channelOrder = resolveChannelOrder(policy, cadenceStep);
    const primaryChannel = channelOrder[0];
    const templateVersion = selectTemplateVersion(resolved, cadenceStep.template_key, primaryChannel);
    const templateContext = await loadReminderTemplateContext(params.orgId, params.workItem);
    const rendered = renderReminderTemplate(templateVersion.payload, templateContext);
    const target = resolveReminderTarget(workflowType, params.workItem);
    const dedupKey = buildReminderCandidateDedupKey({
        workItemId: params.workItem.id,
        workflowType,
        stepKey,
    });
    const existing = await findExistingCandidateByDedup(params.orgId, dedupKey);
    if (existing) {
        return { candidateId: existing.id, created: false, dedupHit: true };
    }
    const triggerType = (params.triggerType ?? 'manual_command').trim() || 'manual_command';
    const slaSnapshot = {
        work_state: params.workItem.work_state,
        sla_status: params.workItem.sla_status,
        due_at: params.workItem.due_at,
        workflow_type: workflowType,
        step_key: stepKey,
        anchor: workflow.anchor,
        offset_minutes: cadenceStep.offset_minutes,
    };
    const insertResp = await supabaseAdmin
        .from('work_reminder_candidates')
        .insert({
        org_id: params.orgId,
        work_item_id: params.workItem.id,
        country_code: resolved.country_code,
        workflow_type: workflowType,
        trigger_type: triggerType,
        step_key: stepKey,
        policy_version_id: resolved.policy_version_id,
        template_version_id: templateVersion.template_version_id,
        status: 'pending_review',
        channel: primaryChannel,
        channel_order_snapshot: channelOrder,
        target_type: target.target_type,
        target_user_id: target.target_user_id,
        client_id: target.client_id,
        subject: rendered.subject,
        generated_subject: rendered.subject,
        body: rendered.body,
        generated_body: rendered.body,
        suggested_send_at: null,
        sla_context_snapshot: slaSnapshot,
        created_by_system_rule: false,
        dedup_key: dedupKey,
        idempotency_key: null,
    })
        .select('id')
        .single();
    if (insertResp.error) {
        const code = insertResp.error.code;
        if (code === '23505') {
            const raced = await findExistingCandidateByDedup(params.orgId, dedupKey);
            if (raced) {
                return { candidateId: raced.id, created: false, dedupHit: true };
            }
        }
        throw insertResp.error;
    }
    return {
        candidateId: String(insertResp.data.id),
        created: true,
        dedupHit: false,
    };
}
