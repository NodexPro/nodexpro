/**
 * Work Engine commands (Stage 2 foundation).
 *
 * Commands implemented:
 *   - create_work_item
 *   - assign_work_item
 *   - change_work_state
 *   - set_work_deadline
 *   - append_work_event
 *   - apply_work_override
 *
 * Architecture rules:
 *   - One user/system action = one command.
 *   - Every successful state-relevant write increments work_items.version and appends a work_transition.
 *   - Frontend never decides state, label, or allowed actions.
 *   - After every command we return the refreshed Work Engine aggregate.
 *     Default: `work_engine_foundation_aggregate`. When `payload.refresh_aggregate`
 *     is `work_engine_queue_aggregate`, the response includes the full queue
 *     aggregate (Stage 3E); optional `payload.aggregate_filters` scopes the
 *     rebuilt queue the same way as GET /aggregates/queue.
 *   - Source: docs/work-engine-domain-model.md, docs/work-engine-state-machine.md,
 *             docs/work-engine-dedup-policy.md, docs/work-engine-override-precedence.md.
 */

import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { hasPermission } from '../rbac/rbac.service.js';
import {
  asOptionalIso,
  asOptionalString,
  assertClientBelongsToOrg,
  assertExpectedVersion,
  assertOrgScope,
  assertValidPeriodKey,
  assertValidWorkState,
  canPickUpFromUnassignedWorkState,
  canReopenFromDone,
  canTransitionWorkState,
  isUuid,
  reqInt,
  reqString,
} from './work-engine.guards.js';
import {
  abortWorkEngineCommandIdempotency,
  beginWorkEngineCommandIdempotency,
  completeWorkEngineCommandIdempotency,
} from './work-engine.idempotency.js';
import {
  buildWorkEngineFoundationAggregate,
  buildWorkEngineQueueAggregate,
  coerceWorkEngineQueueFilters,
  queueAllowedActions,
  type QueueAllowedActionCommand,
  type WorkEngineQueueViewerContext,
} from './work-engine.read-models.service.js';
import { intakeWorkEvent } from './work-engine.event-intake.service.js';
import {
  canStaffPickUpUnassigned,
  resolveWorkTypeWorkflowPolicy,
} from './work-engine.policy.service.js';
import { applySlaHooksForCommand } from './work-engine.sla.service.js';
import {
  buildReminderCandidateDedupKey,
  generateReminderCandidate,
  parseGenerateReminderCandidateWorkflowType,
} from './work-engine.reminder.service.js';
import {
  WORK_ENGINE_PERMISSIONS,
  requireWorkEnginePermission,
} from './work-engine.rbac.js';
import {
  CREATION_SOURCE_TYPES,
  OVERRIDE_KINDS,
  OVERRIDE_KINDS_REQUIRING_REASON,
  type CreationSourceType,
  type EventDirection,
  type OverrideKind,
  type TransitionKind,
  type WorkEngineCommandPayload,
  type WorkEngineCommandResponse,
  type WorkEngineCommandType,
  type WorkItemRow,
  type WorkState,
} from './work-engine.types.js';

const REFRESH_FOUNDATION = 'work_engine_foundation_aggregate' as const;
const REFRESH_QUEUE = 'work_engine_queue_aggregate' as const;

function viewerQueueContext(ctx: RequestContext): WorkEngineQueueViewerContext | null {
  if (!ctx.membership) return null;
  return {
    userId: ctx.user.id,
    permissions: ctx.membership.permissions ?? [],
    roleCode: ctx.membership.roleCode,
  };
}

async function insertWorkAssignmentHistory(row: {
  orgId: string;
  workItemId: string;
  from: string | null;
  to: string | null;
  actorUserId: string;
  commandType: string;
  idempotencyKey: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('work_assignment_history').insert({
    org_id: row.orgId,
    work_item_id: row.workItemId,
    from_assigned_user_id: row.from,
    to_assigned_user_id: row.to,
    actor_user_id: row.actorUserId,
    command_type: row.commandType,
    idempotency_key: row.idempotencyKey,
  });
  if (error) throw error;
}

async function executeWithCommandIdempotency(
  ctx: RequestContext,
  orgId: string,
  command: WorkEngineCommandType,
  payload: WorkEngineCommandPayload,
  exec: () => Promise<{ workItemId: string | null }>,
): Promise<WorkEngineCommandResponse> {
  const idemKey = reqString(payload, 'idempotency_key');
  const lease = await beginWorkEngineCommandIdempotency({
    orgId,
    commandType: command,
    idempotencyKey: idemKey,
  });
  if (lease.kind === 'replay') {
    return {
      ok: true,
      command,
      refreshed: await buildRefreshedForPayload(orgId, payload, ctx),
      meta: { idempotent_replay: true },
    };
  }
  try {
    const out = await exec();
    await completeWorkEngineCommandIdempotency({
      leaseRowId: lease.leaseRowId,
      workItemId: out.workItemId,
    });
    return {
      ok: true,
      command,
      refreshed: await buildRefreshedForPayload(orgId, payload, ctx),
    };
  } catch (e) {
    await abortWorkEngineCommandIdempotency(lease.leaseRowId);
    throw e;
  }
}

function parseRefreshAggregateKey(payload: WorkEngineCommandPayload): 'foundation' | 'queue' {
  const raw = asOptionalString(payload.refresh_aggregate);
  if (raw === undefined || raw === null || raw === '') return 'foundation';
  if (raw === REFRESH_FOUNDATION) return 'foundation';
  if (raw === REFRESH_QUEUE) return 'queue';
  throw badRequest(
    `Invalid refresh_aggregate: use '${REFRESH_FOUNDATION}', '${REFRESH_QUEUE}', or omit`,
    'invalid_refresh_aggregate',
  );
}

function isQueueRefreshMode(payload: WorkEngineCommandPayload): boolean {
  return parseRefreshAggregateKey(payload) === 'queue';
}

async function buildRefreshedForPayload(
  orgId: string,
  payload: WorkEngineCommandPayload,
  ctx: RequestContext,
): Promise<WorkEngineCommandResponse['refreshed']> {
  if (parseRefreshAggregateKey(payload) === 'queue') {
    const filters = coerceWorkEngineQueueFilters(payload.aggregate_filters);
    const viewer = viewerQueueContext(ctx);
    return {
      aggregate_key: REFRESH_QUEUE,
      aggregate: await buildWorkEngineQueueAggregate({
        orgId,
        filters,
        viewer: viewer ?? undefined,
      }),
    };
  }
  return {
    aggregate_key: REFRESH_FOUNDATION,
    aggregate: await buildWorkEngineFoundationAggregate({ orgId }),
  };
}

/**
 * Stage 3E: recompute the same semantic `allowed_actions` as the queue aggregate
 * and reject if the requested command does not match an enabled action. Never
 * trust client-supplied allowed_actions flags.
 */
function assertQueueActionEnabled(current: WorkItemRow, semantic: QueueAllowedActionCommand): void {
  const actions = queueAllowedActions({
    work_state: current.work_state,
    assigned_user_id: current.assigned_user_id,
  });
  const row = actions.find((a) => a.command === semantic);
  if (!row?.enabled) {
    throw badRequest(
      row?.reason ?? `Queue action '${semantic}' is not allowed for work_state='${current.work_state}'`,
      'queue_action_not_allowed',
    );
  }
}

function assertActorMayRequestReview(ctx: RequestContext, current: WorkItemRow): void {
  requireWorkEnginePermission(ctx, WORK_ENGINE_PERMISSIONS.reviewRequest);
  const role = ctx.membership?.roleCode ?? 'staff';
  if (role === 'staff' && current.assigned_user_id !== ctx.user.id) {
    throw forbidden('Only the assignee may request review', 'FORBIDDEN');
  }
}

function assertActorMayApproveOrReject(ctx: RequestContext, current: WorkItemRow): void {
  const perms = ctx.membership?.permissions ?? [];
  const isReviewer = current.reviewer_user_id === ctx.user.id;
  const canBreakGlass =
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.reviewBreakGlass) ||
    hasPermission(perms, WORK_ENGINE_PERMISSIONS.admin);
  if (ctx.user.id === current.assigned_user_id) {
    throw forbidden('Assignee cannot approve or reject their own submission', 'SELF_REVIEW_FORBIDDEN');
  }
  if (!isReviewer && !canBreakGlass) {
    throw forbidden('Only the designated reviewer (or break-glass) may complete this review', 'FORBIDDEN');
  }
}

function ensureObj(value: unknown): WorkEngineCommandPayload {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as WorkEngineCommandPayload)
    : {};
}

function ensurePayloadObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

async function audit(
  orgId: string,
  actorUserId: string | null,
  entityType: string,
  entityId: string | null,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await writeAudit({
    organizationId: orgId,
    actorUserId,
    moduleCode: 'work_engine',
    entityType,
    entityId,
    action,
    payload,
  });
}

async function loadWorkItem(orgId: string, workItemId: string): Promise<WorkItemRow> {
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

type TransitionInsert = {
  org_id: string;
  work_item_id: string;
  from_state: WorkState | null;
  to_state: WorkState;
  transition_kind: TransitionKind;
  action_code: string;
  actor_type: 'user' | 'system' | 'rule';
  actor_user_id: string | null;
  reason_text: string | null;
  metadata_json: Record<string, unknown>;
  expected_version: number | null;
  resulting_version: number;
};

async function insertTransition(row: TransitionInsert): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('work_transitions')
    .insert(row)
    .select('id')
    .single();
  if (error) throw error;
  return String(data.id);
}

async function runPhase3aSlaHooks(args: {
  orgId: string;
  workItemId: string;
  command: WorkEngineCommandType;
  transitionId: string;
  actorUserId: string | null;
  workType: string;
  toState?: WorkState;
}): Promise<void> {
  await applySlaHooksForCommand({
    orgId: args.orgId,
    workItemId: args.workItemId,
    command: args.command,
    transitionId: args.transitionId,
    actorUserId: args.actorUserId,
    toState: args.toState,
    workType: args.workType,
  });
}

async function updateWorkItemWithVersion(args: {
  orgId: string;
  workItemId: string;
  expectedVersion: number;
  patch: Record<string, unknown>;
  newVersion: number;
}): Promise<void> {
  const { error, count } = await supabaseAdmin
    .from('work_items')
    .update({ ...args.patch, version: args.newVersion }, { count: 'exact' })
    .eq('id', args.workItemId)
    .eq('org_id', args.orgId)
    .eq('version', args.expectedVersion);
  if (error) throw error;
  if (count === 0) {
    throw conflict('Version conflict on update', 'version_conflict_on_update');
  }
}

export async function executeWorkEngineCommand(
  ctx: RequestContext,
  command: WorkEngineCommandType,
  payloadInput: unknown,
): Promise<WorkEngineCommandResponse> {
  const payload = ensureObj(payloadInput);
  const orgId = ctx.organizationId ?? reqString(payload, 'org_id');
  assertOrgScope(ctx, orgId);
  const actorUserId = ctx.user.id;

  switch (command) {
    case 'create_work_item': {
      return executeWithCommandIdempotency(ctx, orgId, command, payload, async () => {
      const clientId = reqString(payload, 'client_id');
      await assertClientBelongsToOrg(orgId, clientId);
      const moduleKey = reqString(payload, 'module_key');
      const workType = reqString(payload, 'work_type');
      const periodKey = assertValidPeriodKey(reqString(payload, 'period_key'));
      const sourceModule = reqString(payload, 'source_module');
      const sourceEntityType = reqString(payload, 'source_entity_type');
      const sourceEntityId = reqString(payload, 'source_entity_id');
      const creationSourceRaw =
        asOptionalString(payload.creation_source_type) ?? 'command';
      if (!(CREATION_SOURCE_TYPES as readonly string[]).includes(creationSourceRaw)) {
        throw badRequest('Invalid creation_source_type');
      }
      const creationSourceType = creationSourceRaw as CreationSourceType;
      const ownerUserId = asOptionalString(payload.owner_user_id);
      const assignedUserId = asOptionalString(payload.assigned_user_id);
      const reviewerUserId = asOptionalString(payload.reviewer_user_id);
      const escalationOwnerId = asOptionalString(payload.escalation_owner_id);
      const dueAt = asOptionalIso(payload.due_at);
      const createdByRuleId = asOptionalString(payload.created_by_rule_id);
      const createdByEventId = asOptionalString(payload.created_by_event_id);

      const initialState: WorkState = assignedUserId ? 'assigned' : 'new';

      const insertResp = await supabaseAdmin
        .from('work_items')
        .insert({
          org_id: orgId,
          client_id: clientId,
          module_key: moduleKey,
          work_type: workType,
          period_key: periodKey,
          work_state: initialState,
          owner_user_id: ownerUserId,
          assigned_user_id: assignedUserId,
          reviewer_user_id: reviewerUserId,
          escalation_owner_id: escalationOwnerId,
          due_at: dueAt,
          sla_status: 'none',
          source_module: sourceModule,
          source_entity_type: sourceEntityType,
          source_entity_id: sourceEntityId,
          created_by_rule_id: createdByRuleId,
          created_by_event_id: createdByEventId,
          created_by_user_id: actorUserId,
          creation_source_type: creationSourceType,
          version: 0,
          override_active: false,
        })
        .select('*')
        .single();
      if (insertResp.error) {
        const code = (insertResp.error as { code?: string }).code;
        if (code === '23505') {
          throw conflict(
            'Active work item already exists for this dedup key',
            'work_item_dedup_conflict',
          );
        }
        throw insertResp.error;
      }
      const row = insertResp.data as WorkItemRow;
      const transitionId = await insertTransition({
        org_id: orgId,
        work_item_id: row.id,
        from_state: null,
        to_state: initialState,
        transition_kind: 'command',
        action_code: 'create_work_item',
        actor_type: 'user',
        actor_user_id: actorUserId,
        reason_text: asOptionalString(payload.reason_text),
        metadata_json: {
          source_module: sourceModule,
          source_entity_type: sourceEntityType,
          source_entity_id: sourceEntityId,
          creation_source_type: creationSourceType,
        },
        expected_version: null,
        resulting_version: row.version,
      });
      await audit(
        orgId,
        actorUserId,
        'work_item',
        row.id,
        AUDIT_ACTIONS.WORK_ITEM_CREATED,
        {
          module_key: moduleKey,
          work_type: workType,
          period_key: periodKey,
          work_state: initialState,
        },
      );
      if (assignedUserId) {
        await runPhase3aSlaHooks({
          orgId,
          workItemId: row.id,
          command: 'assign_work_item',
          transitionId,
          actorUserId,
          workType,
          toState: initialState,
        });
      }
      return { workItemId: row.id };
      });
    }

    case 'assign_work_item': {
      return executeWithCommandIdempotency(ctx, orgId, command, payload, async () => {
        requireWorkEnginePermission(ctx, WORK_ENGINE_PERMISSIONS.assign);
        const workItemId = reqString(payload, 'work_item_id');
        const expectedVersion = reqInt(payload, 'expected_version');
        const assignedUserIdRaw = asOptionalString(payload.assigned_user_id);
        if (assignedUserIdRaw == null || assignedUserIdRaw === '') {
          throw badRequest(
            'assign_work_item requires assigned_user_id (first assignment only; use transfer_work_item to reassign)',
            'assign_target_required',
          );
        }
        const current = await loadWorkItem(orgId, workItemId);
        assertExpectedVersion(current.version, expectedVersion);
        if (current.assigned_user_id != null && String(current.assigned_user_id).trim() !== '') {
          throw badRequest(
            'assign_work_item is only valid when the work item has no assignee; use transfer_work_item',
            'assign_requires_unassigned',
          );
        }
        if (['review_pending', 'done', 'archived'].includes(current.work_state)) {
          throw badRequest(
            `assign_work_item is not allowed in work_state='${current.work_state}'`,
            'invalid_transition',
          );
        }
        if (isQueueRefreshMode(payload)) assertQueueActionEnabled(current, 'assign');
        if (
          assignedUserIdRaw &&
          current.reviewer_user_id &&
          current.reviewer_user_id === assignedUserIdRaw
        ) {
          throw badRequest(
            'Reviewer cannot match the assignee (separation of duties)',
            'SELF_REVIEW_FORBIDDEN',
          );
        }
        const willMoveFromNewToAssigned =
          current.work_state === 'new' && assignedUserIdRaw !== null;
        const nextState: WorkState = willMoveFromNewToAssigned
          ? 'assigned'
          : current.work_state;
        const assigneeChanged =
          (current.assigned_user_id ?? null) !== (assignedUserIdRaw ?? null);
        const newVersion = current.version + 1;
        const patch: Record<string, unknown> = {
          assigned_user_id: assignedUserIdRaw,
          work_state: nextState,
        };
        if (assigneeChanged) {
          patch.claimed_by_user_id = null;
          patch.claimed_at = null;
        }
        await updateWorkItemWithVersion({
          orgId,
          workItemId,
          expectedVersion,
          newVersion,
          patch,
        });
        if (assigneeChanged) {
          await insertWorkAssignmentHistory({
            orgId,
            workItemId,
            from: current.assigned_user_id,
            to: assignedUserIdRaw,
            actorUserId,
            commandType: 'assign_work_item',
            idempotencyKey: reqString(payload, 'idempotency_key'),
          });
        }
        const transitionId = await insertTransition({
          org_id: orgId,
          work_item_id: workItemId,
          from_state: current.work_state,
          to_state: nextState,
          transition_kind: 'command',
          action_code: 'assign_work_item',
          actor_type: 'user',
          actor_user_id: actorUserId,
          reason_text: asOptionalString(payload.reason_text),
          metadata_json: {
            previous_assigned_user_id: current.assigned_user_id,
            new_assigned_user_id: assignedUserIdRaw,
          },
          expected_version: expectedVersion,
          resulting_version: newVersion,
        });
        await audit(
          orgId,
          actorUserId,
          'work_item',
          workItemId,
          AUDIT_ACTIONS.WORK_ITEM_ASSIGNED,
          {
            previous_assigned_user_id: current.assigned_user_id,
            new_assigned_user_id: assignedUserIdRaw,
            from_state: current.work_state,
            to_state: nextState,
          },
        );
        await runPhase3aSlaHooks({
          orgId,
          workItemId,
          command: 'assign_work_item',
          transitionId,
          actorUserId,
          workType: current.work_type,
          toState: nextState,
        });
        return { workItemId };
      });
    }

    case 'change_work_state': {
      return executeWithCommandIdempotency(ctx, orgId, command, payload, async () => {
      const workItemId = reqString(payload, 'work_item_id');
      const expectedVersion = reqInt(payload, 'expected_version');
      const toState = assertValidWorkState(reqString(payload, 'to_state'));
      const current = await loadWorkItem(orgId, workItemId);
      assertExpectedVersion(current.version, expectedVersion);
      if (isQueueRefreshMode(payload)) {
        if (toState === 'archived') assertQueueActionEnabled(current, 'archive');
        else if (toState === 'waiting_client') {
          const acts = queueAllowedActions({
            work_state: current.work_state,
            assigned_user_id: current.assigned_user_id,
          });
          const quick = acts.find((a) => a.command === 'mark_waiting_client');
          if (quick?.enabled) assertQueueActionEnabled(current, 'mark_waiting_client');
          else assertQueueActionEnabled(current, 'change_state');
        } else assertQueueActionEnabled(current, 'change_state');
      }
      if (!canTransitionWorkState(current.work_state, toState)) {
        throw badRequest(
          `Invalid transition: ${current.work_state} -> ${toState}`,
          'invalid_transition',
        );
      }
      const newVersion = current.version + 1;
      const patch: Record<string, unknown> = { work_state: toState };
      if (toState === 'waiting_client' || toState === 'review_pending') {
        patch.claimed_by_user_id = null;
        patch.claimed_at = null;
      }
      await updateWorkItemWithVersion({
        orgId,
        workItemId,
        expectedVersion,
        newVersion,
        patch,
      });
      const transitionId = await insertTransition({
        org_id: orgId,
        work_item_id: workItemId,
        from_state: current.work_state,
        to_state: toState,
        transition_kind: 'command',
        action_code: 'change_work_state',
        actor_type: 'user',
        actor_user_id: actorUserId,
        reason_text: asOptionalString(payload.reason_text),
        metadata_json: {},
        expected_version: expectedVersion,
        resulting_version: newVersion,
      });
      await audit(
        orgId,
        actorUserId,
        'work_item',
        workItemId,
        AUDIT_ACTIONS.WORK_ITEM_STATE_CHANGED,
        { from_state: current.work_state, to_state: toState },
      );
      if (toState === 'waiting_client') {
        await runPhase3aSlaHooks({
          orgId,
          workItemId,
          command: 'change_work_state',
          transitionId,
          actorUserId,
          workType: current.work_type,
          toState,
        });
      }
      return { workItemId };
      });
    }

    case 'set_work_deadline': {
      return executeWithCommandIdempotency(ctx, orgId, command, payload, async () => {
      const workItemId = reqString(payload, 'work_item_id');
      const expectedVersion = reqInt(payload, 'expected_version');
      const dueAt =
        payload.due_at === null ? null : asOptionalIso(payload.due_at);
      const isOverride = payload.override === true;
      const reasonText = asOptionalString(payload.reason_text);
      // docs/work-engine-override-precedence.md §3: reason_text required for deadline overrides.
      if (isOverride && !reasonText) {
        throw badRequest(
          'reason_text is required for deadline override',
          'override_reason_required',
        );
      }
      const current = await loadWorkItem(orgId, workItemId);
      assertExpectedVersion(current.version, expectedVersion);
      if (isQueueRefreshMode(payload)) assertQueueActionEnabled(current, 'set_deadline');
      const newVersion = current.version + 1;
      const overrideSummary = isOverride
        ? {
            field: 'due_at',
            previous_value: current.due_at,
            new_value: dueAt,
            overridden_at: new Date().toISOString(),
            overridden_by: actorUserId,
            reason_text: reasonText,
          }
        : null;
      const patch: Record<string, unknown> = { due_at: dueAt };
      if (isOverride) {
        patch.override_active = true;
        patch.override_summary_json = overrideSummary;
      }
      await updateWorkItemWithVersion({
        orgId,
        workItemId,
        expectedVersion,
        newVersion,
        patch,
      });
      await insertTransition({
        org_id: orgId,
        work_item_id: workItemId,
        from_state: current.work_state,
        to_state: current.work_state,
        transition_kind: isOverride ? 'override' : 'command',
        action_code: 'set_work_deadline',
        actor_type: 'user',
        actor_user_id: actorUserId,
        reason_text: reasonText,
        metadata_json: {
          previous_due_at: current.due_at,
          new_due_at: dueAt,
          override: isOverride,
        },
        expected_version: expectedVersion,
        resulting_version: newVersion,
      });
      await audit(
        orgId,
        actorUserId,
        'work_item',
        workItemId,
        AUDIT_ACTIONS.WORK_ITEM_DEADLINE_SET,
        { previous_due_at: current.due_at, new_due_at: dueAt, override: isOverride },
      );
      return { workItemId };
      });
    }

    case 'append_work_event': {
      const workItemIdOpt = asOptionalString(payload.work_item_id);
      const sourceModule = reqString(payload, 'source_module');
      const sourceEntityType = reqString(payload, 'source_entity_type');
      const sourceEntityId = reqString(payload, 'source_entity_id');
      const eventType = reqString(payload, 'event_type');
      const idempotencyKey = reqString(payload, 'idempotency_key');
      const periodKey = asOptionalString(payload.period_key);
      const directionRaw = asOptionalString(payload.direction) ?? 'outbound';
      if (directionRaw !== 'inbound' && directionRaw !== 'outbound') {
        throw badRequest('direction must be inbound or outbound');
      }
      const direction = directionRaw as EventDirection;
      const eventId = asOptionalString(payload.event_id) ?? randomUUID();
      const occurredAt = asOptionalIso(payload.occurred_at) ?? new Date().toISOString();
      const eventPayload = ensurePayloadObject(payload.payload);
      let clientId: string | null = null;
      if (workItemIdOpt) {
        const wi = await loadWorkItem(orgId, workItemIdOpt);
        clientId = wi.client_id;
      } else {
        const cidOpt = asOptionalString(payload.client_id);
        if (cidOpt) {
          await assertClientBelongsToOrg(orgId, cidOpt);
          clientId = cidOpt;
        }
      }
      const insertResp = await supabaseAdmin
        .from('work_events')
        .insert({
          event_id: eventId,
          org_id: orgId,
          direction,
          source_module: sourceModule,
          source_entity_type: sourceEntityType,
          source_entity_id: sourceEntityId,
          event_type: eventType,
          client_id: clientId,
          period_key: periodKey,
          work_item_id: workItemIdOpt,
          occurred_at: occurredAt,
          emitted_by_type: 'user',
          emitted_by_id: actorUserId,
          schema_version: 1,
          idempotency_key: idempotencyKey,
          payload: eventPayload,
          processing_status: 'accepted',
          processing_outcome: 'manual_command_append',
        })
        .select('id')
        .single();
      if (insertResp.error) {
        const code = (insertResp.error as { code?: string }).code;
        if (code === '23505') {
          throw conflict(
            'Duplicate work_event (event_id or idempotency_key already used)',
            'work_event_duplicate',
          );
        }
        throw insertResp.error;
      }
      const rowId = String(
        (insertResp.data as { id: string | number } | null)?.id ?? '',
      );
      await audit(
        orgId,
        actorUserId,
        'work_event',
        rowId || null,
        AUDIT_ACTIONS.WORK_EVENT_APPENDED,
        {
          source_module: sourceModule,
          event_type: eventType,
          direction,
          work_item_id: workItemIdOpt,
        },
      );
      return { ok: true, command, refreshed: await buildRefreshedForPayload(orgId, payload, ctx) };
    }

    case 'apply_work_override': {
      return executeWithCommandIdempotency(ctx, orgId, command, payload, async () => {
        const workItemId = reqString(payload, 'work_item_id');
        const expectedVersion = reqInt(payload, 'expected_version');
        const overrideKindRaw = reqString(payload, 'override_kind');
      if (!(OVERRIDE_KINDS as readonly string[]).includes(overrideKindRaw)) {
        throw badRequest(
          `Invalid override_kind: ${overrideKindRaw}`,
          'invalid_override_kind',
        );
      }
      const overrideKind = overrideKindRaw as OverrideKind;
        if (overrideKind === 'assignment') {
          throw badRequest(
            'Assignment changes are not allowed via apply_work_override; use pick_up_unassigned, assign_work_item, or transfer_work_item',
            'assignment_override_forbidden',
          );
        }
        requireWorkEnginePermission(ctx, WORK_ENGINE_PERMISSIONS.override);
      const reasonText = asOptionalString(payload.reason_text);
      if (OVERRIDE_KINDS_REQUIRING_REASON.has(overrideKind) && !reasonText) {
        throw badRequest(
          `reason_text is required for override kind '${overrideKind}'`,
          'override_reason_required',
        );
      }
      const current = await loadWorkItem(orgId, workItemId);
      assertExpectedVersion(current.version, expectedVersion);
      if (isQueueRefreshMode(payload)) assertQueueActionEnabled(current, 'apply_override');
      const toStateRaw = asOptionalString(payload.to_state);
      let nextState: WorkState = current.work_state;
      if (toStateRaw) {
        nextState = assertValidWorkState(toStateRaw);
      }
      // Reopen is the only path out of `done` (which is terminal for normal
      // transitions). Other override kinds may NOT touch a `done` item.
      if (overrideKind === 'reopen') {
        if (current.work_state !== 'done') {
          throw badRequest(
            `Override 'reopen' is only valid from work_state='done' (current='${current.work_state}')`,
            'invalid_reopen_source',
          );
        }
        if (!toStateRaw) {
          throw badRequest(
            `Override 'reopen' requires 'to_state' (one of assigned|waiting_human|waiting_client)`,
            'reopen_target_required',
          );
        }
        if (!canReopenFromDone(nextState)) {
          throw badRequest(
            `Override 'reopen' cannot target '${nextState}'; allowed: assigned, waiting_human, waiting_client`,
            'invalid_reopen_target',
          );
        }
      } else if (
        toStateRaw &&
        nextState !== current.work_state &&
        !canTransitionWorkState(current.work_state, nextState)
      ) {
        throw badRequest(
          `Invalid override transition: ${current.work_state} -> ${nextState}`,
          'invalid_transition',
        );
      }
      const newVersion = current.version + 1;
      const overrideSummary = {
        kind: overrideKind,
        previous_state: current.work_state,
        new_state: nextState,
        overridden_at: new Date().toISOString(),
        overridden_by: actorUserId,
        reason_text: reasonText,
        previous_value: payload.previous_value ?? null,
        new_value: payload.new_value ?? null,
      };
      await updateWorkItemWithVersion({
        orgId,
        workItemId,
        expectedVersion,
        newVersion,
        patch: {
          work_state: nextState,
          override_active: true,
          override_summary_json: overrideSummary,
        },
      });
      await insertTransition({
        org_id: orgId,
        work_item_id: workItemId,
        from_state: current.work_state,
        to_state: nextState,
        transition_kind: 'override',
        action_code: 'apply_work_override',
        actor_type: 'user',
        actor_user_id: actorUserId,
        reason_text: reasonText,
        metadata_json: overrideSummary,
        expected_version: expectedVersion,
        resulting_version: newVersion,
      });
      await audit(
        orgId,
        actorUserId,
        'work_item',
        workItemId,
        AUDIT_ACTIONS.WORK_ITEM_OVERRIDE_APPLIED,
        {
          override_kind: overrideKind,
          from_state: current.work_state,
          to_state: nextState,
        },
      );
      return { workItemId };
      });
    }

    case 'pick_up_unassigned': {
      return executeWithCommandIdempotency(ctx, orgId, command, payload, async () => {
        requireWorkEnginePermission(ctx, WORK_ENGINE_PERMISSIONS.pickup);
        const workItemId = reqString(payload, 'work_item_id');
        const current = await loadWorkItem(orgId, workItemId);
        if (!canPickUpFromUnassignedWorkState(current.work_state) || current.assigned_user_id !== null) {
          throw badRequest(
            'pick_up_unassigned requires work_state=new or waiting_human (office queue) and no assignee',
            'invalid_transition',
          );
        }
        const policy = await resolveWorkTypeWorkflowPolicy(orgId, current.work_type);
        const role = ctx.membership?.roleCode ?? 'staff';
        if (!canStaffPickUpUnassigned(policy, role)) {
          throw badRequest(
            'Pick up blocked by work type policy for this role',
            'POLICY_DENIES_COMMAND',
          );
        }
        const expectedVersion = reqInt(payload, 'expected_version');
        assertExpectedVersion(current.version, expectedVersion);
        const newVersion = current.version + 1;
        await updateWorkItemWithVersion({
          orgId,
          workItemId,
          expectedVersion,
          newVersion,
          patch: {
            assigned_user_id: actorUserId,
            work_state: 'assigned',
          },
        });
        await insertWorkAssignmentHistory({
          orgId,
          workItemId,
          from: null,
          to: actorUserId,
          actorUserId,
          commandType: 'pick_up_unassigned',
          idempotencyKey: reqString(payload, 'idempotency_key'),
        });
        const transitionId = await insertTransition({
          org_id: orgId,
          work_item_id: workItemId,
          from_state: current.work_state,
          to_state: 'assigned',
          transition_kind: 'command',
          action_code: 'pick_up_unassigned',
          actor_type: 'user',
          actor_user_id: actorUserId,
          reason_text: asOptionalString(payload.reason_text),
          metadata_json: { new_assigned_user_id: actorUserId },
          expected_version: expectedVersion,
          resulting_version: newVersion,
        });
        await audit(orgId, actorUserId, 'work_item', workItemId, AUDIT_ACTIONS.WORK_ITEM_PICKED_UP, {
          to_assignee: actorUserId,
        });
        await runPhase3aSlaHooks({
          orgId,
          workItemId,
          command: 'pick_up_unassigned',
          transitionId,
          actorUserId,
          workType: current.work_type,
          toState: 'assigned',
        });
        return { workItemId };
      });
    }

    case 'transfer_work_item': {
      return executeWithCommandIdempotency(ctx, orgId, command, payload, async () => {
        requireWorkEnginePermission(ctx, WORK_ENGINE_PERMISSIONS.assign);
        const workItemId = reqString(payload, 'work_item_id');
        const toUserId = reqString(payload, 'to_assigned_user_id');
        const current = await loadWorkItem(orgId, workItemId);
        const expectedVersion = reqInt(payload, 'expected_version');
        assertExpectedVersion(current.version, expectedVersion);
        if (isQueueRefreshMode(payload)) assertQueueActionEnabled(current, 'transfer');
        if (['new', 'review_pending', 'done', 'archived'].includes(current.work_state)) {
          throw badRequest(
            `transfer_work_item is not allowed in work_state='${current.work_state}'`,
            'invalid_transition',
          );
        }
        if (current.assigned_user_id == null || String(current.assigned_user_id).trim() === '') {
          throw badRequest(
            'transfer_work_item requires an existing assignee; use assign_work_item or pick_up_unassigned',
            'transfer_requires_assignee',
          );
        }
        if (current.reviewer_user_id && current.reviewer_user_id === toUserId) {
          throw badRequest(
            'Reviewer cannot match the assignee (separation of duties)',
            'SELF_REVIEW_FORBIDDEN',
          );
        }
        const newVersion = current.version + 1;
        await updateWorkItemWithVersion({
          orgId,
          workItemId,
          expectedVersion,
          newVersion,
          patch: {
            assigned_user_id: toUserId,
            claimed_by_user_id: null,
            claimed_at: null,
          },
        });
        await insertWorkAssignmentHistory({
          orgId,
          workItemId,
          from: current.assigned_user_id,
          to: toUserId,
          actorUserId,
          commandType: 'transfer_work_item',
          idempotencyKey: reqString(payload, 'idempotency_key'),
        });
        await insertTransition({
          org_id: orgId,
          work_item_id: workItemId,
          from_state: current.work_state,
          to_state: current.work_state,
          transition_kind: 'command',
          action_code: 'transfer_work_item',
          actor_type: 'user',
          actor_user_id: actorUserId,
          reason_text: asOptionalString(payload.reason_text),
          metadata_json: {
            previous_assigned_user_id: current.assigned_user_id,
            new_assigned_user_id: toUserId,
          },
          expected_version: expectedVersion,
          resulting_version: newVersion,
        });
        await audit(orgId, actorUserId, 'work_item', workItemId, AUDIT_ACTIONS.WORK_ITEM_TRANSFERRED, {
          from: current.assigned_user_id,
          to: toUserId,
        });
        return { workItemId };
      });
    }

    case 'claim_work_item': {
      return executeWithCommandIdempotency(ctx, orgId, command, payload, async () => {
        const force = payload.force === true;
        const workItemId = reqString(payload, 'work_item_id');
        const current = await loadWorkItem(orgId, workItemId);
        const expectedVersion = reqInt(payload, 'expected_version');
        assertExpectedVersion(current.version, expectedVersion);
        if (current.work_state !== 'assigned') {
          throw badRequest(
            `claim_work_item is only allowed in work_state='assigned' (current='${current.work_state}')`,
            'invalid_transition',
          );
        }
        if (current.claimed_by_user_id) {
          throw conflict('Work item already claimed', 'WORK_ITEM_ALREADY_CLAIMED');
        }
        let claimHolder: string;
        if (force) {
          requireWorkEnginePermission(ctx, WORK_ENGINE_PERMISSIONS.claimForce);
          if (!current.assigned_user_id) {
            throw badRequest('Cannot force-claim without assignee', 'invalid_transition');
          }
          claimHolder = current.assigned_user_id;
        } else {
          requireWorkEnginePermission(ctx, WORK_ENGINE_PERMISSIONS.claim);
          if (current.assigned_user_id !== actorUserId) {
            throw badRequest('Only the assignee can claim this item', 'WORK_ITEM_NOT_ASSIGNEE');
          }
          claimHolder = actorUserId;
        }
        const newVersion = current.version + 1;
        await updateWorkItemWithVersion({
          orgId,
          workItemId,
          expectedVersion,
          newVersion,
          patch: {
            claimed_by_user_id: claimHolder,
            claimed_at: new Date().toISOString(),
          },
        });
        const transitionId = await insertTransition({
          org_id: orgId,
          work_item_id: workItemId,
          from_state: current.work_state,
          to_state: current.work_state,
          transition_kind: 'command',
          action_code: 'claim_work_item',
          actor_type: 'user',
          actor_user_id: actorUserId,
          reason_text: asOptionalString(payload.reason_text),
          metadata_json: { claimed_by_user_id: claimHolder, force },
          expected_version: expectedVersion,
          resulting_version: newVersion,
        });
        await audit(orgId, actorUserId, 'work_item', workItemId, AUDIT_ACTIONS.WORK_ITEM_CLAIMED, {
          claimed_by_user_id: claimHolder,
          force,
        });
        await runPhase3aSlaHooks({
          orgId,
          workItemId,
          command: 'claim_work_item',
          transitionId,
          actorUserId,
          workType: current.work_type,
          toState: current.work_state,
        });
        return { workItemId };
      });
    }

    case 'release_claim': {
      return executeWithCommandIdempotency(ctx, orgId, command, payload, async () => {
        const workItemId = reqString(payload, 'work_item_id');
        const current = await loadWorkItem(orgId, workItemId);
        const expectedVersion = reqInt(payload, 'expected_version');
        assertExpectedVersion(current.version, expectedVersion);
        if (!current.claimed_by_user_id) {
          return { workItemId };
        }
        const isHolder = current.claimed_by_user_id === actorUserId;
        if (isHolder) {
          requireWorkEnginePermission(ctx, WORK_ENGINE_PERMISSIONS.claim);
        } else {
          requireWorkEnginePermission(ctx, WORK_ENGINE_PERMISSIONS.claimForce);
        }
        const force = !isHolder;
        const newVersion = current.version + 1;
        await updateWorkItemWithVersion({
          orgId,
          workItemId,
          expectedVersion,
          newVersion,
          patch: {
            claimed_by_user_id: null,
            claimed_at: null,
          },
        });
        await insertTransition({
          org_id: orgId,
          work_item_id: workItemId,
          from_state: current.work_state,
          to_state: current.work_state,
          transition_kind: 'command',
          action_code: 'release_claim',
          actor_type: 'user',
          actor_user_id: actorUserId,
          reason_text: asOptionalString(payload.reason_text),
          metadata_json: { force: !isHolder },
          expected_version: expectedVersion,
          resulting_version: newVersion,
        });
        await audit(orgId, actorUserId, 'work_item', workItemId, AUDIT_ACTIONS.WORK_ITEM_CLAIM_RELEASED, {
          previous_claimed_by: current.claimed_by_user_id,
          force,
        });
        return { workItemId };
      });
    }

    case 'request_review': {
      return executeWithCommandIdempotency(ctx, orgId, command, payload, async () => {
        const workItemId = reqString(payload, 'work_item_id');
        const expectedVersion = reqInt(payload, 'expected_version');
        const idempotencyKey = reqString(payload, 'idempotency_key');
        const current = await loadWorkItem(orgId, workItemId);
        assertExpectedVersion(current.version, expectedVersion);
        const policy = await resolveWorkTypeWorkflowPolicy(orgId, current.work_type);
        if (policy.review_gate === 'none') {
          throw badRequest(
            'Review workflow is not enabled for this work type',
            'REVIEW_NOT_APPLICABLE',
          );
        }
        if (current.work_state === 'review_pending') {
          throw conflict('Work item is already in review', 'WORK_ITEM_ALREADY_IN_REVIEW');
        }
        if (current.work_state !== 'assigned') {
          throw badRequest(
            `request_review requires work_state=assigned (current='${current.work_state}')`,
            'INVALID_TRANSITION',
          );
        }
        if (!current.assigned_user_id) {
          throw badRequest('Work item has no assignee', 'INVALID_TRANSITION');
        }
        if (!current.reviewer_user_id) {
          throw badRequest(
            'Designated reviewer is required before requesting review',
            'REVIEWER_REQUIRED',
          );
        }
        if (current.reviewer_user_id === current.assigned_user_id) {
          throw badRequest(
            'Reviewer cannot match the assignee (separation of duties)',
            'SELF_REVIEW_FORBIDDEN',
          );
        }
        assertActorMayRequestReview(ctx, current);

        const newVersion = current.version + 1;
        await updateWorkItemWithVersion({
          orgId,
          workItemId,
          expectedVersion,
          newVersion,
          patch: {
            work_state: 'review_pending',
            claimed_by_user_id: null,
            claimed_at: null,
          },
        });
        const transitionId = await insertTransition({
          org_id: orgId,
          work_item_id: workItemId,
          from_state: current.work_state,
          to_state: 'review_pending',
          transition_kind: 'command',
          action_code: 'request_review',
          actor_type: 'user',
          actor_user_id: actorUserId,
          reason_text: asOptionalString(payload.reason_text),
          metadata_json: {
            event_kind: 'review_requested',
            reviewer_user_id: current.reviewer_user_id,
            assignee_user_id: current.assigned_user_id,
            requested_by_user_id: actorUserId,
            previous_state: current.work_state,
            new_state: 'review_pending',
            idempotency_key: idempotencyKey,
            notification_intent: 'office_reviewer_review_required',
          },
          expected_version: expectedVersion,
          resulting_version: newVersion,
        });
        await runPhase3aSlaHooks({
          orgId,
          workItemId,
          command: 'request_review',
          transitionId,
          actorUserId,
          workType: current.work_type,
          toState: 'review_pending',
        });
        await audit(orgId, actorUserId, 'work_item', workItemId, AUDIT_ACTIONS.WORK_ITEM_REVIEW_REQUESTED, {
          reviewer_user_id: current.reviewer_user_id,
          assignee_user_id: current.assigned_user_id,
          from_state: current.work_state,
          to_state: 'review_pending',
          idempotency_key: idempotencyKey,
          notification_intent: 'office_reviewer_review_required',
        });
        return { workItemId };
      });
    }

    case 'approve_work_item': {
      return executeWithCommandIdempotency(ctx, orgId, command, payload, async () => {
        requireWorkEnginePermission(ctx, WORK_ENGINE_PERMISSIONS.reviewApprove);
        const workItemId = reqString(payload, 'work_item_id');
        const expectedVersion = reqInt(payload, 'expected_version');
        const idempotencyKey = reqString(payload, 'idempotency_key');
        const current = await loadWorkItem(orgId, workItemId);
        assertExpectedVersion(current.version, expectedVersion);
        const policy = await resolveWorkTypeWorkflowPolicy(orgId, current.work_type);
        if (policy.review_gate === 'none') {
          throw badRequest('Review is not enabled for this work type', 'POLICY_DENIES_COMMAND');
        }
        if (current.work_state !== 'review_pending') {
          throw badRequest(
            `approve_work_item requires work_state=review_pending (current='${current.work_state}')`,
            'INVALID_TRANSITION',
          );
        }
        if (!current.reviewer_user_id || !current.assigned_user_id) {
          throw badRequest('Invalid review row (missing reviewer or assignee)', 'INVALID_TRANSITION');
        }
        if (current.reviewer_user_id === current.assigned_user_id) {
          throw badRequest('Reviewer cannot match the assignee', 'SELF_REVIEW_FORBIDDEN');
        }
        assertActorMayApproveOrReject(ctx, current);

        const newVersion = current.version + 1;
        await updateWorkItemWithVersion({
          orgId,
          workItemId,
          expectedVersion,
          newVersion,
          patch: { work_state: 'assigned' },
        });
        const transitionId = await insertTransition({
          org_id: orgId,
          work_item_id: workItemId,
          from_state: 'review_pending',
          to_state: 'assigned',
          transition_kind: 'command',
          action_code: 'approve_work_item',
          actor_type: 'user',
          actor_user_id: actorUserId,
          reason_text: asOptionalString(payload.reason_text),
          metadata_json: {
            event_kind: 'review_approved',
            review_result: 'approved',
            reviewer_user_id: current.reviewer_user_id,
            assignee_user_id: current.assigned_user_id,
            approved_by_user_id: actorUserId,
            previous_state: 'review_pending',
            new_state: 'assigned',
            idempotency_key: idempotencyKey,
            break_glass: current.reviewer_user_id !== actorUserId,
            notification_intent: 'assignee_approval_decision',
          },
          expected_version: expectedVersion,
          resulting_version: newVersion,
        });
        await runPhase3aSlaHooks({
          orgId,
          workItemId,
          command: 'approve_work_item',
          transitionId,
          actorUserId,
          workType: current.work_type,
          toState: 'assigned',
        });
        await audit(orgId, actorUserId, 'work_item', workItemId, AUDIT_ACTIONS.WORK_ITEM_REVIEW_APPROVED, {
          reviewer_user_id: current.reviewer_user_id,
          assignee_user_id: current.assigned_user_id,
          from_state: 'review_pending',
          to_state: 'assigned',
          idempotency_key: idempotencyKey,
          break_glass: current.reviewer_user_id !== actorUserId,
          notification_intent: 'assignee_approval_decision',
        });
        return { workItemId };
      });
    }

    case 'reject_work_item': {
      return executeWithCommandIdempotency(ctx, orgId, command, payload, async () => {
        requireWorkEnginePermission(ctx, WORK_ENGINE_PERMISSIONS.reviewReject);
        const workItemId = reqString(payload, 'work_item_id');
        const expectedVersion = reqInt(payload, 'expected_version');
        const idempotencyKey = reqString(payload, 'idempotency_key');
        const rejectionReasonRaw = String(payload.rejection_reason ?? '').trim();
        if (!rejectionReasonRaw) {
          throw badRequest('rejection_reason is required', 'REVIEW_REJECTION_REASON_REQUIRED');
        }
        const current = await loadWorkItem(orgId, workItemId);
        assertExpectedVersion(current.version, expectedVersion);
        const policy = await resolveWorkTypeWorkflowPolicy(orgId, current.work_type);
        if (policy.review_gate === 'none') {
          throw badRequest('Review is not enabled for this work type', 'POLICY_DENIES_COMMAND');
        }
        if (current.work_state !== 'review_pending') {
          throw badRequest(
            `reject_work_item requires work_state=review_pending (current='${current.work_state}')`,
            'INVALID_TRANSITION',
          );
        }
        if (!current.reviewer_user_id || !current.assigned_user_id) {
          throw badRequest('Invalid review row (missing reviewer or assignee)', 'INVALID_TRANSITION');
        }
        if (current.reviewer_user_id === current.assigned_user_id) {
          throw badRequest('Reviewer cannot match the assignee', 'SELF_REVIEW_FORBIDDEN');
        }
        assertActorMayApproveOrReject(ctx, current);

        const newVersion = current.version + 1;
        await updateWorkItemWithVersion({
          orgId,
          workItemId,
          expectedVersion,
          newVersion,
          patch: { work_state: 'assigned' },
        });
        const transitionId = await insertTransition({
          org_id: orgId,
          work_item_id: workItemId,
          from_state: 'review_pending',
          to_state: 'assigned',
          transition_kind: 'command',
          action_code: 'reject_work_item',
          actor_type: 'user',
          actor_user_id: actorUserId,
          reason_text: rejectionReasonRaw,
          metadata_json: {
            event_kind: 'review_rejected',
            review_result: 'rejected',
            reviewer_user_id: current.reviewer_user_id,
            assignee_user_id: current.assigned_user_id,
            rejected_by_user_id: actorUserId,
            rejection_reason: rejectionReasonRaw,
            previous_state: 'review_pending',
            new_state: 'assigned',
            idempotency_key: idempotencyKey,
            break_glass: current.reviewer_user_id !== actorUserId,
            notification_intent: 'assignee_approval_decision',
          },
          expected_version: expectedVersion,
          resulting_version: newVersion,
        });
        await runPhase3aSlaHooks({
          orgId,
          workItemId,
          command: 'reject_work_item',
          transitionId,
          actorUserId,
          workType: current.work_type,
          toState: 'assigned',
        });
        await audit(orgId, actorUserId, 'work_item', workItemId, AUDIT_ACTIONS.WORK_ITEM_REVIEW_REJECTED, {
          reviewer_user_id: current.reviewer_user_id,
          assignee_user_id: current.assigned_user_id,
          from_state: 'review_pending',
          to_state: 'assigned',
          rejection_reason: rejectionReasonRaw,
          idempotency_key: idempotencyKey,
          break_glass: current.reviewer_user_id !== actorUserId,
          notification_intent: 'assignee_approval_decision',
        });
        return { workItemId };
      });
    }

    case 'generate_reminder_candidate': {
      const queuePayload: WorkEngineCommandPayload = {
        ...payload,
        refresh_aggregate: REFRESH_QUEUE,
      };
      return executeWithCommandIdempotency(ctx, orgId, command, queuePayload, async () => {
        requireWorkEnginePermission(ctx, WORK_ENGINE_PERMISSIONS.write);
        const workItemId = reqString(payload, 'work_item_id');
        const stepKey = reqString(payload, 'step_key');
        const workflowType = parseGenerateReminderCandidateWorkflowType(payload.workflow_type);
        const expectedVersion = reqInt(payload, 'expected_version');
        const current = await loadWorkItem(orgId, workItemId);
        assertExpectedVersion(current.version, expectedVersion);

        const outcome = await generateReminderCandidate({
          orgId,
          workItem: current,
          workflowType,
          stepKey,
          triggerType: 'manual_command',
        });

        if (outcome.created) {
          await audit(
            orgId,
            actorUserId,
            'work_reminder_candidate',
            outcome.candidateId,
            AUDIT_ACTIONS.REMINDER_CANDIDATE_CREATED,
            {
              work_item_id: workItemId,
              workflow_type: workflowType,
              step_key: stepKey,
              dedup_key: buildReminderCandidateDedupKey({
                workItemId,
                workflowType,
                stepKey,
              }),
              policy_driven: true,
            },
          );
        }

        return { workItemId };
      });
    }

    case 'intake_work_event': {
      // Stage 3A: thin dispatcher only — all intake / dedup / work_item creation
      // logic lives in work-engine.event-intake.service.ts. The route layer must
      // not make any workflow decisions.
      const meta = await intakeWorkEvent({ kind: 'office_request', ctx }, payload);
      return {
        ok: true,
        command,
        refreshed: await buildRefreshedForPayload(orgId, payload, ctx),
        meta,
      };
    }

    default: {
      const exhaustive: never = command;
      throw badRequest(`Unknown work engine command: ${String(exhaustive)}`);
    }
  }
}
