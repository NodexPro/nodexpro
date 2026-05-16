/**
 * Work Engine escalation commands (Stage 10 Phase 3C-1).
 * All escalation write semantics live here only.
 */

import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { hasPermission } from '../rbac/rbac.service.js';
import { isUuid } from './work-engine.guards.js';
import {
  assertCanEscalateWorkItem,
  assertHasEscalationPriorState,
  assertWorkItemIsEscalated,
  canAcknowledgeEscalation,
  canEscalateWorkItem,
  canReassignEscalationOwner,
  canResolveEscalation,
  isEscalationAcknowledged,
  type EscalationPermissionContext,
  type EscalationSource,
  parseEscalationReason,
} from './work-engine.escalation.logic.js';
import { WORK_ENGINE_PERMISSIONS } from './work-engine.rbac.js';
import type { WorkItemRow, WorkState } from './work-engine.types.js';

async function assertActiveOrgMember(orgId: string, userId: string): Promise<void> {
  if (!isUuid(userId)) throw badRequest('user id must be a uuid');
  const { data, error } = await supabaseAdmin
    .from('organization_memberships')
    .select('id')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw badRequest('escalation_owner_id must be an active organization member', 'invalid_escalation_owner');
}

function escalationPermContext(
  actorUserId: string,
  roleCode: string,
  permissions: string[],
): EscalationPermissionContext {
  return { userId: actorUserId, roleCode, permissions };
}

function assertMayEscalate(ctx: EscalationPermissionContext, row: WorkItemRow, permissions: string[]): void {
  const may =
    canEscalateWorkItem(
      ctx,
      row,
      hasPermission(permissions, WORK_ENGINE_PERMISSIONS.override) ||
        hasPermission(permissions, WORK_ENGINE_PERMISSIONS.admin),
    );
  if (!may) throw forbidden('Insufficient permission to escalate work item', 'FORBIDDEN');
}

function assertMayAcknowledge(ctx: EscalationPermissionContext, row: WorkItemRow): void {
  if (!canAcknowledgeEscalation(ctx, row)) {
    throw forbidden('Insufficient permission to acknowledge escalation', 'FORBIDDEN');
  }
}

function assertMayResolve(ctx: EscalationPermissionContext, row: WorkItemRow): void {
  if (!canResolveEscalation(ctx, row)) {
    throw forbidden('Insufficient permission to resolve escalation', 'FORBIDDEN');
  }
}

function assertMayReassign(ctx: EscalationPermissionContext, row: WorkItemRow): void {
  if (!canReassignEscalationOwner(ctx, row)) {
    throw forbidden('Insufficient permission to reassign escalation owner', 'FORBIDDEN');
  }
}

export async function escalateWorkItem(params: {
  orgId: string;
  actorUserId: string;
  roleCode: string;
  permissions: string[];
  workItem: WorkItemRow;
  expectedVersion: number;
  escalationOwnerId: string;
  escalationReason: string;
  escalationSource: EscalationSource;
  idempotencyKey?: string | null;
}): Promise<{ priorWorkState: WorkState; newVersion: number }> {
  const ctx = escalationPermContext(params.actorUserId, params.roleCode, params.permissions);
  assertMayEscalate(ctx, params.workItem, params.permissions);
  assertCanEscalateWorkItem(params.workItem);

  const escalationOwnerId = params.escalationOwnerId.trim();
  if (!isUuid(escalationOwnerId)) {
    throw badRequest('escalation_owner_id must be a uuid', 'invalid_escalation_owner');
  }
  await assertActiveOrgMember(params.orgId, escalationOwnerId);

  const reason = parseEscalationReason(params.escalationReason);
  const priorWorkState = params.workItem.work_state;
  const newVersion = params.workItem.version + 1;

  const { error, count } = await supabaseAdmin
    .from('work_items')
    .update({
      work_state: 'escalated',
      escalation_owner_id: escalationOwnerId,
      escalation_reason: reason,
      escalation_source: params.escalationSource,
      escalation_prior_work_state: priorWorkState,
      escalation_acknowledged_at: null,
      escalation_acknowledged_by_user_id: null,
      version: newVersion,
    }, { count: 'exact' })
    .eq('id', params.workItem.id)
    .eq('org_id', params.orgId)
    .eq('version', params.expectedVersion);
  if (error) throw error;
  if (count === 0) throw conflict('Version conflict on update', 'version_conflict_on_update');

  await writeAudit({
    organizationId: params.orgId,
    actorUserId: params.actorUserId,
    moduleCode: 'work_engine',
    entityType: 'work_item',
    entityId: params.workItem.id,
    action: AUDIT_ACTIONS.WORK_ITEM_ESCALATED,
    payload: {
      from_state: priorWorkState,
      to_state: 'escalated',
      escalation_owner_id: escalationOwnerId,
      escalation_reason: reason,
      escalation_source: params.escalationSource,
      prior_work_state: priorWorkState,
      idempotency_key: params.idempotencyKey ?? null,
    },
  });

  return { priorWorkState, newVersion };
}

export async function acknowledgeEscalation(params: {
  orgId: string;
  actorUserId: string;
  roleCode: string;
  permissions: string[];
  workItem: WorkItemRow;
  expectedVersion: number;
}): Promise<{ newVersion: number }> {
  const ctx = escalationPermContext(params.actorUserId, params.roleCode, params.permissions);
  assertWorkItemIsEscalated(params.workItem);
  assertMayAcknowledge(ctx, params.workItem);
  if (isEscalationAcknowledged(params.workItem)) {
    throw badRequest('Escalation is already acknowledged', 'escalation_already_acknowledged');
  }

  const newVersion = params.workItem.version + 1;
  const acknowledgedAt = new Date().toISOString();
  const { error, count } = await supabaseAdmin
    .from('work_items')
    .update({
      escalation_acknowledged_at: acknowledgedAt,
      escalation_acknowledged_by_user_id: params.actorUserId,
      version: newVersion,
    }, { count: 'exact' })
    .eq('id', params.workItem.id)
    .eq('org_id', params.orgId)
    .eq('version', params.expectedVersion);
  if (error) throw error;
  if (count === 0) throw conflict('Version conflict on update', 'version_conflict_on_update');

  await writeAudit({
    organizationId: params.orgId,
    actorUserId: params.actorUserId,
    moduleCode: 'work_engine',
    entityType: 'work_item',
    entityId: params.workItem.id,
    action: AUDIT_ACTIONS.WORK_ITEM_ESCALATION_ACKNOWLEDGED,
    payload: {
      escalation_owner_id: params.workItem.escalation_owner_id,
      acknowledged_at: acknowledgedAt,
    },
  });

  return { newVersion };
}

export async function resolveEscalation(params: {
  orgId: string;
  actorUserId: string;
  roleCode: string;
  permissions: string[];
  workItem: WorkItemRow;
  expectedVersion: number;
  resolutionNote?: string | null;
}): Promise<{ restoredWorkState: WorkState; newVersion: number }> {
  const ctx = escalationPermContext(params.actorUserId, params.roleCode, params.permissions);
  assertWorkItemIsEscalated(params.workItem);
  assertMayResolve(ctx, params.workItem);

  const restoredWorkState = assertHasEscalationPriorState(params.workItem);
  const newVersion = params.workItem.version + 1;

  const { error, count } = await supabaseAdmin
    .from('work_items')
    .update({
      work_state: restoredWorkState,
      escalation_owner_id: null,
      escalation_reason: null,
      escalation_source: null,
      escalation_prior_work_state: null,
      escalation_acknowledged_at: null,
      escalation_acknowledged_by_user_id: null,
      version: newVersion,
    }, { count: 'exact' })
    .eq('id', params.workItem.id)
    .eq('org_id', params.orgId)
    .eq('version', params.expectedVersion);
  if (error) throw error;
  if (count === 0) throw conflict('Version conflict on update', 'version_conflict_on_update');

  await writeAudit({
    organizationId: params.orgId,
    actorUserId: params.actorUserId,
    moduleCode: 'work_engine',
    entityType: 'work_item',
    entityId: params.workItem.id,
    action: AUDIT_ACTIONS.WORK_ITEM_ESCALATION_RESOLVED,
    payload: {
      from_state: 'escalated',
      to_state: restoredWorkState,
      prior_work_state: restoredWorkState,
      resolution_note: params.resolutionNote ?? null,
    },
  });

  return { restoredWorkState, newVersion };
}

export async function reassignEscalationOwner(params: {
  orgId: string;
  actorUserId: string;
  roleCode: string;
  permissions: string[];
  workItem: WorkItemRow;
  expectedVersion: number;
  newEscalationOwnerId: string;
}): Promise<{ previousOwnerId: string | null; newVersion: number }> {
  const ctx = escalationPermContext(params.actorUserId, params.roleCode, params.permissions);
  assertWorkItemIsEscalated(params.workItem);
  assertMayReassign(ctx, params.workItem);

  const newOwnerId = params.newEscalationOwnerId.trim();
  if (!isUuid(newOwnerId)) {
    throw badRequest('escalation_owner_id must be a uuid', 'invalid_escalation_owner');
  }
  await assertActiveOrgMember(params.orgId, newOwnerId);

  const previousOwnerId = params.workItem.escalation_owner_id;
  if (previousOwnerId === newOwnerId) {
    throw badRequest('Escalation owner is already assigned to this user', 'escalation_owner_unchanged');
  }

  const newVersion = params.workItem.version + 1;
  const { error, count } = await supabaseAdmin
    .from('work_items')
    .update({
      escalation_owner_id: newOwnerId,
      escalation_acknowledged_at: null,
      escalation_acknowledged_by_user_id: null,
      version: newVersion,
    }, { count: 'exact' })
    .eq('id', params.workItem.id)
    .eq('org_id', params.orgId)
    .eq('version', params.expectedVersion);
  if (error) throw error;
  if (count === 0) throw conflict('Version conflict on update', 'version_conflict_on_update');

  await writeAudit({
    organizationId: params.orgId,
    actorUserId: params.actorUserId,
    moduleCode: 'work_engine',
    entityType: 'work_item',
    entityId: params.workItem.id,
    action: AUDIT_ACTIONS.WORK_ITEM_ESCALATION_OWNER_REASSIGNED,
    payload: {
      previous_escalation_owner_id: previousOwnerId,
      new_escalation_owner_id: newOwnerId,
    },
  });

  return { previousOwnerId, newVersion };
}

export async function loadWorkItemForEscalation(orgId: string, workItemId: string): Promise<WorkItemRow> {
  if (!isUuid(workItemId)) throw badRequest('work_item_id must be a uuid');
  const { data, error } = await supabaseAdmin
    .from('work_items')
    .select('*')
    .eq('id', workItemId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Work item not found');
  return data as WorkItemRow;
}
