/**
 * Pure reminder resolution helpers (no DB / config imports — safe for unit tests).
 */

import { badRequest } from '../../shared/errors.js';
import type {
  ResolvedOperationalCommunicationPolicies,
  ResolvedReminderTemplateVersion,
} from '../country-pack/operational-communication-policy.service.js';
import {
  REMINDER_WORKFLOW_TYPES,
  type OperationalReminderCadenceStep,
  type OperationalReminderPolicyPayload,
  type OperationalReminderWorkflow,
  type ReminderCadenceAnchor,
  type ReminderChannel,
  type ReminderWorkflowType,
} from '../country-pack/operational-communication-owner-payload.js';

export type { ResolvedOperationalCommunicationPolicies, ResolvedReminderTemplateVersion };
import type { WorkItemRow } from './work-engine.types.js';
import {
  OWNER_REMINDER_PRESET_PERIODS,
  buildPeriodLabelFromAmountUnit,
  offsetMinutesToOwnerPeriodForm,
  periodAmountUnitToOffsetMinutes,
  type OwnerReminderPeriodUnit,
} from '../country-pack/operational-communication-owner-form.js';

export type ReminderCandidateTargetType = 'client' | 'assignee' | 'reviewer' | 'escalation_owner';

export const ACTIVE_REMINDER_CANDIDATE_STATUSES = [
  'pending_review',
  'edited',
  'approved',
  'sending',
  'snoozed',
] as const;

export const TERMINAL_REMINDER_CANDIDATE_STATUSES = [
  'sent',
  'cancelled',
  'delivery_failed',
] as const;

export type ActiveReminderCandidateStatus = (typeof ACTIVE_REMINDER_CANDIDATE_STATUSES)[number];
export type TerminalReminderCandidateStatus = (typeof TERMINAL_REMINDER_CANDIDATE_STATUSES)[number];

export function buildReminderCandidateDedupKey(params: {
  workItemId: string;
  workflowType: ReminderWorkflowType;
  stepKey: string;
}): string {
  return `reminder:${params.workItemId}:${params.workflowType}:${params.stepKey.trim()}`;
}

/** Physical dedup_key for insert — suffix after a terminal row so admin can re-test the same cadence step. */
export function resolveReminderCandidateDedupKeyForInsert(params: {
  baseKey: string;
  terminalAttemptCount: number;
}): string {
  if (params.terminalAttemptCount <= 0) return params.baseKey;
  return `${params.baseKey}:attempt:${params.terminalAttemptCount + 1}`;
}

export function isManualReminderTriggerType(triggerType: string): boolean {
  const t = triggerType.trim();
  return t === 'manual_command' || t === 'admin_test';
}

export type ReminderSlaObligationKind = 'response' | 'waiting_client' | 'review';

export const REMINDER_WORKFLOW_TO_SLA_KIND: Record<ReminderWorkflowType, ReminderSlaObligationKind> =
  {
    waiting_client: 'waiting_client',
    response_sla: 'response',
    review_sla: 'review',
  };

export type ReminderObligationSnapshot = {
  kind: ReminderSlaObligationKind;
  starts_at: string;
  due_at: string;
  status: string;
  paused_at: string | null;
};

export function isWorkItemEligibleForAutoReminders(workState: string): boolean {
  return workState !== 'done' && workState !== 'archived';
}

export function isWaitingClientWorkflowContext(
  workState: string,
  obligations: ReminderObligationSnapshot[],
): boolean {
  if (workState === 'waiting_client') return true;
  return obligations.some(
    (o) => o.kind === 'waiting_client' && o.status === 'active' && !o.paused_at,
  );
}

export function resolveActiveObligationForWorkflow(
  workflowType: ReminderWorkflowType,
  obligations: ReminderObligationSnapshot[],
): ReminderObligationSnapshot | null {
  const kind = REMINDER_WORKFLOW_TO_SLA_KIND[workflowType];
  return (
    obligations.find((o) => o.kind === kind && o.status === 'active' && !o.paused_at) ?? null
  );
}

export function resolveCadenceAnchorIso(
  anchor: ReminderCadenceAnchor,
  obligation: ReminderObligationSnapshot,
): string {
  if (anchor === 'obligation_due_at') return obligation.due_at;
  return obligation.starts_at;
}

export function computeCadenceTriggerAtMs(anchorIso: string, offsetMinutes: number): number {
  return new Date(anchorIso).getTime() + offsetMinutes * 60_000;
}

export function isCadenceStepEligible(
  nowMs: number,
  anchorIso: string,
  offsetMinutes: number,
): boolean {
  return nowMs >= computeCadenceTriggerAtMs(anchorIso, offsetMinutes);
}

export function shouldEvaluateReminderWorkflow(params: {
  workflowType: ReminderWorkflowType;
  workState: string;
  obligations: ReminderObligationSnapshot[];
}): boolean {
  if (params.workflowType === 'waiting_client') {
    return isWaitingClientWorkflowContext(params.workState, params.obligations);
  }
  return resolveActiveObligationForWorkflow(params.workflowType, params.obligations) != null;
}

export function listEligibleCadenceSteps(params: {
  workflow: OperationalReminderWorkflow;
  obligation: ReminderObligationSnapshot;
  nowMs: number;
}): OperationalReminderCadenceStep[] {
  const anchorIso = resolveCadenceAnchorIso(params.workflow.anchor, params.obligation);
  return params.workflow.cadence_steps.filter((step) =>
    isCadenceStepEligible(params.nowMs, anchorIso, step.offset_minutes),
  );
}

export function parseGenerateReminderCandidateWorkflowType(raw: unknown): ReminderWorkflowType {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw badRequest('workflow_type is required', 'invalid_workflow_type');
  }
  const v = raw.trim();
  if (!(REMINDER_WORKFLOW_TYPES as readonly string[]).includes(v)) {
    throw badRequest(
      `workflow_type must be one of: ${REMINDER_WORKFLOW_TYPES.join(', ')}`,
      'invalid_workflow_type',
    );
  }
  return v as ReminderWorkflowType;
}

export function resolveWorkflowFromPolicy(
  policy: OperationalReminderPolicyPayload,
  workflowType: ReminderWorkflowType,
): OperationalReminderWorkflow {
  const workflow = policy.workflows.find((w) => w.workflow_type === workflowType);
  if (!workflow) {
    throw badRequest(
      `Reminder workflow '${workflowType}' is not configured in the active policy`,
      'reminder_workflow_not_found',
    );
  }
  if (!workflow.enabled) {
    throw badRequest(
      `Reminder workflow '${workflowType}' is disabled in the active policy`,
      'reminder_workflow_disabled',
    );
  }
  return workflow;
}

export function resolveCadenceStepFromWorkflow(
  workflow: OperationalReminderWorkflow,
  stepKey: string,
): OperationalReminderCadenceStep {
  const step = workflow.cadence_steps.find((s) => s.step_key === stepKey.trim());
  if (!step) {
    throw badRequest(
      `Cadence step '${stepKey}' is not configured for workflow '${workflow.workflow_type}'`,
      'reminder_cadence_step_not_found',
    );
  }
  return step;
}

/**
 * First configured cadence period for an enabled workflow (owner policy order).
 * Used by admin/dev "Generate reminder draft" — never hardcode step_key in UI.
 */
export function resolveFirstCadenceStepForWorkflow(
  policy: OperationalReminderPolicyPayload,
  workflowType: ReminderWorkflowType,
): OperationalReminderCadenceStep {
  const workflow = resolveWorkflowFromPolicy(policy, workflowType);
  const first = workflow.cadence_steps[0];
  if (!first) {
    throw badRequest(
      `Reminder workflow '${workflowType}' has no cadence periods configured in the active policy`,
      'reminder_cadence_empty',
    );
  }
  return first;
}

export function resolveChannelOrder(
  policy: OperationalReminderPolicyPayload,
  step: OperationalReminderCadenceStep,
): ReminderChannel[] {
  const order = step.channels?.length ? step.channels : policy.default_channels;
  if (!order.length) {
    throw badRequest('Reminder policy has no delivery channels configured', 'reminder_channels_missing');
  }
  return order;
}

export function selectTemplateVersion(
  resolved: ResolvedOperationalCommunicationPolicies,
  templateKey: string,
  preferredChannel?: ReminderChannel,
): ResolvedReminderTemplateVersion {
  const candidates = resolved.templates_by_key[templateKey] ?? [];
  if (!candidates.length) {
    throw badRequest(
      `Reminder template '${templateKey}' is not configured for the active ruleset`,
      'reminder_template_not_found',
    );
  }
  if (preferredChannel) {
    const match = candidates.find((t) => t.channel === preferredChannel);
    if (match) return match;
  }
  return candidates[0];
}

export function resolveReminderTarget(workflowType: ReminderWorkflowType, workItem: WorkItemRow): {
  target_type: ReminderCandidateTargetType;
  target_user_id: string | null;
  client_id: string | null;
} {
  switch (workflowType) {
    case 'waiting_client':
      return {
        target_type: 'client',
        target_user_id: null,
        client_id: workItem.client_id,
      };
    case 'response_sla':
      if (!workItem.assigned_user_id) {
        throw badRequest(
          'Work item has no assignee for response_sla reminder',
          'reminder_target_assignee_missing',
        );
      }
      return {
        target_type: 'assignee',
        target_user_id: workItem.assigned_user_id,
        client_id: workItem.client_id,
      };
    case 'review_sla':
      if (!workItem.reviewer_user_id) {
        throw badRequest(
          'Work item has no reviewer for review_sla reminder',
          'reminder_target_reviewer_missing',
        );
      }
      return {
        target_type: 'reviewer',
        target_user_id: workItem.reviewer_user_id,
        client_id: workItem.client_id,
      };
    default: {
      const _exhaustive: never = workflowType;
      throw badRequest(`Unsupported workflow_type: ${String(_exhaustive)}`);
    }
  }
}

/** Human cadence period label (1 hour, 2 days, …) from policy offset_minutes. */
export function formatOffsetMinutesAsPeriodLabel(offsetMinutes: number): string {
  const preset = OWNER_REMINDER_PRESET_PERIODS.find(
    (p) => periodAmountUnitToOffsetMinutes(p.amount, p.unit) === offsetMinutes,
  );
  if (preset) return preset.label;
  const form = offsetMinutesToOwnerPeriodForm(offsetMinutes);
  if (form.period_slug !== '__custom__') {
    const bySlug = OWNER_REMINDER_PRESET_PERIODS.find((p) => p.period_slug === form.period_slug);
    if (bySlug) return bySlug.label;
  }
  return buildPeriodLabelFromAmountUnit(
    form.custom_amount,
    form.custom_unit as OwnerReminderPeriodUnit,
  );
}

export function assertResolvedReminderPolicy(
  resolved: ResolvedOperationalCommunicationPolicies,
): asserts resolved is ResolvedOperationalCommunicationPolicies & {
  country_code: string;
  policy_version_id: string;
  active_reminder_policy: OperationalReminderPolicyPayload;
} {
  if (!resolved.country_code || !resolved.ruleset_id) {
    throw badRequest(
      'Organization has no active country ruleset for operational communication policies',
      'operational_communication_policy_unresolved_no_ruleset',
    );
  }
  if (!resolved.policy_version_id || !resolved.active_reminder_policy) {
    throw badRequest(
      'No active operational reminder policy is configured for this organization',
      'operational_reminder_policy_missing',
    );
  }
}
