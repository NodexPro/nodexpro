/**
 * Pure reminder resolution helpers (no DB / config imports — safe for unit tests).
 */
import { badRequest } from '../../shared/errors.js';
import { REMINDER_WORKFLOW_TYPES, } from '../country-pack/operational-communication-owner-payload.js';
import { OWNER_REMINDER_PRESET_PERIODS, buildPeriodLabelFromAmountUnit, offsetMinutesToOwnerPeriodForm, periodAmountUnitToOffsetMinutes, } from '../country-pack/operational-communication-owner-form.js';
export const ACTIVE_REMINDER_CANDIDATE_STATUSES = [
    'pending_review',
    'edited',
    'approved',
    'sending',
    'snoozed',
];
export const TERMINAL_REMINDER_CANDIDATE_STATUSES = [
    'sent',
    'cancelled',
    'delivery_failed',
];
export function buildReminderCandidateDedupKey(params) {
    return `reminder:${params.workItemId}:${params.workflowType}:${params.stepKey.trim()}`;
}
/** Physical dedup_key for insert — suffix after a terminal row so admin can re-test the same cadence step. */
export function resolveReminderCandidateDedupKeyForInsert(params) {
    if (params.terminalAttemptCount <= 0)
        return params.baseKey;
    return `${params.baseKey}:attempt:${params.terminalAttemptCount + 1}`;
}
export function isManualReminderTriggerType(triggerType) {
    const t = triggerType.trim();
    return t === 'manual_command' || t === 'admin_test';
}
export function parseGenerateReminderCandidateWorkflowType(raw) {
    if (typeof raw !== 'string' || !raw.trim()) {
        throw badRequest('workflow_type is required', 'invalid_workflow_type');
    }
    const v = raw.trim();
    if (!REMINDER_WORKFLOW_TYPES.includes(v)) {
        throw badRequest(`workflow_type must be one of: ${REMINDER_WORKFLOW_TYPES.join(', ')}`, 'invalid_workflow_type');
    }
    return v;
}
export function resolveWorkflowFromPolicy(policy, workflowType) {
    const workflow = policy.workflows.find((w) => w.workflow_type === workflowType);
    if (!workflow) {
        throw badRequest(`Reminder workflow '${workflowType}' is not configured in the active policy`, 'reminder_workflow_not_found');
    }
    if (!workflow.enabled) {
        throw badRequest(`Reminder workflow '${workflowType}' is disabled in the active policy`, 'reminder_workflow_disabled');
    }
    return workflow;
}
export function resolveCadenceStepFromWorkflow(workflow, stepKey) {
    const step = workflow.cadence_steps.find((s) => s.step_key === stepKey.trim());
    if (!step) {
        throw badRequest(`Cadence step '${stepKey}' is not configured for workflow '${workflow.workflow_type}'`, 'reminder_cadence_step_not_found');
    }
    return step;
}
/**
 * First configured cadence period for an enabled workflow (owner policy order).
 * Used by admin/dev "Generate reminder draft" — never hardcode step_key in UI.
 */
export function resolveFirstCadenceStepForWorkflow(policy, workflowType) {
    const workflow = resolveWorkflowFromPolicy(policy, workflowType);
    const first = workflow.cadence_steps[0];
    if (!first) {
        throw badRequest(`Reminder workflow '${workflowType}' has no cadence periods configured in the active policy`, 'reminder_cadence_empty');
    }
    return first;
}
export function resolveChannelOrder(policy, step) {
    const order = step.channels?.length ? step.channels : policy.default_channels;
    if (!order.length) {
        throw badRequest('Reminder policy has no delivery channels configured', 'reminder_channels_missing');
    }
    return order;
}
export function selectTemplateVersion(resolved, templateKey, preferredChannel) {
    const candidates = resolved.templates_by_key[templateKey] ?? [];
    if (!candidates.length) {
        throw badRequest(`Reminder template '${templateKey}' is not configured for the active ruleset`, 'reminder_template_not_found');
    }
    if (preferredChannel) {
        const match = candidates.find((t) => t.channel === preferredChannel);
        if (match)
            return match;
    }
    return candidates[0];
}
export function resolveReminderTarget(workflowType, workItem) {
    switch (workflowType) {
        case 'waiting_client':
            return {
                target_type: 'client',
                target_user_id: null,
                client_id: workItem.client_id,
            };
        case 'response_sla':
            if (!workItem.assigned_user_id) {
                throw badRequest('Work item has no assignee for response_sla reminder', 'reminder_target_assignee_missing');
            }
            return {
                target_type: 'assignee',
                target_user_id: workItem.assigned_user_id,
                client_id: workItem.client_id,
            };
        case 'review_sla':
            if (!workItem.reviewer_user_id) {
                throw badRequest('Work item has no reviewer for review_sla reminder', 'reminder_target_reviewer_missing');
            }
            return {
                target_type: 'reviewer',
                target_user_id: workItem.reviewer_user_id,
                client_id: workItem.client_id,
            };
        default: {
            const _exhaustive = workflowType;
            throw badRequest(`Unsupported workflow_type: ${String(_exhaustive)}`);
        }
    }
}
/** Human cadence period label (1 hour, 2 days, …) from policy offset_minutes. */
export function formatOffsetMinutesAsPeriodLabel(offsetMinutes) {
    const preset = OWNER_REMINDER_PRESET_PERIODS.find((p) => periodAmountUnitToOffsetMinutes(p.amount, p.unit) === offsetMinutes);
    if (preset)
        return preset.label;
    const form = offsetMinutesToOwnerPeriodForm(offsetMinutes);
    if (form.period_slug !== '__custom__') {
        const bySlug = OWNER_REMINDER_PRESET_PERIODS.find((p) => p.period_slug === form.period_slug);
        if (bySlug)
            return bySlug.label;
    }
    return buildPeriodLabelFromAmountUnit(form.custom_amount, form.custom_unit);
}
export function assertResolvedReminderPolicy(resolved) {
    if (!resolved.country_code || !resolved.ruleset_id) {
        throw badRequest('Organization has no active country ruleset for operational communication policies', 'operational_communication_policy_unresolved_no_ruleset');
    }
    if (!resolved.policy_version_id || !resolved.active_reminder_policy) {
        throw badRequest('No active operational reminder policy is configured for this organization', 'operational_reminder_policy_missing');
    }
}
