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
  type ReminderChannel,
  type ReminderWorkflowType,
} from '../country-pack/operational-communication-owner-payload.js';

export type { ResolvedOperationalCommunicationPolicies, ResolvedReminderTemplateVersion };
import type { WorkItemRow } from './work-engine.types.js';

export type ReminderCandidateTargetType = 'client' | 'assignee' | 'reviewer' | 'escalation_owner';

export function buildReminderCandidateDedupKey(params: {
  workItemId: string;
  workflowType: ReminderWorkflowType;
  stepKey: string;
}): string {
  return `reminder:${params.workItemId}:${params.workflowType}:${params.stepKey.trim()}`;
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
