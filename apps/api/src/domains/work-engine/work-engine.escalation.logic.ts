/**
 * Pure escalation helpers (no DB — safe for unit tests).
 */

import { badRequest } from '../../shared/errors.js';
import type { WorkItemRow, WorkState } from './work-engine.types.js';

export const ESCALATION_SOURCES = [
  'manual_escalation',
  'sla_breached',
  'repeated_reminder_ignored',
  'delivery_failure_repeated',
  'blocked_review',
] as const;

export type EscalationSource = (typeof ESCALATION_SOURCES)[number];

export const MANUAL_ESCALATABLE_WORK_STATES: ReadonlySet<WorkState> = new Set([
  'new',
  'assigned',
  'waiting_human',
  'waiting_client',
  'client_replied',
  'review_pending',
  'rejected',
  'overdue',
]);

export function parseEscalationSource(raw: unknown): EscalationSource {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v || !(ESCALATION_SOURCES as readonly string[]).includes(v)) {
    throw badRequest(
      `escalation_source must be one of: ${ESCALATION_SOURCES.join(', ')}`,
      'invalid_escalation_source',
    );
  }
  return v as EscalationSource;
}

export function parseEscalationReason(raw: unknown): string {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) {
    throw badRequest('escalation_reason is required', 'escalation_reason_required');
  }
  if (v.length > 2000) {
    throw badRequest('escalation_reason is too long', 'escalation_reason_too_long');
  }
  return v;
}

export function buildEscalationSourceOptions(): Array<{ value: EscalationSource; label: string }> {
  return ESCALATION_SOURCES.map((value) => ({
    value,
    label: escalationSourceLabel(value),
  }));
}

export function escalationSourceLabel(source: string): string {
  switch (source) {
    case 'manual_escalation':
      return 'Manual escalation';
    case 'sla_breached':
      return 'SLA breached';
    case 'repeated_reminder_ignored':
      return 'Repeated reminder ignored';
    case 'delivery_failure_repeated':
      return 'Delivery failure repeated';
    case 'blocked_review':
      return 'Blocked review';
    default:
      return source;
  }
}

export function isOrgManagerRole(roleCode: string): boolean {
  return roleCode === 'owner' || roleCode === 'admin';
}

export function isEscalationOwner(row: Pick<WorkItemRow, 'escalation_owner_id'>, userId: string): boolean {
  return row.escalation_owner_id != null && row.escalation_owner_id === userId;
}

export function isEscalationAcknowledged(row: Pick<WorkItemRow, 'escalation_acknowledged_at'>): boolean {
  return row.escalation_acknowledged_at != null && String(row.escalation_acknowledged_at).trim() !== '';
}

export function canManualEscalateWorkState(state: WorkState): boolean {
  return MANUAL_ESCALATABLE_WORK_STATES.has(state);
}

export function assertCanEscalateWorkItem(row: Pick<WorkItemRow, 'work_state'>): void {
  if (row.work_state === 'escalated') {
    throw badRequest('Work item is already escalated', 'work_item_already_escalated');
  }
  if (row.work_state === 'done' || row.work_state === 'archived') {
    throw badRequest(
      `Cannot escalate work item in state '${row.work_state}'`,
      'invalid_escalation_source_state',
    );
  }
  if (!canManualEscalateWorkState(row.work_state)) {
    throw badRequest(
      `Cannot escalate from work_state='${row.work_state}'`,
      'invalid_escalation_source_state',
    );
  }
}

export function assertWorkItemIsEscalated(row: Pick<WorkItemRow, 'work_state'>): void {
  if (row.work_state !== 'escalated') {
    throw badRequest(
      `Command requires work_state=escalated (current='${row.work_state}')`,
      'work_item_not_escalated',
    );
  }
}

export function assertHasEscalationPriorState(
  row: Pick<WorkItemRow, 'escalation_prior_work_state'>,
): WorkState {
  const prior = row.escalation_prior_work_state;
  if (!prior) {
    throw badRequest('Escalation prior state is missing on work item', 'escalation_prior_state_missing');
  }
  return prior as WorkState;
}

export type EscalationPermissionContext = {
  userId: string;
  roleCode: string;
  permissions: string[];
};

export function canEscalateWorkItem(
  ctx: EscalationPermissionContext,
  row: Pick<WorkItemRow, 'work_state'>,
  hasOverridePermission: boolean,
): boolean {
  if (!canManualEscalateWorkState(row.work_state)) return false;
  if (row.work_state === 'escalated' || row.work_state === 'done' || row.work_state === 'archived') {
    return false;
  }
  return (
    isOrgManagerRole(ctx.roleCode) ||
    hasOverridePermission ||
    ctx.permissions.includes('work_engine.escalation.escalate')
  );
}

export function canAcknowledgeEscalation(
  ctx: EscalationPermissionContext,
  row: Pick<WorkItemRow, 'work_state' | 'escalation_owner_id' | 'escalation_acknowledged_at'>,
): boolean {
  if (row.work_state !== 'escalated' || isEscalationAcknowledged(row)) return false;
  return (
    isOrgManagerRole(ctx.roleCode) ||
    isEscalationOwner(row, ctx.userId) ||
    ctx.permissions.includes('work_engine.escalation.acknowledge')
  );
}

export function canResolveEscalation(
  ctx: EscalationPermissionContext,
  row: Pick<WorkItemRow, 'work_state' | 'escalation_owner_id'>,
): boolean {
  if (row.work_state !== 'escalated') return false;
  return (
    isOrgManagerRole(ctx.roleCode) ||
    isEscalationOwner(row, ctx.userId) ||
    ctx.permissions.includes('work_engine.escalation.resolve')
  );
}

export function canReassignEscalationOwner(
  ctx: EscalationPermissionContext,
  row: Pick<WorkItemRow, 'work_state'>,
): boolean {
  if (row.work_state !== 'escalated') return false;
  return isOrgManagerRole(ctx.roleCode) || ctx.permissions.includes('work_engine.escalation.reassign');
}

export type QueueEscalationCommandKind =
  | 'escalate_work_item'
  | 'acknowledge_escalation'
  | 'resolve_escalation'
  | 'reassign_escalation_owner';
