/**
 * Dev / admin-only queue helpers (Stage 10 Phase 3B).
 * Visibility and payloads are backend-owned; UI renders verbatim.
 */

import { config } from '../../config.js';
import { businessYmd } from '../../shared/business-time.js';
import type { RequestContext } from '../../shared/context.js';
import { forbidden } from '../../shared/errors.js';
import { resolveOperationalCommunicationPolicies } from '../country-pack/operational-communication-policy.service.js';
import type { ReminderWorkflowType } from '../country-pack/operational-communication-owner-payload.js';
import { hasPermission } from '../rbac/rbac.service.js';
import {
  assertResolvedReminderPolicy,
  resolveFirstCadenceStepForWorkflow,
} from './work-engine.reminder.logic.js';
import { WORK_ENGINE_PERMISSIONS } from './work-engine.rbac.js';

export type QueueDevToolViewer = {
  userId: string;
  permissions: readonly string[];
  roleCode: string;
};

/** Default workflow for admin "Generate reminder draft" when payload omits workflow_type. */
export const GENERATE_REMINDER_DRAFT_WORKFLOW_TYPE = 'waiting_client' as const;

export type ResolvedGenerateReminderDraftCadence = {
  workflow_type: ReminderWorkflowType;
  step_key: string;
};

/**
 * Resolve workflow + first cadence period from active operational reminder policy.
 * Step keys are owner-generated (e.g. nudge_waiting_client_1h), not hardcoded.
 */
export async function resolveGenerateReminderDraftCadence(
  orgId: string,
  workflowType: ReminderWorkflowType = GENERATE_REMINDER_DRAFT_WORKFLOW_TYPE,
): Promise<ResolvedGenerateReminderDraftCadence> {
  const resolved = await resolveOperationalCommunicationPolicies(orgId, businessYmd(new Date()));
  assertResolvedReminderPolicy(resolved);
  const step = resolveFirstCadenceStepForWorkflow(resolved.active_reminder_policy, workflowType);
  return { workflow_type: workflowType, step_key: step.step_key };
}

export function canAccessReminderDraftDevTool(viewer: QueueDevToolViewer): boolean {
  const perms = [...viewer.permissions];
  const isOrgAdmin =
    viewer.roleCode === 'owner' ||
    viewer.roleCode === 'admin' ||
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.admin);

  if (config.nodeEnv === 'production') {
    return isOrgAdmin;
  }

  return isOrgAdmin || hasPermission(perms, WORK_ENGINE_PERMISSIONS.write);
}

export function assertGenerateReminderCandidateDevAccess(ctx: RequestContext): void {
  if (!ctx.membership || !ctx.user) {
    throw forbidden('Organization membership required');
  }
  const viewer: QueueDevToolViewer = {
    userId: ctx.user.id,
    permissions: ctx.membership.permissions ?? [],
    roleCode: ctx.membership.roleCode,
  };
  if (!canAccessReminderDraftDevTool(viewer)) {
    throw forbidden(
      'Generate reminder draft is only available to administrators (or in non-production for users with work engine write access)',
    );
  }
}
